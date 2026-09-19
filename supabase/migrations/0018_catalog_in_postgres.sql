-- The vault catalog comes home to Postgres. Listings, the note index and the seller's storage
-- plan live here beside purchases and reviews; note bodies, attachments, covers and the
-- scanned zip itself live in the vault store (an S3 bucket, see server/src/vault-store.ts).
-- Sanity is gone: it was holding 7.5M note documents at the target scale, which no plan of
-- theirs sells, and the rating had to be copied across every time a review landed.
--
-- Vault ids stay text: purchases, orders and reviews already carry text ids since 0005, and a
-- new id is a uuid without dashes. No foreign key is added from those tables back to vaults on
-- purpose. A vault can be deleted while its purchases remain (insights tolerates a missing
-- vault), and older rows may point at ids from the Sanity days.
--
-- Apply with: supabase db push, or paste into the SQL editor. 0016 is folded in below.

-- ---------- listings ----------
do $$ begin
  create type public.vault_status as enum ('draft', 'published', 'unlisted');
exception when duplicate_object then null; end $$;

create table if not exists public.vaults (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null,
  title text not null check (length(title) between 3 and 80),
  tagline text not null default '',
  description text not null default '',
  category text not null,
  tags text[] not null default '{}',
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'INR',
  -- Object key of the cover in the vault store, e.g. covers/<uuid>.jpg. Null = no cover.
  cover_key text,
  screenshots text[] not null default '{}',
  plugins text[] not null default '{}',
  -- The upload whose files make up this vault; see bundles below. Null until one is attached.
  bundle text,
  note_count integer not null default 0,
  size_bytes bigint not null default 0,
  version text not null default '1.0',
  -- Path of the note buyers should open first, e.g. "Home.md".
  entry_note text,
  status public.vault_status not null default 'draft',
  downloads integer not null default 0,
  rating_avg numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_needs_notes check (status <> 'published' or note_count > 0)
);

create index if not exists vaults_seller_idx on public.vaults (seller_id, updated_at desc);
create index if not exists vaults_status_category_idx on public.vaults (status, category);
create index if not exists vaults_tags_idx on public.vaults using gin (tags);
-- The public list pages by keyset: each sort walks one index in order, with id as the tie-break,
-- so a deep page costs the same as the first. Partial on published rows, the only status listed.
create index if not exists vaults_list_popular_idx on public.vaults (downloads desc, id asc) where status = 'published';
create index if not exists vaults_list_new_idx on public.vaults (created_at desc, id asc) where status = 'published';
create index if not exists vaults_list_top_idx on public.vaults (rating_avg desc, rating_count desc, id asc) where status = 'published';

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists vaults_touch on public.vaults;
create trigger vaults_touch before update on public.vaults for each row execute function public.touch_updated_at();

-- ---------- uploads: a bundle is one unpacked zip ----------
-- Uploaded before the listing exists, then attached when it is saved, so a row with a null
-- vault_id is an upload nobody saved. The worker sweeps those after a couple of days.
create table if not exists public.bundles (
  id text primary key,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  vault_id text references public.vaults(id) on delete set null,
  note_count integer not null default 0,
  attachment_count integer not null default 0,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists bundles_vault_idx on public.bundles (vault_id);
create index if not exists bundles_unattached_idx on public.bundles (created_at) where vault_id is null;

-- One markdown file: everything about it but the body, which is in the store at bundles/<id>/<path>.
create table if not exists public.notes (
  bundle text not null references public.bundles(id) on delete cascade,
  path text not null,
  title text not null,
  folder text not null default '',
  frontmatter jsonb not null default '{}',
  tags text[] not null default '{}',
  links text[] not null default '{}',
  -- Readable before purchase.
  is_preview boolean not null default false,
  size_bytes integer not null default 0,
  position integer not null default 0,
  primary key (bundle, path)
);

create table if not exists public.attachments (
  bundle text not null references public.bundles(id) on delete cascade,
  path text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes integer not null default 0,
  primary key (bundle, path)
);

-- ---------- storage plans ----------
-- What a seller is entitled to, never what they use: usage is summed from their vaults so the
-- two cannot drift. No row means the free plan, which is most sellers.
create table if not exists public.seller_plans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus', 'pro')),
  quota_bytes bigint not null,
  -- Dodo's id for the subscription behind a paid plan, once plans are sold.
  provider_subscription_id text,
  -- After this the plan has lapsed and the seller is back on free.
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- rating: kept on the listing by trigger, so no sync route is needed ----------
create or replace function public.refresh_vault_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text := coalesce(new.vault_id, old.vault_id);
begin
  update public.vaults set
    rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.reviews where vault_id = v), 0),
    rating_count = (select count(*) from public.reviews where vault_id = v)
  where id = v;
  return null;
end $$;

drop trigger if exists reviews_refresh on public.reviews;
create trigger reviews_refresh after insert or update or delete on public.reviews
  for each row execute function public.refresh_vault_rating();

-- ---------- functions the server calls (service role) ----------

-- Recomputes a listing's rating on demand. Idempotent; the trigger normally keeps it current.
create or replace function public.catalog_refresh_rating(p_vault_id text)
returns table (rating_avg numeric, rating_count integer)
language plpgsql security definer set search_path = public as $$
begin
  update public.vaults v set
    rating_avg = coalesce((select round(avg(r.rating)::numeric, 2) from public.reviews r where r.vault_id = p_vault_id), 0),
    rating_count = (select count(*) from public.reviews r where r.vault_id = p_vault_id)
  where v.id = p_vault_id;
  return query select v.rating_avg, v.rating_count from public.vaults v where v.id = p_vault_id;
end $$;

