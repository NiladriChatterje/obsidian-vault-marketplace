-- Hold a sale before it becomes payable.
--
-- The platform's only real exposure to a refund is a sale it has already paid out: the
-- money went to the seller, the buyer got theirs back, and the balance goes negative with
-- nothing to recover it from unless that seller sells again. Holding each sale until the
-- window in which it can be reversed has passed removes that exposure entirely.
--
-- The window depends on the buyer, not the seller. A buyer in the EU, the EEA or the UK has
-- a statutory 14 day right of withdrawal on digital goods; elsewhere there is no such right
-- and a shorter hold is enough. So the buyer's country is recorded and the clearing date is
-- computed from it at the moment the payment settles.
alter table public.purchases add column if not exists buyer_country text;

-- When this sale may be paid out. Null on rows written before this migration; those are old
-- and are treated as cleared, since their windows have long since passed.
alter table public.purchases add column if not exists clears_at timestamptz;

create index if not exists purchases_clearing_idx on public.purchases (seller_id, clears_at);
