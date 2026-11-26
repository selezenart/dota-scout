-- Captains can delete their team; other members can leave it.
-- Team-owned rows (members, invites, drafts, Battle Cup signups, identity
-- suggestions, enemy scouting) are removed by their ON DELETE CASCADE keys.
create or replace function public.delete_scout_team(target_team uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare captain uuid;
begin
  select owner_user_id into captain from public.teams where id = target_team for update;
  if auth.uid() is null or captain is null or captain is distinct from auth.uid() then
    raise exception 'Only the captain can delete this team' using errcode = '42501';
  end if;
  delete from public.teams where id = target_team;
end;
$$;

create or replace function public.leave_scout_team(target_team uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare captain uuid; me uuid := auth.uid();
begin
  select owner_user_id into captain from public.teams where id = target_team for update;
  if me is null or captain is null
     or not exists (select 1 from public.team_members where team_id = target_team and user_id = me) then
    raise exception 'You are not a member of this team' using errcode = '42501';
  end if;
  if captain = me then
    raise exception 'The captain cannot leave; delete the team instead' using errcode = '22023';
  end if;

  -- Release draft authority before revoking membership (same order as remove_scout_team_member).
  perform 1 from public.team_drafts where team_id = target_team order by id for update;
  delete from public.team_members where team_id = target_team and user_id = me;
  delete from public.battle_cup_signups where team_id = target_team and user_id = me;
  update public.team_drafts
    set drafter_user_id = null, revision = revision + 1, updated_at = now()
    where team_id = target_team and drafter_user_id = me;
end;
$$;

revoke all on function public.delete_scout_team(uuid), public.leave_scout_team(uuid) from public, anon, authenticated;
grant execute on function public.delete_scout_team(uuid), public.leave_scout_team(uuid) to authenticated;
