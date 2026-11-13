-- Captain's Draft Board. Run as migration owner, never from the browser.
-- Auth identity is auth.uid(); no client-supplied owner/user ID is trusted.
create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  steam_account_id text check (steam_account_id is null or (steam_account_id ~ '^[1-9][0-9]{0,9}$' and steam_account_id::numeric <= 4294967295)),
  preferred_roles integer[] not null default '{}',
  role_comfort jsonb not null default '{}',
  signature_heroes integer[] not null default '{}',
  desired_heroes integer[] not null default '{}',
  avoid_heroes integer[] not null default '{}',
  availability text not null default 'available' check (availability in ('available','maybe','unavailable')),
  notes text not null default '' check (char_length(notes) <= 500),
  updated_at timestamptz not null default now()
);
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  owner_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id,user_id)
);
create index if not exists team_members_user_idx on public.team_members(user_id,team_id);
create table if not exists public.team_invites (
  team_id uuid primary key references public.teams(id) on delete cascade,
  invite_code text not null unique default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz
);
create table if not exists public.team_drafts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  status text not null default 'active' check (status in ('active','completed','archived')),
  revision integer not null default 1 check (revision > 0),
  drafter_user_id uuid references auth.users(id) on delete set null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_drafts_team_idx on public.team_drafts(team_id,updated_at desc);

-- Internal helpers are pure or fixed-search-path definers. No dynamic SQL.
create or replace function public.scout_valid_ids(items integer[], max_count integer, max_id integer)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select items is not null and cardinality(items) <= max_count
    and not exists (select 1 from unnest(items) x where x is null or x < 1 or x > max_id)
    and cardinality(items) = (select count(distinct x) from unnest(items) x);
$$;
create or replace function public.scout_valid_role_comfort(value jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare item record;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for item in select * from jsonb_each(value) loop
    if item.key !~ '^[1-5]$' or jsonb_typeof(item.value) <> 'number'
      or item.value::text !~ '^[0-5]$' then return false; end if;
  end loop;
  return true;
end $$;
alter table public.player_profiles drop constraint if exists scout_profile_arrays;
alter table public.player_profiles add constraint scout_profile_arrays check (
  public.scout_valid_ids(preferred_roles,5,5)
  and public.scout_valid_ids(signature_heroes,20,1000)
  and public.scout_valid_ids(desired_heroes,20,1000)
  and public.scout_valid_ids(avoid_heroes,50,1000)
  and public.scout_valid_role_comfort(role_comfort)
);

create or replace function public.scout_is_member(target_team uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_members where team_id=target_team and user_id=auth.uid()
  );
$$;
create or replace function public.scout_is_owner(target_team uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.teams where id=target_team and owner_user_id=auth.uid()
  );
$$;
create or replace function public.scout_can_read_profile(target_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (target_user=auth.uid() or exists (
    select 1 from public.team_members mine join public.team_members theirs using(team_id)
    where mine.user_id=auth.uid() and theirs.user_id=target_user
  ));
$$;

alter table public.player_profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.team_drafts enable row level security;
drop policy if exists profile_read on public.player_profiles;
create policy profile_read on public.player_profiles for select to authenticated using(public.scout_can_read_profile(user_id));
drop policy if exists profile_insert on public.player_profiles;
create policy profile_insert on public.player_profiles for insert to authenticated with check(user_id=auth.uid());
drop policy if exists profile_update on public.player_profiles;
create policy profile_update on public.player_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists team_read on public.teams;
create policy team_read on public.teams for select to authenticated using(public.scout_is_member(id));
drop policy if exists members_read on public.team_members;
create policy members_read on public.team_members for select to authenticated using(public.scout_is_member(team_id));
drop policy if exists invite_read on public.team_invites;
create policy invite_read on public.team_invites for select to authenticated using(public.scout_is_owner(team_id));
drop policy if exists draft_read on public.team_drafts;
create policy draft_read on public.team_drafts for select to authenticated using(public.scout_is_member(team_id));
revoke all on public.player_profiles,public.teams,public.team_members,public.team_invites,public.team_drafts from anon,authenticated;
grant select,insert,update on public.player_profiles to authenticated;
grant select on public.teams,public.team_members,public.team_invites,public.team_drafts to authenticated;

create or replace function public.create_scout_team(team_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.teams; token text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.teams(name,owner_user_id) values(trim(team_name),auth.uid()) returning * into t;
  insert into public.team_members(team_id,user_id) values(t.id,auth.uid());
  insert into public.team_invites(team_id) values(t.id) returning invite_code into token;
  return to_jsonb(t) || jsonb_build_object('invite_code',token);
end $$;
create or replace function public.list_my_teams()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) || case when t.owner_user_id=auth.uid()
    then jsonb_build_object('invite_code',i.invite_code,'invite_expires_at',i.expires_at)
    else '{}'::jsonb end order by t.created_at), '[]'::jsonb)
  from public.teams t join public.team_members m on m.team_id=t.id and m.user_id=auth.uid()
  left join public.team_invites i on i.team_id=t.id and i.revoked_at is null;
