-- The public catalog list pages by keyset: each sort walks one index in order, with id as the
-- tie-break, so a deep page costs the same as the first. Partial on published rows, which is the
-- only status the list ever shows.
create index if not exists vaults_list_popular_idx on public.vaults (downloads desc, id asc) where status = 'published';
create index if not exists vaults_list_new_idx on public.vaults (created_at desc, id asc) where status = 'published';
create index if not exists vaults_list_top_idx on public.vaults (rating_avg desc, rating_count desc, id asc) where status = 'published';
