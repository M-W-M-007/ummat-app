-- ============================================================================
-- Step 4: pending online-payment orders.
--
-- create-order stores one row here (server-side, service role) before opening
-- Razorpay Checkout. The razorpay-webhook looks it up on payment.captured to
-- recover the donor details, then inserts the real donation. Clients have NO
-- access — RLS is on with no policies, so only the Edge Functions (service
-- role, which bypasses RLS) can touch it.
-- ============================================================================
create table if not exists public.payment_orders (
  id                uuid primary key default gen_random_uuid(),
  razorpay_order_id text unique not null,
  amount            numeric not null check (amount > 0),   -- rupees
  name              text not null,
  phone             text not null,
  email             text default '',
  purpose           text default 'General',
  pan               text default '',
  ip                text default '',
  status            text not null default 'created' check (status in ('created', 'paid', 'failed')),
  donation_id       uuid references public.donations (id),
  created_at        timestamptz not null default now()
);

create index if not exists payment_orders_ip_created_idx on public.payment_orders (ip, created_at);

alter table public.payment_orders enable row level security;
-- Intentionally NO policies: unreachable by anon/authenticated. Edge Functions
-- use the service-role key, which bypasses RLS.
