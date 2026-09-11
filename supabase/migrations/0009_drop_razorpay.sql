-- Razorpay is removed. Dodo Payments is the only rail, so the provider column has one
-- value for every new row and only describes history.
--
-- Old rows keep provider = 'razorpay' on purpose: they are a record of money that really
-- moved, and rewriting them would make the ledger lie. The constraint just stops a new
-- one being written.
alter table public.orders drop constraint if exists orders_provider_check;
alter table public.orders add constraint orders_provider_check check (provider in ('razorpay', 'dodo'));
alter table public.orders alter column provider set default 'dodo';
