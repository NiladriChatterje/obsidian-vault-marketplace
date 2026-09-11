-- What the platform owes each seller, and what it has already paid them.
--
-- Dodo settles every sale to the platform in one amount, so the seller's share is a debt
-- the platform carries until it transfers the money itself. Until now that debt was
-- implied by the purchases table and nothing recorded whether it had been settled, which
-- meant the only record of paying a creator lived outside the system.

-- Which seller a sale belongs to. The vault lives in Sanity, so without this every "who do
-- I owe" question means resolving each purchase against the catalog. Recorded at checkout
-- and copied to the purchase when the payment settles.
alter table public.orders add column if not exists seller_id uuid references public.profiles(id) on delete set null;
alter table public.purchases add column if not exists seller_id uuid references public.profiles(id) on delete set null;
create index if not exists purchases_seller_idx on public.purchases (seller_id, created_at desc);

-- Rows written before this migration have no seller_id and cannot be backfilled in SQL,
-- because the mapping lives in Sanity. They are excluded from what is owed rather than
-- counted as zero, so an old sale can never look like an unpaid debt or a settled one.

-- One row per transfer actually made. Amounts are in the sale's currency, in minor units,
-- matching purchases.amount_cents.
create table if not exists public.seller_payout_runs (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'INR',
  /** Snapshot of where it went, so a later change to seller_payouts cannot rewrite history. */
  method text,
  account_ref text,
  /** The bank or Wise transaction id, so a seller's query can be traced to a real transfer. */
  reference text,
  note text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists seller_payout_runs_seller_idx on public.seller_payout_runs (seller_id, paid_at desc);

alter table public.seller_payout_runs enable row level security;

-- A seller may see what they were paid. Only the server, with the service role, writes.
create policy "sellers read own payouts" on public.seller_payout_runs for select using (seller_id = auth.uid());
