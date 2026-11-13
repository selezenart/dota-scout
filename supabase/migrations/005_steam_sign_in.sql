create table public.steam_auth_nonces (
  nonce text primary key,
  expires_at timestamptz not null default now() + interval '20 minutes'
);
alter table public.steam_auth_nonces enable row level security;
revoke all on public.steam_auth_nonces from public, anon, authenticated;

create function public.consume_steam_auth_nonce(assertion_nonce text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.steam_auth_nonces where expires_at < now();
  insert into public.steam_auth_nonces(nonce) values (assertion_nonce) on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.consume_steam_auth_nonce(text) from public, anon, authenticated;
grant execute on function public.consume_steam_auth_nonce(text) to service_role;
