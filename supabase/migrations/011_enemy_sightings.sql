-- Heroes enemy accounts played against this team, recorded by the team itself
-- after its own games (manually, or later by the local helper). Closed accounts
-- are included because the team saw them in its own match. Visible only to
-- members of that team.
create table public.scout_enemy_sightings (
  team_id uuid not null references public.teams(id) on delete cascade,
  source_key text not null check (source_key ~ '^(draft:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|match:[1-9][0-9]{0,10})$'),
  account_id bigint not null check (account_id between 1 and 4294967295),
  hero_id integer not null check (hero_id between 1 and 1000),
  source text not null default 'manual' check (source in ('manual','helper')),
  enemy_won boolean,
  recorded_by uuid references auth.users(id) on delete set null default auth.uid(),
  seen_at timestamptz not null default now(),
  primary key (team_id, source_key, account_id)
);
create index scout_enemy_sightings_recent on public.scout_enemy_sightings(team_id, seen_at desc);
alter table public.scout_enemy_sightings enable row level security;
revoke all on public.scout_enemy_sightings from public, anon, authenticated;

-- Replaces the entries of one game (draft or match) so a corrected assignment
-- does not add duplicates.
create function public.record_enemy_sightings(target_team uuid, game_key text, entries jsonb, entry_source text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare entry jsonb; account text; hero text;
begin
  if auth.uid() is null or not public.scout_is_member(target_team) then
    raise exception 'Team membership required' using errcode = '42501';
  end if;
  if coalesce(entry_source, 'manual') not in ('manual','helper') then raise exception 'Invalid source' using errcode = '22023'; end if;
  if game_key is null or game_key !~ '^(draft:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|match:[1-9][0-9]{0,10})$' then
    raise exception 'Invalid game key' using errcode = '22023';
  end if;
  if entries is null or jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 5 then
    raise exception 'Invalid sightings' using errcode = '22023';
  end if;
  for entry in select value from jsonb_array_elements(entries) loop
    account := entry->>'accountId'; hero := entry->>'heroId';
    if jsonb_typeof(entry) <> 'object' or account is null or account !~ '^[1-9][0-9]{0,9}$' or account::numeric > 4294967295
      or hero is null or hero !~ '^[1-9][0-9]{0,3}$' or hero::integer > 1000
      or (entry ? 'enemyWon' and jsonb_typeof(entry->'enemyWon') not in ('boolean','null')) then
      raise exception 'Invalid sighting' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct value->>'accountId') from jsonb_array_elements(entries)) <> jsonb_array_length(entries) then
    raise exception 'Each enemy account can be assigned once' using errcode = '22023';
  end if;
  delete from public.scout_enemy_sightings where team_id = target_team and source_key = game_key;
  insert into public.scout_enemy_sightings(team_id, source_key, account_id, hero_id, source, enemy_won)
  select target_team, game_key, (value->>'accountId')::bigint, (value->>'heroId')::integer, coalesce(entry_source, 'manual'),
    case when jsonb_typeof(value->'enemyWon') = 'boolean' then (value->>'enemyWon')::boolean end
  from jsonb_array_elements(entries);
  -- Keep each team's list bounded.
  delete from public.scout_enemy_sightings s
  where s.team_id = target_team and (s.source_key, s.account_id) in (
    select source_key, account_id from public.scout_enemy_sightings where team_id = target_team
    order by seen_at desc offset 2000);
end;
$$;

create function public.list_enemy_sightings(target_team uuid)
returns table(source_key text, account_id bigint, hero_id integer, source text, enemy_won boolean, seen_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.source_key, s.account_id, s.hero_id, s.source, s.enemy_won, s.seen_at
  from public.scout_enemy_sightings s
  where s.team_id = target_team and auth.uid() is not null and public.scout_is_member(target_team)
  order by s.seen_at desc limit 2000;
$$;

revoke all on function public.record_enemy_sightings(uuid,text,jsonb,text), public.list_enemy_sightings(uuid) from public, anon, authenticated;
grant execute on function public.record_enemy_sightings(uuid,text,jsonb,text), public.list_enemy_sightings(uuid) to authenticated;
