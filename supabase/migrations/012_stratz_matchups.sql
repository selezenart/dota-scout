-- Divine/Immortal hero matchups from STRATZ, refreshed once a day by the
-- server-side job api/stratz-refresh.js (service role). STRATZ lets a token be
-- used from only two IP addresses per 15 minutes, so the board never calls
-- STRATZ directly: it reads this public, read-only table through /api/stratz.
create table public.stratz_matchups (
  hero_id smallint primary key check (hero_id between 1 and 1000),
  vs jsonb not null check (jsonb_typeof(vs) = 'array'),
  "with" jsonb not null check (jsonb_typeof("with") = 'array'),
  updated_at timestamptz not null default now()
);
alter table public.stratz_matchups enable row level security;
revoke all on public.stratz_matchups from public, anon, authenticated;
grant select on public.stratz_matchups to anon, authenticated;
grant select, insert, update on public.stratz_matchups to service_role;
create policy "STRATZ matchups are public" on public.stratz_matchups
  for select to anon, authenticated using (true);
