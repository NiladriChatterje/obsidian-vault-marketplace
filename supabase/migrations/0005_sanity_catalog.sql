-- The vault catalog (listings + note contents) moves to Sanity. Supabase keeps auth,
-- purchases, orders, reviews and MCP tokens. Vault ids are now Sanity document ids (text).

-- purchases / orders / reviews: text vault ids, no FK to the dropped vaults table
alter table public.purchases drop constraint if exists purchases_vault_id_fkey;
alter table public.purchases alter column vault_id type text using vault_id::text;

alter table public.orders drop constraint if exists orders_vault_id_fkey;
alter table public.orders alter column vault_id type text using vault_id::text;

alter table public.reviews drop constraint if exists reviews_vault_id_fkey;
alter table public.reviews alter column vault_id type text using vault_id::text;

-- Functions that depended on public.vaults. Access and free claims are now decided by the
-- payment server (it reads Sanity with the service role / token); ratings are pushed to Sanity too.
drop trigger if exists reviews_refresh on public.reviews;
drop function if exists public.refresh_vault_rating();
drop function if exists public.has_vault_access(uuid);
drop function if exists public.claim_free_vault(uuid);
drop function if exists public.increment_downloads(uuid);
drop function if exists public.seller_stats();

-- Buyers still see their own purchases; sellers get sales through the server.
drop policy if exists "buyers see own purchases" on public.purchases;
create policy "buyers see own purchases" on public.purchases for select using (buyer_id = auth.uid());

-- Storage policies that joined vaults; the vault-files bucket is no longer used (zips are built from Sanity).
drop policy if exists "owners and buyers read vault files" on storage.objects;
drop policy if exists "sellers upload vault files to own folder" on storage.objects;

drop table if exists public.vaults cascade;
drop type if exists public.vault_status;