create or replace function public.catalog_increment_downloads(p_vault_id text)
returns void language sql security definer set search_path = public as $$
  update public.vaults set downloads = downloads + 1 where id = p_vault_id;
$$;

-- What a seller's listings occupy. p_exclude is the listing a replacement zip is about to
-- overwrite, whose current size is freed by saving it.
create or replace function public.catalog_seller_storage(p_seller uuid, p_exclude text default null)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(size_bytes), 0)::bigint from public.vaults
  where seller_id = p_seller and (p_exclude is null or id <> p_exclude);
$$;

-- Points a bundle at a vault, detaches whatever the vault had before, refreshes the counts.
-- Returns the ids of the bundles it replaced, whose objects the caller then deletes from the
-- store; their rows are already gone (cascade).
create or replace function public.catalog_attach_bundle(p_vault_id text, p_bundle text)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  b public.bundles%rowtype;
  v public.vaults%rowtype;
  stale text[];
  entry text;
begin
  select * into b from public.bundles where id = p_bundle;
  if not found or b.note_count = 0 then raise exception 'That upload has no files. Upload the zip again.'; end if;
  select * into v from public.vaults where id = p_vault_id;
  if not found then raise exception 'Listing not found'; end if;
  if b.uploader_id <> v.seller_id then raise exception 'That upload belongs to someone else'; end if;
  if b.vault_id is not null and b.vault_id <> p_vault_id then raise exception 'That upload is already attached to another listing'; end if;

  select coalesce(array_agg(id), '{}') into stale from public.bundles where vault_id = p_vault_id and id <> p_bundle;
  delete from public.bundles where id = any(stale);
  update public.bundles set vault_id = p_vault_id where id = p_bundle;

  -- The note buyers open first. One the seller named wins if the bundle has it; otherwise the
  -- most welcoming of the preview notes, "Start Here" before "Home" before "index" before "README".
  select path into entry from public.notes
  where bundle = p_bundle and is_preview
  order by case lower(path) when 'start here.md' then 0 when 'home.md' then 1 when 'index.md' then 2 else 3 end, path
  limit 1;
  update public.vaults set
    bundle = p_bundle,
    note_count = b.note_count,
    size_bytes = b.size_bytes,
    entry_note = case
      when v.entry_note is not null and exists (select 1 from public.notes n where n.bundle = p_bundle and n.path = v.entry_note) then v.entry_note
      else coalesce(entry, v.entry_note)
    end
  where id = p_vault_id;
  return stale;
end $$;

-- The public list, one keyset page. p_cursor is {"values": [...], "id": "..."}: the sort keys of
-- the row the previous page ended on, then its id. Each sort reads one of the partial indexes.
create or replace function public.catalog_list_vaults(
  p_sort text,
  p_limit integer,
  p_category text default null,
  p_search text default null,
  p_featured boolean default false,
  p_free boolean default false,
  p_cursor jsonb default null
)
returns setof public.vaults language plpgsql stable security definer set search_path = public as $$
declare
  q text := 'select * from public.vaults where status = ''published''';
  ord text;
  needle text := nullif(trim(coalesce(p_search, '')), '');
  cid text := p_cursor->>'id';
begin
  if p_category is not null then q := q || ' and category = ' || quote_literal(p_category); end if;
  if p_featured then q := q || ' and featured'; end if;
  if p_free then q := q || ' and price_cents = 0'; end if;
  if needle is not null then
    q := q || format(
      ' and (title ilike %1$L or tagline ilike %1$L or %2$L = any(tags) or exists (select 1 from unnest(plugins) pl where lower(pl) = %2$L))',
      '%' || needle || '%', lower(needle));
  end if;

  case p_sort
    when 'new' then
      ord := 'created_at desc, id asc';
      if p_cursor is not null then
        q := q || format(' and (created_at < %1$L::timestamptz or (created_at = %1$L::timestamptz and id > %2$L))', p_cursor->'values'->>0, cid);
      end if;
    when 'top' then
      ord := 'rating_avg desc, rating_count desc, id asc';
      if p_cursor is not null then
        q := q || format(
          ' and (rating_avg < %1$s or (rating_avg = %1$s and (rating_count < %2$s or (rating_count = %2$s and id > %3$L))))',
          (p_cursor->'values'->>0)::numeric, (p_cursor->'values'->>1)::integer, cid);
      end if;
    else
      ord := 'downloads desc, id asc';
      if p_cursor is not null then
        q := q || format(' and (downloads < %1$s or (downloads = %1$s and id > %2$L))', (p_cursor->'values'->>0)::integer, cid);
      end if;
  end case;

  return query execute q || ' order by ' || ord || ' limit ' || greatest(1, least(p_limit, 101));
end $$;

-- Uploads nobody saved, older than p_days. The worker deletes their objects, then these rows.
create or replace function public.catalog_stale_bundles(p_days integer default 2)
returns setof text language sql stable security definer set search_path = public as $$
  select id from public.bundles where vault_id is null and created_at < now() - make_interval(days => p_days);
$$;

-- ---------- row level security ----------
-- The server reads and writes everything with the service role. Browsers read listings
-- through the server too, so the only direct policies are the harmless public ones.
alter table public.vaults enable row level security;
alter table public.bundles enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;
alter table public.seller_plans enable row level security;

drop policy if exists "published vaults are public" on public.vaults;
create policy "published vaults are public" on public.vaults for select
  using (status = 'published' or seller_id = auth.uid());

drop policy if exists "sellers see own plan" on public.seller_plans;
create policy "sellers see own plan" on public.seller_plans for select using (user_id = auth.uid());
-- bundles, notes, attachments: no policies, so nothing but the service role can touch them.
