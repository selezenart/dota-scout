alter table public.player_profiles add column avatar_hero_id integer
  check (avatar_hero_id between 1 and 10000);

alter table public.teams add column identity_image_id uuid
  references public.team_identity_suggestions(id) on delete set null;

create function public.set_scout_team_identity(target_team uuid, new_name text, image_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.teams where id = target_team and owner_user_id = auth.uid()) then
    raise exception 'Only the team captain can change team identity' using errcode = '42501';
  end if;
  if image_id is not null and not exists (
    select 1 from public.team_identity_suggestions
    where id = image_id and team_id = target_team and image_bytes is not null
  ) then
    raise exception 'Choose an image proposed for this team' using errcode = '22023';
  end if;
  update public.teams set name = trim(new_name), identity_image_id = image_id
  where id = target_team and owner_user_id = auth.uid();
end;
$$;

revoke all on function public.set_scout_team_identity(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.set_scout_team_identity(uuid,text,uuid) to authenticated;
