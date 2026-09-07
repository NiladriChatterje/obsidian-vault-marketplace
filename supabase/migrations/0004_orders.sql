-- Razorpay orders created by the payment server (server/). One row per checkout attempt;
-- a paid order also produces a purchases row. Written only with the service role key.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  razorpay_order_id text not null unique,
  vault_id uuid not null references public.vaults(id) on delete restrict,
  buyer_id uuid references public.profiles(id) on delete set null,
  buyer_email text,
  title text not null default '',
  amount_cents integer not null,
  currency text not null default 'INR',
  fee_cents integer not null default 0,
  return_origin text not null default 'vaultmarket:/',
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  razorpay_payment_id text unique,
  razorpay_signature text,
  razorpay_transfer_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);

alter table public.orders enable row level security;
create policy "buyers see own orders" on public.orders for select using (buyer_id = auth.uid());