$$;
create or replace function public.join_scout_team(invite_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid; t public.teams;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if invite_token is null or invite_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid or expired invite' using errcode='22023'; end if;
  select team_id into target from public.team_invites where invite_code=invite_token and revoked_at is null and expires_at>now() for update;
  if target is null then raise exception 'Invalid or expired invite' using errcode='22023'; end if;
  insert into public.team_members(team_id,user_id) values(target,auth.uid()) on conflict do nothing;
  select * into t from public.teams where id=target;
  return to_jsonb(t);
end $$;
create or replace function public.load_team_roster(target_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not public.scout_is_member(target_team) then raise exception 'Team membership required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(coalesce(to_jsonb(p),'{}'::jsonb) || jsonb_build_object('user_id',m.user_id) order by m.joined_at),'[]'::jsonb)
  into result from public.team_members m left join public.player_profiles p on p.user_id=m.user_id where m.team_id=target_team;
  return result;
end $$;

create or replace function public.scout_validate_draft(candidate jsonb)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare a jsonb; hero integer; seen integer[] := '{}'; idx integer:=0; expected text; first_ours boolean;
  assigned_players text[] := '{}';
  roster_players text[] := '{}';
  member jsonb;
  member_id text;
  assigned_positions integer[] := '{}';
  -- A starts; adopt the match-verified 24-action order.
  sequence text[] := array['AB','AB','BB','BB','AB','BB','BB','AP','BP','AB','AB','BB','BP','AP','AP','BP','BP','AP','AB','BB','AB','BB','AP','BP'];
  key text;
begin
  if candidate is null or jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>65536
    or jsonb_typeof(candidate->'actions') is distinct from 'array'
    or jsonb_typeof(candidate->'firstPick') is distinct from 'boolean'
    or jsonb_typeof(candidate->'enemyIds') is distinct from 'array' then
    raise exception 'Invalid draft state' using errcode='22023';
  end if;
  for key in select jsonb_object_keys(candidate) loop
    if key not in ('actions','firstPick','enemyIds','roster','assignments','modelVersion','source') then raise exception 'Unknown draft state field' using errcode='22023'; end if;
  end loop;
  if jsonb_array_length(candidate->'actions')>24 or jsonb_array_length(candidate->'enemyIds')>5 then raise exception 'Draft list exceeds limit' using errcode='22023'; end if;
  for a in select value from jsonb_array_elements(candidate->'enemyIds') loop
    if jsonb_typeof(a) not in ('string','number') or (a #>> '{}') !~ '^[1-9][0-9]{0,9}$' or (a #>> '{}')::numeric>4294967295 then raise exception 'Invalid opponent account ID' using errcode='22023'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements_text(candidate->'enemyIds')) <> (select count(distinct value) from jsonb_array_elements_text(candidate->'enemyIds')) then raise exception 'Duplicate opponent' using errcode='22023'; end if;
  if candidate ? 'roster' then
    if jsonb_typeof(candidate->'roster')<>'array' then raise exception 'Invalid roster' using errcode='22023'; end if;
    if jsonb_array_length(candidate->'roster')>5 then raise exception 'Roster exceeds five players' using errcode='22023'; end if;
    for member in select value from jsonb_array_elements(candidate->'roster') loop
      if jsonb_typeof(member) is distinct from 'object'
        or jsonb_typeof(member->'id') is distinct from 'string'
        or char_length(trim(member->>'id')) not between 1 and 80 then
        raise exception 'Invalid roster player' using errcode='22023';
      end if;
      member_id:=member->>'id';
      if member_id=any(roster_players) then raise exception 'Duplicate roster player' using errcode='22023'; end if;
      roster_players:=array_append(roster_players,member_id);
      -- A shared roster is a preference snapshot, not externally supplied scouting data.
      if member ? 'sources' or member ? 'profile' or member ? 'heroes' or member ? 'recent' or member ? 'matches' then
        raise exception 'Scouting data cannot be stored in roster snapshots' using errcode='22023';
      end if;
      if member ? 'selfReport' and jsonb_typeof(member->'selfReport') is distinct from 'object' then
        raise exception 'Invalid roster preferences' using errcode='22023';
      end if;
    end loop;
  end if;
  if candidate ? 'assignments' and jsonb_typeof(candidate->'assignments')<>'object' then raise exception 'Invalid assignments' using errcode='22023'; end if;
  first_ours := (candidate->>'firstPick')::boolean;
  for a in select value from jsonb_array_elements(candidate->'actions') loop
    idx:=idx+1;
    if jsonb_typeof(a)<>'object' or jsonb_typeof(a->'heroId') is distinct from 'number' or (a->>'heroId') !~ '^[1-9][0-9]{0,3}$' then raise exception 'Invalid draft hero' using errcode='22023'; end if;
    hero:=(a->>'heroId')::integer;
    if hero>1000 or hero=any(seen) then raise exception 'Duplicate or invalid draft hero' using errcode='22023'; end if;
    seen:=array_append(seen,hero);
    expected:=(case when (left(sequence[idx],1)='A')=first_ours then 'our' else 'enemy' end) || (case when right(sequence[idx],1)='P' then 'Pick' else 'Ban' end);
    if a->>'mode' is distinct from expected then raise exception 'Action does not match current draft turn' using errcode='22023'; end if;
    if a ? 'position' and (jsonb_typeof(a->'position') is distinct from 'number' or (a->>'position') !~ '^[1-5]$') then raise exception 'Invalid action position' using errcode='22023'; end if;
    if a ? 'playerId' and (jsonb_typeof(a->'playerId')<>'string' or char_length(trim(a->>'playerId')) not between 1 and 80) then raise exception 'Invalid action player' using errcode='22023'; end if;
    if expected <> 'ourPick' and (a ? 'position' or a ? 'playerId') then
      raise exception 'Only allied picks can carry player or position assignments' using errcode='22023';
    end if;
    if a ? 'playerId' then
      if not ((a->>'playerId')=any(roster_players)) then raise exception 'Assigned player must belong to roster' using errcode='22023'; end if;
      if (a->>'playerId')=any(assigned_players) then raise exception 'Duplicate player assignment' using errcode='22023'; end if;
      assigned_players:=array_append(assigned_players,a->>'playerId');
    end if;
    if a ? 'position' then
      if (a->>'position')::integer=any(assigned_positions) then raise exception 'Duplicate position assignment' using errcode='22023'; end if;
      assigned_positions:=array_append(assigned_positions,(a->>'position')::integer);
    end if;
    for key in select jsonb_object_keys(a) loop
      if key not in ('heroId','mode','playerId','position') then raise exception 'Unknown action field' using errcode='22023'; end if;
    end loop;
  end loop;
end $$;

create or replace function public.create_team_draft(target_team uuid, initial_state jsonb default '{"actions":[],"firstPick":true,"enemyIds":[]}')
returns public.team_drafts language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.team_drafts;
begin
  if not public.scout_is_member(target_team) then raise exception 'Team membership required' using errcode='42501'; end if;
  perform public.scout_validate_draft(initial_state);
  insert into public.team_drafts(team_id,drafter_user_id,state,status) values(target_team,auth.uid(),initial_state,case when jsonb_array_length(initial_state->'actions')=24 then 'completed' else 'active' end) returning * into d;
  return d;
end $$;
create or replace function public.mutate_team_draft(draft_id uuid, expected_revision integer, operation text, payload jsonb default '{}')
returns public.team_drafts language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.team_drafts; owner boolean; target_user uuid; next_state jsonb; key text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into d from public.team_drafts where id=draft_id for update;
  if not found or not public.scout_is_member(d.team_id) then raise exception 'Draft unavailable' using errcode='42501'; end if;
  if expected_revision is null or d.revision<>expected_revision then raise exception 'Draft revision conflict; reload current draft' using errcode='PT409'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid operation payload' using errcode='22023'; end if;
  owner:=public.scout_is_owner(d.team_id); next_state:=d.state;
  case operation
  when 'claim' then
    if d.drafter_user_id is not null then raise exception 'Another teammate is already drafter' using errcode='42501'; end if;
    d.drafter_user_id:=auth.uid();
  when 'release' then
    if not owner and d.drafter_user_id is distinct from auth.uid() then raise exception 'Only the drafter or owner may release control' using errcode='42501'; end if;
    d.drafter_user_id:=null;
  when 'assign' then
    if not owner then raise exception 'Only team owner may assign control' using errcode='42501'; end if;
    target_user:=(payload->>'userId')::uuid;
    if target_user is null or not exists(select 1 from public.team_members where team_id=d.team_id and user_id=target_user) then raise exception 'Target must be an active teammate' using errcode='22023'; end if;
    d.drafter_user_id:=target_user;
  when 'append','undo','reset','set_state' then
    if d.drafter_user_id is distinct from auth.uid() then raise exception 'Only the current drafter may change this draft' using errcode='42501'; end if;
    case operation
    when 'append' then next_state:=jsonb_set(next_state,'{actions}',(next_state->'actions') || jsonb_build_array(payload));
    when 'undo' then
      if jsonb_array_length(next_state->'actions')=0 then raise exception 'Draft is already empty' using errcode='22023'; end if;
      next_state:=jsonb_set(next_state,'{actions}',(next_state->'actions') - (jsonb_array_length(next_state->'actions')-1));
    when 'reset' then next_state:=next_state || '{"actions":[],"assignments":{}}'::jsonb;
    when 'set_state' then
      for key in select jsonb_object_keys(payload) loop
        if key not in ('firstPick','enemyIds','roster','assignments','modelVersion','source') then raise exception 'State field cannot be patched' using errcode='22023'; end if;
      end loop;
      if payload ? 'firstPick' and payload->'firstPick' is distinct from next_state->'firstPick' and jsonb_array_length(next_state->'actions')>0 then raise exception 'Reset draft before changing first pick' using errcode='22023'; end if;
      next_state:=next_state || payload;
    end case;
  else raise exception 'Unknown draft operation' using errcode='22023';
  end case;
  perform public.scout_validate_draft(next_state);
  update public.team_drafts set state=next_state,drafter_user_id=d.drafter_user_id,revision=d.revision+1,updated_at=now(),status=case when jsonb_array_length(next_state->'actions')=24 then 'completed' else 'active' end where id=d.id returning * into d;
  return d;
end $$;

-- No implicit PUBLIC execute grants on definer entry points or helpers.
revoke all on function public.scout_valid_ids(integer[],integer,integer),public.scout_valid_role_comfort(jsonb),public.scout_validate_draft(jsonb),public.scout_is_member(uuid),public.scout_is_owner(uuid),public.scout_can_read_profile(uuid),public.create_scout_team(text),public.list_my_teams(),public.join_scout_team(text),public.load_team_roster(uuid),public.create_team_draft(uuid,jsonb),public.mutate_team_draft(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.scout_valid_ids(integer[],integer,integer),public.scout_valid_role_comfort(jsonb),public.scout_is_member(uuid),public.scout_is_owner(uuid),public.scout_can_read_profile(uuid),public.create_scout_team(text),public.list_my_teams(),public.join_scout_team(text),public.load_team_roster(uuid),public.create_team_draft(uuid,jsonb),public.mutate_team_draft(uuid,integer,text,jsonb) to authenticated;
