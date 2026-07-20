-- ============================================================================
-- Ummat Foundation — initial schema, receipt numbering, RLS, and seed settings
-- Phase 2, build step 2. Apply this in the Supabase SQL Editor (or via the CLI).
--
-- Security model (see spec "Security requirements"):
--   * RLS is enabled on every table; the `anon` role can read NOTHING.
--   * Staff (admin + volunteer) are Supabase Auth users with a row in `profiles`.
--   * Online donations are inserted ONLY by the Edge Function via the service-role
--     key (which bypasses RLS) after webhook verification — never from the client.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  role       text not null default 'volunteer' check (role in ('admin', 'volunteer')),
  created_at timestamptz not null default now()
);

create table if not exists public.donors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null unique,
  city       text default '',
  pan        text default '',
  lang       text not null default 'en',
  created_at timestamptz not null default now()
);

create table if not exists public.donations (
  id                  uuid primary key default gen_random_uuid(),
  donor_id            uuid not null references public.donors (id) on delete restrict,
  amount              numeric not null check (amount > 0),
  date                date not null,
  mode                text,
  purpose             text,
  receipt_no          text unique not null,
  source              text not null default 'manual' check (source in ('manual', 'online')),
  razorpay_payment_id text unique,
  notes               text default '',
  created_by          uuid references auth.users (id) default auth.uid(),
  created_at          timestamptz not null default now()
);

create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  amount     numeric not null check (amount > 0),
  date       date not null,
  category   text,
  paid_to    text default '',
  mode       text,
  notes      text default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

create index if not exists donations_donor_id_idx on public.donations (donor_id);
create index if not exists donations_date_idx      on public.donations (date);
create index if not exists expenses_date_idx        on public.expenses (date);

-- ----------------------------------------------------------------------------
-- Receipt numbering: 'UF-YYYY-NNNN', resets each year.
--
-- A plain sequence cannot reset yearly, so we keep a per-year counter table and
-- allocate the next number in a BEFORE INSERT trigger. The YYYY is taken from
-- the donation's `date` (the year it was received), which is what a receipt book
-- expects. If a receipt_no is supplied (the step-3 data import preserves the
-- originals), the trigger leaves it untouched.
-- ----------------------------------------------------------------------------
create table if not exists public.receipt_counters (
  year    int primary key,
  last_no int not null default 0
);

create or replace function public.set_receipt_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  yr  int;
  seq int;
