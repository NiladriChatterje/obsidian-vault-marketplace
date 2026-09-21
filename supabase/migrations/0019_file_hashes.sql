-- Content hashes, so the Obsidian plugin can update a vault in place instead of re-downloading it.
--
-- The plugin keeps, per installed vault, the hash of every file as the seller shipped it (the
-- "base"). On an update it compares three hashes per path — base, what is on disk now, and what
-- the seller publishes today — and only overwrites files the buyer never touched. Without a hash
-- on the row the server would have to read every object out of the vault store to answer a
-- manifest; with it the manifest is one index scan.
--
-- Nullable on purpose: bundles ingested before this ran have no hash, and
-- catalog.vaultManifest() computes those from the store on demand. New uploads fill it in.
--
-- Apply with: supabase db push, or paste into the SQL editor (after 0018).

alter table public.notes add column if not exists hash text;
alter table public.attachments add column if not exists hash text;

comment on column public.notes.hash is 'sha256 hex of the stored body; the plugin''s three-way merge compares against it.';
comment on column public.attachments.hash is 'sha256 hex of the stored bytes; see notes.hash.';
