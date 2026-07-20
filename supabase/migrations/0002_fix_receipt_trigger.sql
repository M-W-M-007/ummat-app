-- ============================================================================
-- Fix: set_receipt_no() must run as SECURITY DEFINER.
--
-- The trigger maintains public.receipt_counters, which has RLS enabled and no
-- policies (so it is inaccessible to anon/authenticated). Without SECURITY
-- DEFINER the counter INSERT executes as the calling user and is rejected
-- (SQLSTATE 42501), which aborts every donation insert. Redefining the function
-- as SECURITY DEFINER lets it maintain the counter regardless of caller RLS.
--
-- The trigger already references this function by name, so replacing the
-- function is sufficient — no need to recreate the trigger.
-- ============================================================================
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
