-- ============================================================================
-- Step 3 support: align receipt-year basis with the prototype + add a counter
-- sync used by the one-time data importer.
--
-- 1) The prototype numbered receipts by the CURRENT year at entry time
--    (new Date().getFullYear()), not the donation's back-date. To keep imported
--    receipts and future auto-generated ones in the same yearly buckets, switch
--    set_receipt_no() to the current year in IST (Asia/Kolkata).
--
-- 2) sync_receipt_counters() sets each year's counter to the highest NNNN that
--    already exists in donations.receipt_no (parsed from the receipt itself, not
--    the date). The importer calls this after loading preserved receipts so the
--    next new donation continues past them instead of colliding. Admin-only.
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

  yr := extract(year from (now() at time zone 'Asia/Kolkata'))::int;

  insert into public.receipt_counters (year, last_no)
    values (yr, 1)
    on conflict (year) do update
      set last_no = public.receipt_counters.last_no + 1
    returning last_no into seq;

  new.receipt_no := 'UF-' || yr::text || '-' || lpad(seq::text, 4, '0');
  return new;
end;
$$;

create or replace function public.sync_receipt_counters()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only admins may sync receipt counters';
  end if;

  insert into public.receipt_counters (year, last_no)
  select split_part(receipt_no, '-', 2)::int as yr,
         max(split_part(receipt_no, '-', 3)::int) as mx
  from public.donations
  where receipt_no ~ '^UF-[0-9]{4}-[0-9]+$'
  group by split_part(receipt_no, '-', 2)::int
  on conflict (year) do update
    set last_no = greatest(public.receipt_counters.last_no, excluded.last_no);
end;
$$;
