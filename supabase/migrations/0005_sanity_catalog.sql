-- The vault catalog (listings + note contents) moves to Sanity. Supabase keeps auth,
-- purchases, orders, reviews and MCP tokens. Vault ids are now Sanity document ids (text).

-- Postgres refuses to retype a column a policy references, so every policy that mentions
-- vault_id goes first; the ones still wanted are recreated against the text column below.
drop policy if exists "buyers see own purchases" on public.purchases;
drop policy if exists "buyers review what they own" on public.reviews;
drop policy if exists "owners and buyers read vault files" on storage.objects;
drop policy if exists "sellers upload vault files to own folder" on storage.objects;

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
create policy "buyers see own purchases" on public.purchases for select using (buyer_id = auth.uid());

-- Reviews stay in Supabase, so buyers keep the right to review what they bought.
create policy "buyers review what they own" on public.reviews for insert
  with check (user_id = auth.uid() and exists (select 1 from public.purchases where vault_id = reviews.vault_id and buyer_id = auth.uid()));

-- The vault-files bucket is no longer used (zips are built from Sanity); its policies were
-- dropped above and are deliberately not recreated.

drop table if exists public.vaults cascade;
drop type if exists public.vault_status;
