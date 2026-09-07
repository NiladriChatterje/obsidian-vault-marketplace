-- Personal access tokens for the MCP endpoint served by the Next.js site (web/app/api/mcp).
-- One token per user; only the SHA-256 hash is stored. Looked up with the service role key.
create table if not exists public.mcp_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

alter table public.mcp_tokens enable row level security;

create policy "users manage own mcp token" on public.mcp_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
