create or replace function public.preview_scout_team_invite(invite_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.name
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  where invite_token ~ '^[a-f0-9]{64}$'
    and i.invite_code = invite_token
    and i.revoked_at is null
    and i.expires_at > now();
$$;

revoke all on function public.preview_scout_team_invite(text) from public;
grant execute on function public.preview_scout_team_invite(text) to anon, authenticated;
