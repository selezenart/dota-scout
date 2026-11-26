-- Removing a teammate also resets the team invite code, so the removed player
-- cannot rejoin with a link they already have. Same body as 009 plus the reset.
create or replace function public.remove_scout_team_member(target_team uuid, target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare captain uuid;
begin
  -- Lock the invite row before the team row: join_scout_team locks team_invites first and then
  -- touches teams through the team_members foreign key, so this order avoids a deadlock.
  perform 1 from public.team_invites where team_id = target_team for update;
  select owner_user_id into captain from public.teams where id = target_team for update;
  if auth.uid() is null or captain is distinct from auth.uid() then
    raise exception 'Only the captain can remove teammates' using errcode = '42501';
  end if;
  if target_user is null or target_user = captain then
    raise exception 'The captain cannot be removed' using errcode = '22023';
  end if;

  -- Release draft authority before revoking membership.
  perform 1 from public.team_drafts where team_id = target_team order by id for update;
  delete from public.team_members where team_id = target_team and user_id = target_user;
  delete from public.battle_cup_signups where team_id = target_team and user_id = target_user;
  update public.team_drafts
    set drafter_user_id = null, revision = revision + 1, updated_at = now()
    where team_id = target_team and drafter_user_id = target_user;

  -- New 64-hex invite code (same format join_scout_team accepts), fresh 30-day expiry.
  update public.team_invites
    set invite_code = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        expires_at = now() + interval '30 days'
    where team_id = target_team;
end;
$$;

revoke all on function public.remove_scout_team_member(uuid,uuid) from public, anon, authenticated;
grant execute on function public.remove_scout_team_member(uuid,uuid) to authenticated;
