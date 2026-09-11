-- Carry Razorpay's review verdict for a Route linked account, not just the boolean.
-- "Pending" hid two different situations: Razorpay is still looking, and Razorpay
-- has asked for something and is waiting on the seller. Only the second is actionable,
-- and the seller could not see it.

-- activation_status straight from the Route product: under_review, needs_clarification,
-- activated, suspended. Null until the product exists.
alter table public.profiles add column if not exists razorpay_payout_status text;
-- The product's `requirements` array verbatim: which field Razorpay wants and why.
alter table public.profiles add column if not exists razorpay_requirements jsonb;

-- Both are Razorpay's word, written by the server with the service role. A seller
-- editing their own profile must not be able to claim they are activated.
drop policy if exists "users edit own profile" on public.profiles;
create policy "users edit own profile" on public.profiles for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and razorpay_account_id is not distinct from (select razorpay_account_id from public.profiles where id = auth.uid())
    and razorpay_product_id is not distinct from (select razorpay_product_id from public.profiles where id = auth.uid())
    and payouts_enabled = (select payouts_enabled from public.profiles where id = auth.uid())
    and razorpay_payout_status is not distinct from (select razorpay_payout_status from public.profiles where id = auth.uid())
    and razorpay_requirements is not distinct from (select razorpay_requirements from public.profiles where id = auth.uid())
  );

-- A refunded order is neither paid nor failed: the payment succeeded and was given back.
-- Without this the refund webhook cannot record what happened.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('created', 'paid', 'failed', 'refunded'));

alter table public.orders add column if not exists refunded_at timestamptz;
-- Reversal of the Route transfer that paid the seller, when there was one to reverse.
alter table public.orders add column if not exists razorpay_reversal_id text;
