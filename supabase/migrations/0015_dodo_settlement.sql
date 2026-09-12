-- A sale is payable only once Dodo has paid us for it.
--
-- The clearing window (0012) answers "can the buyer still reverse this?". It does not
-- answer "has the money reached us?", and the two come apart: Dodo settles to the platform
-- twice a month, and only once the balance passes its floor, so at low volume a sale can sit
-- at Dodo for weeks after its window has passed. Paying the seller then is paying them from
-- the platform's own pocket, on the promise of a settlement that has not arrived.
--
-- So each sale records when Dodo settled it. Dodo's payout breakup lists the payments a
-- payout was made of, so this is exact: the sales in a payout are marked when it lands,
-- not guessed at from dates.
alter table public.purchases add column if not exists settled_at timestamptz;
alter table public.purchases add column if not exists dodo_payout_id text;
create index if not exists purchases_settlement_idx on public.purchases (seller_id, settled_at);

-- Rows written before this migration are not backfilled here. They are settled the same
-- way as everything after it: the first payout check walks every Dodo payout to date and
-- marks the sales each one contained.

-- Dodo's payouts to the platform, as Dodo reports them. `settled_at` is when this side
-- applied one to its purchases; a successful payout without it has not been applied yet,
-- which is what the daily check looks for.
create table if not exists public.dodo_payouts (
  payout_id text primary key,
  amount integer not null,
  currency text not null,
  status text not null,
  /** When Dodo created the payout. */
  created_at timestamptz not null,
  settled_at timestamptz,
  purchases_marked integer not null default 0,
  recorded_at timestamptz not null default now()
);

alter table public.dodo_payouts enable row level security;
-- Server-only: the service role bypasses RLS, and no policy means no one else reads it.
