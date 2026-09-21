-- Plugin-only delivery: a seller may hand a vault over through the Obsidian plugin instead of
-- as a zip. The zip is still stored and still scanned; what changes is that
-- GET /vaults/:id/download-link refuses to issue a link for anyone but the seller.
--
-- It is friction, not prevention: the notes still land on the buyer's disk and they can zip the
-- folder themselves. What it removes is the ready-made artefact sitting in a Downloads folder,
-- which is the thing that actually gets reposted. Traceability is the other half, and needs no
-- column: the per-buyer fingerprint the sync path stamps into notes is derived (an HMAC over
-- vault + buyer, see server/src/fingerprint.ts), never stored.
--
-- Default false, so every listing that exists today behaves exactly as it did.
--
-- Apply with: supabase db push, or paste into the SQL editor (after 0019).

alter table public.vaults add column if not exists plugin_only boolean not null default false;

comment on column public.vaults.plugin_only is 'Deliver through the Obsidian plugin only; no zip download link is issued to buyers.';
