-- Catching a vault that was bought, lightly edited and re-listed by someone who did not write it.
--
-- notes.hash (0019) is the sha256 of the bytes as shipped, which the plugin's merge needs, but a
-- single whitespace change defeats it. text_hash is the sha256 of the note *normalised*: no
-- frontmatter, no zero-width characters (our own fingerprint included), NFKC-folded, lowercased,
-- with everything that is not a letter or digit removed. A reflow, a formatter pass, a renamed
-- heading or a retyped frontmatter block all hash the same; only rewriting the prose changes it.
--
-- The check is per note, not per vault: "78% of these notes are already in vault X" catches the
-- repack that a whole-bundle hash misses. Ingest asks catalog_bundle_overlap once, with every
-- normalised hash in one array, and gets back the listings of *other* sellers that share them.
-- One statement, one index scan per hash, nothing per note from the worker.
--
-- Nullable like 0019: bundles ingested before this ran carry no text_hash and are not matched
-- against. New uploads fill it in.
--
-- Apply with: supabase db push, or paste into the SQL editor (after 0020).

alter table public.notes add column if not exists text_hash text;

comment on column public.notes.text_hash is 'sha256 hex of the normalised body (no frontmatter, zero-width chars, case, whitespace or punctuation); null for notes too short to be meaningful. Re-upload detection compares these.';

create index if not exists notes_text_hash_idx on public.notes (text_hash) where text_hash is not null;

-- Listings by other sellers that already contain these notes, most overlap first. Only bundles
-- attached to a listing count: an upload nobody saved is not a product anyone could have copied.
create or replace function public.catalog_bundle_overlap(p_uploader uuid, p_hashes text[], p_limit integer default 3)
returns table (vault_id text, title text, seller_id uuid, matched integer)
language sql stable security definer set search_path = public as $$
  select v.id, v.title, v.seller_id, count(distinct n.text_hash)::integer as matched
  from public.notes n
  join public.bundles b on b.id = n.bundle and b.vault_id is not null
  join public.vaults v on v.id = b.vault_id and v.bundle = b.id
  where n.text_hash = any(p_hashes) and v.seller_id <> p_uploader
  group by v.id
  order by matched desc
  limit p_limit;
$$;
