-- Battle Cup matches a team pasted to scout an opponent. Summaries come from
-- public OpenDota data (closed players stay anonymous) and are visible only to
-- members of the team that saved them.
create table public.scout_enemy_matches (
  team_id uuid not null references public.teams(id) on delete cascade,
  match_id bigint not null check (match_id > 0 and match_id < 100000000000),
  enemy_side text check (enemy_side in ('radiant','dire')),
  context_enemy_ids text[] not null default '{}' check (cardinality(context_enemy_ids) <= 5),
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 8192),
  added_by uuid references auth.users(id) on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (team_id, match_id)
);
create index scout_enemy_matches_recent on public.scout_enemy_matches(team_id, added_at desc);
alter table public.scout_enemy_matches enable row level security;
revoke all on public.scout_enemy_matches from public, anon, authenticated;

create function public.save_enemy_match(target_team uuid, target_match bigint, match_summary jsonb, side text, context_ids text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare id text;
begin
  if auth.uid() is null or not public.scout_is_member(target_team) then
    raise exception 'Team membership required' using errcode = '42501';
  end if;
  if side is not null and side not in ('radiant','dire') then raise exception 'Invalid side' using errcode = '22023'; end if;
  foreach id in array coalesce(context_ids, '{}') loop
    if id is null or id !~ '^[1-9][0-9]{0,9}$' or id::numeric > 4294967295 then raise exception 'Invalid opponent account ID' using errcode = '22023'; end if;
  end loop;
  insert into public.scout_enemy_matches(team_id, match_id, summary, enemy_side, context_enemy_ids)
  values (target_team, target_match, match_summary, side, coalesce(context_ids, '{}'))
  on conflict (team_id, match_id) do update
    set summary = excluded.summary,
        enemy_side = coalesce(excluded.enemy_side, public.scout_enemy_matches.enemy_side),
        context_enemy_ids = excluded.context_enemy_ids,
        added_at = now();
  -- Keep each team's list bounded: drop the oldest beyond 200 (all of them are listed).
  delete from public.scout_enemy_matches m
  where m.team_id = target_team and m.match_id in (
    select match_id from public.scout_enemy_matches where team_id = target_team
    order by added_at desc offset 200);
end;
$$;

create function public.set_enemy_match_side(target_team uuid, target_match bigint, side text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.scout_is_member(target_team) then
    raise exception 'Team membership required' using errcode = '42501';
  end if;
  if side is not null and side not in ('radiant','dire') then raise exception 'Invalid side' using errcode = '22023'; end if;
  update public.scout_enemy_matches set enemy_side = side where team_id = target_team and match_id = target_match;
end;
$$;

create function public.list_enemy_matches(target_team uuid)
returns table(match_id bigint, enemy_side text, context_enemy_ids text[], summary jsonb, added_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.match_id, m.enemy_side, m.context_enemy_ids, m.summary, m.added_at
  from public.scout_enemy_matches m
  where m.team_id = target_team and auth.uid() is not null and public.scout_is_member(target_team)
  order by m.added_at desc limit 200;
$$;

revoke all on function public.save_enemy_match(uuid,bigint,jsonb,text,text[]), public.set_enemy_match_side(uuid,bigint,text), public.list_enemy_matches(uuid) from public, anon, authenticated;
grant execute on function public.save_enemy_match(uuid,bigint,jsonb,text,text[]), public.set_enemy_match_side(uuid,bigint,text), public.list_enemy_matches(uuid) to authenticated;
