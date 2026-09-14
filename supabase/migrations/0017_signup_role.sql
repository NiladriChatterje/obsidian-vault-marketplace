-- Someone can say at sign-up whether they are here to buy or to sell.
--
-- The choice travels in the auth metadata as `role`, the same way the username does, so the
-- profile is created already knowing it. Setting is_seller afterwards from the client would
-- not work for the common case: with email confirmation on there is no session until the
-- link is clicked, so there is nothing to make the update with.
--
-- Anything other than 'seller' is a buyer, which is what the column defaulted to before.

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

  insert into public.profiles (id, username, display_name, is_seller)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data->>'display_name', candidate),
    coalesce(new.raw_user_meta_data->>'role', 'buyer') = 'seller'
  );
  return new;
end $$;
