-- Switch payments from Stripe Connect to Razorpay (Payment Links + Route).

-- profiles: linked account instead of Stripe Express account
alter table public.profiles rename column stripe_account_id to razorpay_account_id;
alter table public.profiles rename column stripe_onboarded to payouts_enabled;
alter table public.profiles add column if not exists razorpay_product_id text;

drop policy if exists "users edit own profile" on public.profiles;
create policy "users edit own profile" on public.profiles for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and razorpay_account_id is not distinct from (select razorpay_account_id from public.profiles where id = auth.uid())
    and razorpay_product_id is not distinct from (select razorpay_product_id from public.profiles where id = auth.uid())
    and payouts_enabled = (select payouts_enabled from public.profiles where id = auth.uid())
  );

-- purchases: Razorpay payment + Route transfer ids
alter table public.purchases rename column stripe_session_id to razorpay_payment_id;
alter table public.purchases rename column stripe_payment_intent to razorpay_transfer_id;

-- vaults: INR by default, minimum paid price ₹49 (4900 paise)
alter table public.vaults alter column currency set default 'INR';
alter table public.vaults drop constraint if exists vaults_price_cents_check;
alter table public.vaults add constraint vaults_price_cents_check check (price_cents = 0 or price_cents >= 4900);