begin
  if new.receipt_no is not null and new.receipt_no <> '' then
    return new;  -- preserve caller-provided receipt (data import)
  end if;

  yr := extract(year from new.date)::int;

  insert into public.receipt_counters (year, last_no)
    values (yr, 1)
    on conflict (year) do update
      set last_no = public.receipt_counters.last_no + 1
    returning last_no into seq;

  new.receipt_no := 'UF-' || yr::text || '-' || lpad(seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists donations_set_receipt on public.donations;
create trigger donations_set_receipt
  before insert on public.donations
  for each row execute function public.set_receipt_no();

-- ----------------------------------------------------------------------------
-- Auth wiring: create a profile automatically when an auth user is created.
-- Role/name can be passed via user metadata at invite/signup time; role
-- defaults to 'volunteer'. Promote the first admin manually (see note at end).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'volunteer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so they can read `profiles` without tripping
-- the table's own RLS (avoids recursive policy evaluation).
-- ----------------------------------------------------------------------------
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() in ('admin', 'volunteer');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() = 'admin';
$$;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.donors           enable row level security;
alter table public.donations        enable row level security;
alter table public.expenses         enable row level security;
alter table public.settings         enable row level security;
alter table public.receipt_counters enable row level security;

-- profiles: a user sees their own row; admins see all. Only admins change roles.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- donors: staff read & create; admin edits/deletes.
create policy donors_select on public.donors
  for select to authenticated using (public.is_staff());
create policy donors_insert on public.donors
  for insert to authenticated with check (public.is_staff());
create policy donors_update_admin on public.donors
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy donors_delete_admin on public.donors
  for delete to authenticated using (public.is_admin());

-- donations: staff read & create manual rows they own; admin edits/deletes,
-- volunteers may edit their own rows for 24h. Clients can NEVER insert an
-- 'online' row or set a razorpay id — those come from the Edge Function only.
create policy donations_select on public.donations
  for select to authenticated using (public.is_staff());
create policy donations_insert on public.donations
  for insert to authenticated
  with check (
    public.is_staff()
    and source = 'manual'
    and razorpay_payment_id is null
    and created_by = auth.uid()
  );
create policy donations_update on public.donations
  for update to authenticated
  using (
    public.is_admin()
    or (created_by = auth.uid() and created_at > now() - interval '24 hours')
  )
  with check (
    public.is_admin()
    or (created_by = auth.uid() and created_at > now() - interval '24 hours')
  );
create policy donations_delete_admin on public.donations
  for delete to authenticated using (public.is_admin());

-- expenses: same pattern as donations (no source column).
create policy expenses_select on public.expenses
  for select to authenticated using (public.is_staff());
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy expenses_update on public.expenses
  for update to authenticated
  using (
    public.is_admin()
    or (created_by = auth.uid() and created_at > now() - interval '24 hours')
  )
  with check (
    public.is_admin()
    or (created_by = auth.uid() and created_at > now() - interval '24 hours')
  );
create policy expenses_delete_admin on public.expenses
  for delete to authenticated using (public.is_admin());

-- settings: staff read; admin writes.
create policy settings_select on public.settings
  for select to authenticated using (public.is_staff());
create policy settings_write_admin on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- receipt_counters: no policies -> not accessible to anon/authenticated at all.
-- It is only ever touched by the SECURITY DEFINER trigger function above.

-- ----------------------------------------------------------------------------
-- Seed settings (org info + editable lists + WhatsApp templates).
-- Message templates use {name} {amount} {date} {receipt} placeholders and carry
-- the exact prototype copy for en/hi/ur.
-- ----------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('org', '{"name":"Ummat Foundation","subtitle":"Donation Ledger"}'::jsonb),
  ('purposes', '["Zakat","Sadaqah","General","Education","Medical","Ration"]'::jsonb),
  ('categories', '["Ration kits","Education","Medical","Rent","Transport","Salaries","Misc"]'::jsonb),
  ('modes', '["Cash","UPI","Bank transfer","Cheque"]'::jsonb),
  ('templates', jsonb_build_object(
    'thanks', jsonb_build_object(
      'en', 'Assalamualaikum {name}, Ummat Foundation gratefully acknowledges your donation of {amount} on {date}. Receipt no: {receipt}. JazakAllah Khair.',
      'hi', 'अस्सलामुअलैकुम {name} जी, उम्मत फाउंडेशन आपके {amount} के दान ({date}) के लिए दिल से शुक्रगुज़ार है। रसीद नं: {receipt}। जज़ाकल्लाह ख़ैर।',
      'ur', 'السلام علیکم {name}، امت فاؤنڈیشن آپ کے عطیہ {amount} ({date}) کے لیے تہہ دل سے شکر گزار ہے۔ رسید نمبر: {receipt}۔ جزاک اللہ خیر'
    ),
    'reminder', jsonb_build_object(
      'en', 'Assalamualaikum {name}, a gentle reminder from Ummat Foundation. Your past support has helped many families. If you wish to contribute again, we would be grateful. JazakAllah Khair.',
      'hi', 'अस्सलामुअलैकुम {name} जी, उम्मत फाउंडेशन की ओर से एक विनम्र याद-दिहानी। आपके पिछले सहयोग से कई परिवारों को मदद मिली है। अगर आप दोबारा योगदान देना चाहें तो हम आभारी रहेंगे। जज़ाकल्लाह ख़ैर।',
      'ur', 'السلام علیکم {name}، امت فاؤنڈیشن کی جانب سے ایک نرم یاد دہانی۔ آپ کے پچھلے تعاون سے کئی خاندانوں کی مدد ہوئی۔ اگر آپ دوبارہ تعاون کرنا چاہیں تو ہم شکر گزار ہوں گے۔ جزاک اللہ خیر'
    )
  ))
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- FIRST ADMIN (run once, after you sign up your first user in the app):
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ----------------------------------------------------------------------------
