-- A payout run says what leaves the platform's account and, separately, what the seller
-- receives.
--
-- Every listing is priced in the platform's currency and a balance is a sum of those
-- prices, so a run's amount is always in that currency. The column labelling it was being
-- filled with the seller's *receiving* currency instead, which turned a run for Rs 5,000
-- owed to a seller paid in dollars into a batch-file line reading "500000 USD": an
-- instruction to send five thousand dollars. The amount was right; the label was not.
-- The label is corrected and what the seller receives gets a column of its own.
alter table public.seller_payout_runs add column if not exists payout_currency text;

-- Existing rows: the amount was always in the platform's currency whatever the label said,
-- because that is what the ledger adds up. The old label is the currency the seller asked
-- to receive, so it moves to the new column rather than being lost.
update public.seller_payout_runs set payout_currency = currency where payout_currency is null;
update public.seller_payout_runs set currency = 'INR' where currency <> 'INR';

-- When the operator was last mailed about this run. The watcher now checks at boot as well
-- as on its timer, so a service that restarts often would otherwise mail on every restart.
-- A run is put in front of the operator again only once a full cadence has passed.
alter table public.seller_payout_runs add column if not exists notified_at timestamptz;
