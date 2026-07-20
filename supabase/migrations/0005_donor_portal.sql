-- ============================================================================
-- Donor portal (Phase 3): donors sign in with phone + a self-chosen 6-digit
-- PIN — no SMS/OTP provider, so no per-message cost. A donor's Supabase Auth
-- user is created by the donor-auth Edge Function (service role) with a
-- synthetic email (`d<donor_id>@donors.ummat.internal`) and
-- raw_user_meta_data.account_type = 'donor'.
--
-- handle_new_user() must be taught to skip donor accounts, otherwise every
-- new auth user (including donors) gets a `profiles` row with the default
-- 'volunteer' role — which would make is_staff() true for donors and open up
-- every staff-only table via existing RLS policies.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'account_type', '') = 'donor' then
    return new; -- donor accounts never get a staff profile/role
  end if;

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

-- Links a donor's auth user to their existing donors row. The donor-summary
-- Edge Function uses this (via the service role) to scope a donor to only
-- their own donations; it is never used to grant them direct table access.
create table if not exists public.donor_accounts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  donor_id   uuid not null unique references public.donors (id) on delete cascade,
  phone      text not null,
  created_at timestamptz not null default now()
);

alter table public.donor_accounts enable row level security;

-- A donor may read only their own link row. No insert/update/delete policy
-- exists for anon/authenticated — only the donor-auth function (service
-- role, which bypasses RLS) may write here.
create policy donor_accounts_select_own on public.donor_accounts
  for select to authenticated using (auth.uid() = user_id);
