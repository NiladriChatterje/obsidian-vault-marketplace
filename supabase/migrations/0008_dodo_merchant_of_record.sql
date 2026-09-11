-- Razorpay Route is gone and Dodo Payments is the rail.
--
-- Route split each payment to a seller's linked account, which made the platform a
-- payment aggregator: RBI gates that, and linked accounts only exist for India and
-- Malaysia anyway. Under a merchant of record the platform is the seller, creators are
-- suppliers paid a royalty outside the checkout, and none of the linked-account
-- bookkeeping below has anything left to describe.

-- ---------- profiles: drop the linked-account columns ----------
-- The policy has to go first; it names every column being dropped.
drop policy if exists "users edit own profile" on public.profiles;

alter table public.profiles drop column if exists razorpay_account_id;
alter table public.profiles drop column if exists razorpay_product_id;
alter table public.profiles drop column if exists razorpay_payout_status;
alter table public.profiles drop column if exists razorpay_requirements;
alter table public.profiles drop column if exists payouts_enabled;

-- Back to what it guarded before Route existed: your own row, nothing else.
create policy "users edit own profile" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- orders: one shape for whichever provider took the payment ----------
alter table public.orders add column if not exists provider text not null default 'razorpay';
alter table public.orders drop constraint if exists orders_provider_check;
alter table public.orders add constraint orders_provider_check check (provider in ('razorpay', 'dodo'));

-- Existing rows are all Razorpay and keep their ids; the columns simply stop naming one
-- provider. Renames preserve the data and the unique indexes.
alter table public.orders rename column razorpay_order_id to provider_order_id;
alter table public.orders rename column razorpay_payment_id to provider_payment_id;
alter table public.orders rename column razorpay_signature to provider_signature;

-- Route transfers and their reversals. Nothing splits a payment any more.
alter table public.orders drop column if exists razorpay_transfer_id;
alter table public.orders drop column if exists razorpay_reversal_id;

-- ---------- purchases ----------
alter table public.purchases rename column razorpay_payment_id to provider_payment_id;
alter table public.purchases drop column if exists razorpay_transfer_id;

-- ---------- dodo products ----------
-- Dodo prices a product, and a checkout references it, so every vault needs one product
-- on their side. The mapping is cached here and the price is re-pushed when a seller
-- changes it, so a listing and its Dodo product cannot drift apart.
create table if not exists public.dodo_products (
  vault_id text primary key,
  product_id text not null unique,
  price_cents integer not null,
  currency text not null default 'INR',
  updated_at timestamptz not null default now()
);

alter table public.dodo_products enable row level security;
-- Server-only: the service role bypasses RLS, and no policy means no one else reads it.
