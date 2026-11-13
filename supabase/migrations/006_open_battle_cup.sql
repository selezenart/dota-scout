-- Optional-team signup: one authenticated open lineup per weekly event.
create table public.open_battle_cup_signups (
  event_at timestamptz not null,
  slot smallint not null check (slot between 1 and 6),
  user_id uuid not null references auth.users(id) on delete cascade,
  positions integer[] not null check (
    cardinality(positions) between 1 and 2 and positions <@ array[1,2,3,4,5]
    and array_position(positions,null) is null
    and (cardinality(positions)=1 or positions[1]<>positions[2])
  ),
  updated_at timestamptz not null default now(),
  primary key (event_at,slot),
  unique (event_at,user_id)
);
alter table public.open_battle_cup_signups enable row level security;
revoke all on public.open_battle_cup_signups from public,anon,authenticated;

create function public.get_open_battle_cup()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare event_time timestamptz; entries jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  event_time := public.scout_next_battle_cup();
  select coalesce(jsonb_agg(jsonb_build_object('slot',s.slot,'userId',s.user_id,
    'displayName',coalesce(nullif(p.display_name,''),'Teammate'),'positions',s.positions) order by s.slot),'[]'::jsonb)
    into entries from public.open_battle_cup_signups s left join public.player_profiles p on p.user_id=s.user_id
    where s.event_at=event_time;
  return jsonb_build_object('eventAt',event_time,'signups',entries);
end;
$$;

create function public.save_open_battle_cup(event_time timestamptz,target_slot integer,chosen_positions integer[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Serialize open-lineup reservations, moves and cancellations.
  perform pg_advisory_xact_lock(570, 20261113);
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if event_time is distinct from public.scout_next_battle_cup() then raise exception 'This event has started. Refresh the next Battle Cup.' using errcode='22023'; end if;
  if target_slot is null or target_slot not between 1 and 6 or chosen_positions is null
    or cardinality(chosen_positions) not between 1 and 2
    or array_ndims(chosen_positions)<>1 or array_lower(chosen_positions,1)<>1
    or not chosen_positions <@ array[1,2,3,4,5]
    or array_position(chosen_positions,null) is not null
    or (cardinality(chosen_positions)=2 and chosen_positions[1]=chosen_positions[2]) then
    raise exception 'Choose a slot and one or two distinct positions' using errcode='22023';
  end if;
  if exists(select 1 from public.open_battle_cup_signups where event_at=event_time and slot=target_slot and user_id<>auth.uid()) then
    raise exception 'This slot was just taken. Choose another available slot.' using errcode='23505';
  end if;
  delete from public.open_battle_cup_signups where event_at=event_time and user_id=auth.uid();
  insert into public.open_battle_cup_signups(event_at,slot,user_id,positions) values(event_time,target_slot,auth.uid(),chosen_positions);
  return public.get_open_battle_cup();
end;
$$;

create function public.cancel_open_battle_cup(event_time timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(570, 20261113);
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if event_time is distinct from public.scout_next_battle_cup() then raise exception 'This event has started. Refresh the next Battle Cup.' using errcode='22023'; end if;
  delete from public.open_battle_cup_signups where event_at=event_time and user_id=auth.uid();
  return public.get_open_battle_cup();
end;
$$;
revoke all on function public.get_open_battle_cup(),public.save_open_battle_cup(timestamptz,integer,integer[]),public.cancel_open_battle_cup(timestamptz) from public,anon,authenticated;
grant execute on function public.get_open_battle_cup(),public.save_open_battle_cup(timestamptz,integer,integer[]),public.cancel_open_battle_cup(timestamptz) to authenticated;
