-- A payout run becomes an instruction, not just a receipt.
--
-- Until now a row in seller_payout_runs meant "this transfer has been made", written by
-- hand after the fact. That leaves the step that matters, noticing a seller is owed money
-- and acting on it, entirely in the operator's memory. A missed week is invisible: the
-- balance simply sits there and the seller waits.
--
-- So a run is now prepared first and confirmed after. A scheduled job writes a `pending`
-- run for every seller whose money has cleared its region's window and is worth sending,
-- and the operator confirms it once the transfer is actually made.
--
-- The distinction is not cosmetic. A pending run is money promised but not moved, so it
-- must never count as paid: doing so would clear a balance nothing was sent against, and
-- the seller's money would vanish from the ledger without reaching them. Balances subtract
-- pending separately from paid, which also stops a second run being prepared for a seller
-- who already has one waiting.
alter table public.seller_payout_runs
  add column if not exists status text not null default 'paid';

-- Existing rows were all written by hand after a real transfer, so they are paid.
update public.seller_payout_runs set status = 'paid' where status is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seller_payout_runs_status_check') then
    alter table public.seller_payout_runs
      add constraint seller_payout_runs_status_check
      check (status in ('pending', 'paid', 'cancelled'));
  end if;
end $$;

-- Null until the transfer is confirmed. A pending run has not been paid at any time, and
-- defaulting it to now() would have it read as paid the moment it was prepared.
alter table public.seller_payout_runs alter column paid_at drop not null;
alter table public.seller_payout_runs alter column paid_at drop default;

-- When the job prepared it, which is not when it was paid.
alter table public.seller_payout_runs
  add column if not exists prepared_at timestamptz not null default now();

-- At most one run awaiting confirmation per seller, so a job that runs twice, or runs
-- again before the operator has acted, cannot promise the same balance twice.
create unique index if not exists seller_payout_runs_one_pending
  on public.seller_payout_runs (seller_id) where status = 'pending';

create index if not exists seller_payout_runs_status_idx
  on public.seller_payout_runs (status, prepared_at desc);
