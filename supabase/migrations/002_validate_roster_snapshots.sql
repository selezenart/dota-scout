-- Validate preference snapshots before accepting shared draft updates.
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

