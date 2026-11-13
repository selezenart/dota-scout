create table public.team_identity_suggestions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  proposed_name text check (char_length(trim(proposed_name)) between 1 and 80),
  image_mime text,
  image_bytes bytea,
  created_at timestamptz not null default now(),
  check (proposed_name is not null or image_bytes is not null),
  check ((image_mime is null) = (image_bytes is null)),
  check (image_bytes is null or (
    octet_length(image_bytes) between 12 and 524288 and (
      (image_mime = 'image/png' and substring(image_bytes for 8) = decode('89504e470d0a1a0a','hex'))
      or (image_mime = 'image/jpeg' and substring(image_bytes for 3) = decode('ffd8ff','hex'))
      or (image_mime = 'image/webp' and substring(image_bytes for 4) = convert_to('RIFF','UTF8')
        and substring(image_bytes from 9 for 4) = convert_to('WEBP','UTF8'))
    )
  ))
);
alter table public.team_identity_suggestions enable row level security;
revoke all on public.team_identity_suggestions from public, anon, authenticated;

create function public.suggest_team_identity(target_team uuid, suggestion text, mime text, encoded_image text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare suggestion_id uuid;
begin
  if auth.uid() is null or not public.scout_is_member(target_team) then
    raise exception 'Team membership required' using errcode = '42501';
  end if;
  if length(encoded_image) > 699052 then raise exception 'Image must be 512 KB or smaller'; end if;
  insert into public.team_identity_suggestions(team_id, proposed_name, image_mime, image_bytes)
  values(target_team, nullif(trim(suggestion),''), mime, decode(encoded_image,'base64'))
  returning id into suggestion_id;
  return suggestion_id;
end;
$$;

create function public.list_team_identity(target_team uuid)
returns table(id uuid, proposed_name text, image_mime text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.proposed_name, s.image_mime
  from public.team_identity_suggestions s
  where s.team_id = target_team and auth.uid() is not null and public.scout_is_member(target_team)
  order by s.created_at desc limit 50;
$$;

-- The unlisted link exposes only the proposed image.
create function public.get_team_identity_image(image_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('mime',image_mime,'data',encode(image_bytes,'base64'))
  from public.team_identity_suggestions where id = image_id and image_bytes is not null;
$$;

revoke all on function public.suggest_team_identity(uuid,text,text,text), public.list_team_identity(uuid), public.get_team_identity_image(uuid) from public, anon, authenticated;
grant execute on function public.suggest_team_identity(uuid,text,text,text), public.list_team_identity(uuid) to authenticated;
grant execute on function public.get_team_identity_image(uuid) to anon, authenticated;
