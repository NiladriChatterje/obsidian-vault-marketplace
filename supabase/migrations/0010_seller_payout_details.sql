-- Where a seller's share actually goes.
--
-- Dodo is the merchant of record and settles one amount to the platform; it has no
-- sub-merchant concept and will never pay a seller. So the platform pays them, and it can
-- only do that if it knows where to send the money and in what currency. A seller without
-- these details would list a paid vault, someone would buy it, and there would be no way
-- to pay them. Publishing a paid listing is gated on this row existing.
--
-- Deliberately NOT on public.profiles: that table carries a
-- `create policy "profiles are public" ... using (true)` select policy, so anything added
-- there is readable by anyone. This is account data and is owner-only.
create table if not exists public.seller_payouts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  /** ISO 3166-1 alpha-2. Which country the seller is paid in. */
  country text not null,
  /** ISO 4217. Must be one the platform can actually settle in; the server validates it. */
  currency text not null,
  /** How the money is sent: bank, wise, payoneer or paypal. */
  method text not null check (method in ('bank', 'wise', 'payoneer', 'paypal')),
  /** Name on the receiving account. Mismatches are the usual reason a transfer bounces. */
  account_name text not null,
  /** The account itself: IBAN or account number for a bank, the account email otherwise. */
  account_ref text not null,
  /** Free text for an IFSC, sort code, routing number or SWIFT/BIC, which vary by country. */
  bank_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.seller_payouts enable row level security;

-- Owner only. There is no public select policy on purpose, and the payment server reads
-- this with the service role, which bypasses RLS.
create policy "sellers read own payout details" on public.seller_payouts for select using (user_id = auth.uid());
create policy "sellers insert own payout details" on public.seller_payouts for insert with check (user_id = auth.uid());
create policy "sellers update own payout details" on public.seller_payouts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
