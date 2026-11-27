-- Team invite links expire after 30 days. Let the captain renew the link: a new invite code
-- (the old link stops working) and a fresh 30-day expiry. Returns the same keys list_my_teams uses.
create or replace function public.renew_scout_team_invite(target_team uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare captain uuid; new_code text; new_expiry timestamptz;
begin
  -- Plain ownership check first so non-captains never take a row lock.
  select owner_user_id into captain from public.teams where id = target_team;
  if auth.uid() is null or captain is null or captain is distinct from auth.uid() then
    raise exception 'Only the captain can renew the team invite link' using errcode = '42501';
  end if;

  -- Same lock order as remove_scout_team_member (014): invite row, then team row.
  perform 1 from public.team_invites where team_id = target_team for update;
  select owner_user_id into captain from public.teams where id = target_team for update;
  if captain is null or captain is distinct from auth.uid() then
    raise exception 'Only the captain can renew the team invite link' using errcode = '42501';
  end if;

  -- New 64-hex invite code (same format join_scout_team accepts), fresh 30-day expiry.
  update public.team_invites
    set invite_code = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        expires_at = now() + interval '30 days'
    where team_id = target_team and revoked_at is null
    returning invite_code, expires_at into new_code, new_expiry;
  if new_code is null then
    raise exception 'This team has no active invite link' using errcode = 'P0002';
  end if;
  return jsonb_build_object('invite_code', new_code, 'invite_expires_at', new_expiry);
end;
$$;

revoke all on function public.renew_scout_team_invite(uuid) from public, anon, authenticated;
grant execute on function public.renew_scout_team_invite(uuid) to authenticated;
