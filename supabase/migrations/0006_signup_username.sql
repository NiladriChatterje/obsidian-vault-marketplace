-- Fix the profile-creation trigger for real sign-ups.
--
-- 0001 built the fallback username from the raw `base` string instead of the sanitised
-- `candidate`, so as soon as a name was taken the next attempt could carry characters the
-- username check constraint rejects: an address like john+tag@example.com whose "johntag"
-- was already in use produced 'john+tag1', the insert raised, and the whole sign-up failed
-- with "Database error saving new user" — the account is created in auth.users but has no
-- profile, so the person cannot sign in and cannot sign up again with that address either.
--
-- This version sanitises once, suffixes the sanitised stem, keeps the result inside the
-- 24-character limit, and gives up on a unique id rather than looping forever.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  raw text := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), ''));
  stem text := regexp_replace(raw, '[^a-z0-9_.]', '', 'g');
  candidate text;
  suffix int := 0;
begin
  if length(stem) < 3 then
    stem := 'user' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  stem := substr(stem, 1, 24);
  candidate := stem;

  -- Someone has the name already: append a counter, trimming the stem so the result still fits.
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    if suffix > 50 then
      candidate := 'user' || substr(replace(new.id::text, '-', ''), 1, 8);
      exit;
    end if;
    candidate := substr(stem, 1, 24 - length(suffix::text)) || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, coalesce(new.raw_user_meta_data->>'display_name', candidate));
  return new;
end $$;
