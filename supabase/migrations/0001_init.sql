-- Vault Market schema. Apply with: supabase db push  (or paste into the SQL editor)

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text,
  avatar_url text,
  bio text,
  is_seller boolean not null default false,
  stripe_account_id text,
  stripe_onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- Create a profile row automatically on sign-up (username comes from auth metadata).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  candidate text := regexp_replace(base, '[^a-z0-9_.]', '', 'g');
  n int := 0;
begin
  if length(candidate) < 3 then candidate := 'user' || substr(new.id::text, 1, 6); end if;
  candidate := substr(candidate, 1, 24);
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := substr(base, 1, 20) || n::text;
  end loop;
  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, coalesce(new.raw_user_meta_data->>'display_name', candidate));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- vaults ----------
create type public.vault_status as enum ('draft', 'published', 'unlisted');

create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 3 and 80),
  tagline text not null default '',
  description text not null default '',
  category text not null,
  tags text[] not null default '{}',
  price_cents integer not null default 0 check (price_cents = 0 or price_cents >= 199),
  currency text not null default 'USD',
  cover_url text,
  screenshots text[] not null default '{}',
  plugins text[] not null default '{}',
  note_count integer not null default 0,
  size_bytes bigint not null default 0,
  version text not null default '1.0',
  file_path text,
  status public.vault_status not null default 'draft',
  downloads integer not null default 0,
  rating_avg numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_needs_file check (status <> 'published' or file_path is not null)
);

create index if not exists vaults_status_category_idx on public.vaults (status, category);
create index if not exists vaults_downloads_idx on public.vaults (downloads desc);
create index if not exists vaults_tags_idx on public.vaults using gin (tags);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists vaults_touch on public.vaults;
create trigger vaults_touch before update on public.vaults for each row execute function public.touch_updated_at();

-- ---------- purchases ----------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null default 0,
  fee_cents integer not null default 0,
  stripe_session_id text unique,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  unique (vault_id, buyer_id)
);

create index if not exists purchases_buyer_idx on public.purchases (buyer_id);

-- ---------- reviews ----------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text not null default '',
  created_at timestamptz not null default now(),
  unique (vault_id, user_id)
);

-- Keep the denormalised rating on the vault in sync.
create or replace function public.refresh_vault_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.vault_id, old.vault_id);
begin
  update public.vaults set
    rating_avg = coalesce((select avg(rating) from public.reviews where vault_id = v), 0),
    rating_count = (select count(*) from public.reviews where vault_id = v)
  where id = v;
  return null;
end $$;

drop trigger if exists reviews_refresh on public.reviews;
create trigger reviews_refresh after insert or update or delete on public.reviews
  for each row execute function public.refresh_vault_rating();

-- ---------- helper functions (called from the app via rpc) ----------
create or replace function public.has_vault_access(p_vault_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.purchases where vault_id = p_vault_id and buyer_id = auth.uid()
  ) or exists (
    select 1 from public.vaults where id = p_vault_id and seller_id = auth.uid()
  );
$$;

create or replace function public.claim_free_vault(p_vault_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.vaults where id = p_vault_id and status = 'published' and price_cents = 0) then
    raise exception 'This vault is not free';
  end if;
  insert into public.purchases (vault_id, buyer_id, amount_cents, fee_cents)
  values (p_vault_id, auth.uid(), 0, 0)
  on conflict (vault_id, buyer_id) do nothing;
end $$;

create or replace function public.increment_downloads(p_vault_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.vaults set downloads = downloads + 1
  where id = p_vault_id and public.has_vault_access(p_vault_id);
$$;

create or replace function public.seller_stats()
returns table (gross_cents bigint, fee_cents bigint, sales_count bigint, downloads bigint, published_count bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(p.amount_cents), 0),
    coalesce(sum(p.fee_cents), 0),
    count(p.id) filter (where p.amount_cents > 0),
    coalesce((select sum(v2.downloads) from public.vaults v2 where v2.seller_id = auth.uid()), 0),
    (select count(*) from public.vaults v3 where v3.seller_id = auth.uid() and v3.status = 'published')
  from public.vaults v
  left join public.purchases p on p.vault_id = v.id
  where v.seller_id = auth.uid();
$$;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.vaults enable row level security;
alter table public.purchases enable row level security;
alter table public.reviews enable row level security;

create policy "profiles are public" on public.profiles for select using (true);
create policy "users edit own profile" on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id and stripe_account_id is not distinct from (select stripe_account_id from public.profiles where id = auth.uid())
              and stripe_onboarded = (select stripe_onboarded from public.profiles where id = auth.uid()));

create policy "published vaults are public" on public.vaults for select
  using (status = 'published' or seller_id = auth.uid());
create policy "sellers insert own vaults" on public.vaults for insert
  with check (seller_id = auth.uid() and exists (select 1 from public.profiles where id = auth.uid() and is_seller));
create policy "sellers update own vaults" on public.vaults for update
  using (seller_id = auth.uid()) with check (seller_id = auth.uid() and featured = (select featured from public.vaults v where v.id = id));
create policy "sellers delete own vaults" on public.vaults for delete using (seller_id = auth.uid());

create policy "buyers see own purchases" on public.purchases for select
  using (buyer_id = auth.uid() or exists (select 1 from public.vaults v where v.id = vault_id and v.seller_id = auth.uid()));
-- Inserts happen only through claim_free_vault() and the Stripe webhook (service role).

create policy "reviews are public" on public.reviews for select using (true);
create policy "buyers review what they own" on public.reviews for insert
  with check (user_id = auth.uid() and exists (select 1 from public.purchases where vault_id = reviews.vault_id and buyer_id = auth.uid()));
create policy "authors edit own reviews" on public.reviews for update using (user_id = auth.uid());
create policy "authors delete own reviews" on public.reviews for delete using (user_id = auth.uid());

-- ---------- storage ----------
insert into storage.buckets (id, name, public) values ('vault-covers', 'vault-covers', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit) values ('vault-files', 'vault-files', false, 209715200)
  on conflict (id) do nothing;

create policy "covers are public" on storage.objects for select using (bucket_id = 'vault-covers');
create policy "sellers upload covers to own folder" on storage.objects for insert
  with check (bucket_id = 'vault-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "sellers upload vault files to own folder" on storage.objects for insert
  with check (bucket_id = 'vault-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners and buyers read vault files" on storage.objects for select
  using (
    bucket_id = 'vault-files' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.vaults v
        join public.purchases p on p.vault_id = v.id
        where v.file_path = storage.objects.name and p.buyer_id = auth.uid()
      )
    )
  );
