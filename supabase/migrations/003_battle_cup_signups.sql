-- Team Battle Cup attendance. Apply locally first, then deploy manually.
create table public.battle_cup_signups (
  team_id uuid not null references public.teams(id) on delete cascade,
  event_at timestamptz not null,
  slot smallint not null check (slot between 1 and 6),
  user_id uuid not null references auth.users(id) on delete cascade,
  positions integer[] not null check (
    cardinality(positions) between 1 and 2 and positions <@ array[1,2,3,4,5]
    and array_position(positions,null) is null
    and (cardinality(positions)=1 or positions[1]<>positions[2])
  ),
  updated_at timestamptz not null default now(),
  primary key (team_id,event_at,slot),
  unique (team_id,event_at,user_id)
);
alter table public.battle_cup_signups enable row level security;
revoke all on public.battle_cup_signups from public,anon,authenticated;

create function public.scout_next_battle_cup()
returns timestamptz language plpgsql stable set search_path=public,pg_temp as $$
declare local_event timestamp;
begin
  local_event := date_trunc('week',now() at time zone 'Europe/Kyiv') + interval '5 days 20 hours';
  if local_event <= now() at time zone 'Europe/Kyiv' then local_event := local_event + interval '7 days'; end if;
  return local_event at time zone 'Europe/Kyiv';
end;
$$;

create function public.get_battle_cup(target_team uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare event_time timestamptz; entries jsonb;
begin
  if auth.uid() is null or not public.scout_is_member(target_team) then raise exception 'Team membership required' using errcode='42501'; end if;
  event_time := public.scout_next_battle_cup();
  select coalesce(jsonb_agg(jsonb_build_object('slot',s.slot,'userId',s.user_id,
    'displayName',coalesce(nullif(p.display_name,''),'Teammate'),'positions',s.positions) order by s.slot),'[]'::jsonb)
    into entries from public.battle_cup_signups s left join public.player_profiles p on p.user_id=s.user_id
    where s.team_id=target_team and s.event_at=event_time;
  return jsonb_build_object('eventAt',event_time,'signups',entries);
end;
$$;

create function public.save_battle_cup(target_team uuid,event_time timestamptz,target_slot integer,chosen_positions integer[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- A team row lock serializes reservations, moves, and cancellations.
  perform 1 from public.teams where id=target_team for update;
  if auth.uid() is null or not public.scout_is_member(target_team) then raise exception 'Team membership required' using errcode='42501'; end if;
  if event_time is distinct from public.scout_next_battle_cup() then raise exception 'This event has started. Refresh the next Battle Cup.' using errcode='22023'; end if;
  if target_slot is null or target_slot not between 1 and 6 or chosen_positions is null
    or cardinality(chosen_positions) not between 1 and 2
    or array_ndims(chosen_positions)<>1
    or not chosen_positions <@ array[1,2,3,4,5]
    or array_position(chosen_positions,null) is not null
    or (cardinality(chosen_positions)=2 and chosen_positions[1]=chosen_positions[2]) then
    raise exception 'Choose a slot and one or two distinct positions' using errcode='22023';
  end if;
  if exists(select 1 from public.battle_cup_signups where team_id=target_team and event_at=event_time and slot=target_slot and user_id<>auth.uid()) then
    raise exception 'This slot was just taken. Choose another available slot.' using errcode='23505';
  end if;
  delete from public.battle_cup_signups where team_id=target_team and event_at=event_time and user_id=auth.uid();
  insert into public.battle_cup_signups(team_id,event_at,slot,user_id,positions) values(target_team,event_time,target_slot,auth.uid(),chosen_positions);
  return public.get_battle_cup(target_team);
end;
$$;

create function public.cancel_battle_cup(target_team uuid,event_time timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.teams where id=target_team for update;
  if auth.uid() is null or not public.scout_is_member(target_team) then raise exception 'Team membership required' using errcode='42501'; end if;
  if event_time is distinct from public.scout_next_battle_cup() then raise exception 'This event has started. Refresh the next Battle Cup.' using errcode='22023'; end if;
  delete from public.battle_cup_signups where team_id=target_team and event_at=event_time and user_id=auth.uid();
  return public.get_battle_cup(target_team);
end;
$$;
revoke all on function public.scout_next_battle_cup(),public.get_battle_cup(uuid),public.save_battle_cup(uuid,timestamptz,integer,integer[]),public.cancel_battle_cup(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_battle_cup(uuid),public.save_battle_cup(uuid,timestamptz,integer,integer[]),public.cancel_battle_cup(uuid,timestamptz) to authenticated;
