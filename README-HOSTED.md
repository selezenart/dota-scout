# Hosted Captain's Draft Board

Run Node 22+ and `npm install`, then:

```sh
npm run dev
npm run build
npm test
```

Dev binds http://127.0.0.1:5173. The production build contains only `dist/index.html` and bundled assets. The build validates the output and Vercel upload allowlists. No browser automation or deployment is performed by these commands.

With no public configuration the app runs as **local practice**: manual scouting, editable preferences, roster import, explicit drafter seat and a manually controlled draft. `?demo` (or `?mock`) starts an empty draft with clearly invented player fixtures. Demo has no backend writes. Practice persistence uses a separate local storage key; authenticated team/profile state is never saved into the public OpenDota cache.

Use `?onboarding-demo` to try a teammate’s invitation, account creation, email confirmation, team join and profile setup with sample data. The demo also shows the resulting profiles from the captain’s perspective.

Immediately after the invitation, the walkthrough accepts a Dotabuff/OpenDota player link, numeric Steam profile URL, SteamID64 or Dota account ID. Import loads public data from OpenDota and suggests signature heroes from the last 180 days of recorded hero totals. Players review these suggestions and choose their role and today’s hero preferences. Sample and manual options remain available. Steam vanity URLs require a numeric ID. Registration and joining in this walkthrough remain simulated.

For shared teams, apply the migrations in `supabase/migrations/` to your Supabase project (see *Database migrations* below). Configure email confirmation and password recovery redirect URLs for the deployed origin. Set these environment variables in the launching shell or Vercel project settings:

- `SUPABASE_URL`: HTTPS project origin.
- `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`: public publishable key or anon-role JWT.

Never use a service-role key. `/api/config` returns only validated public configuration. Vite disables env-file loading; its dev middleware uses the running process environment. Production uses `api/config.js`. The Vercel upload allowlist excludes local keys, environment files, helper scripts, videos, logs and unrelated source files. Upload/build from this project with the supplied Vercel configuration; do not publish the legacy root as static content.

Open Setup to create a team. As its owner, copy the team invite link and share it privately with teammates. They can open it, create an account or sign in, accept the invitation, and fill in their draft preferences. On the same browser, the invitation carries through email confirmation. If they confirm on another device, they can reopen the original invitation there after signing in.

Select a team, create/list a draft or join with its UUID. Copy session links include only the draft UUID; recipients still require team membership. The owner can release a seat or reclaim it. Members explicitly Become drafter; the server confirms control before editing is enabled. Polling refreshes the draft every three seconds and refreshes team roster data periodically. Draft roster preferences are a snapshot; the drafter uses Refresh draft roster snapshot to replace it explicitly. Select up to five roster members in Setup; available members are initially selected. Duplicate public account IDs must be resolved before snapshot creation or refresh.

Click a hero or recommendation to stage it, then use the explicit Ban/Pick confirmation. Allied picks allow player/position overrides. Typing outside controls searches heroes; Enter stages the first visible hero, Escape clears, Ctrl+Z undoes while you control the draft. Reset requires confirmation. Enemy actions are entered manually. OpenDota evidence and per-source timestamps/status are shown in Team; missing/private data is not treated as observed evidence. Recommendations are heuristics, not win probabilities. Notes remain plain text.

Public OpenDota requests are coalesced, capped at two concurrent requests and 45 starts/minute, with rate-limit retries and bounded public-only caching. Bundled `web/heroes.json` is the offline OpenDota constants snapshot. Hero portraits need network access. Shared mutations use the adapter's atomic expected revision; errors refetch current state and require a fresh deliberate action. Failed mutations are never replayed automatically.

Legacy live/replay remains at the explicit http://localhost:8765 link after launching the existing local helper. Hosted mode makes no automatic helper/console requests. Hosted demo remains manual; legacy fast/mock/replay controls belong to the legacy page.

Verification includes queue/backoff/partial-data tests, action validation, a full manually driven 24-action jsdom test, and mocked shared ownership/conflict/signout tests. Real Supabase email/auth, RLS, concurrency across two real users and deployed browser behavior must still be verified against the configured project; mocked tests do not establish database authorization.


## Battle Cup signup

Open Battle Cup in the workspace navigation or visit `?cup`. Select a team, then choose one of five main spots or the replacement spot and one or two position preferences. You can update or cancel your own signup. The page advances to the next Saturday at 20:00 Kyiv time once the current event starts.

Try the booking flow locally with `?demo&cup`. Sample reservations reset when the page reloads. Shared signup requires applying `supabase/migrations/003_battle_cup_signups.sql` to the existing Supabase project before publishing the frontend.

## Live roster detection

Start the local helper on the Dota PC (`helper/start.bat` on Windows, `helper/start.sh` on macOS/Linux). Enable `-condebug` in Dota launch options. Once, in the `helper` folder, run `npm ci --ignore-scripts` and `npm run bot-login` to sign in a separate bot Steam account; the helper then asks the Dota game coordinator for your lobby's ten players as soon as picks start. A Steam Web API key in `helper/steam-key.txt` is an optional fallback that only covers games Valve publishes for spectating. The bot token and key files are ignored by Git and Vercel. Full setup, options and the bot account's risks: [helper/README.md](helper/README.md). On Captain’s Draft Board, take the drafter seat and choose Setup → Enemy scouting → Detect live lineup. Allow the browser’s local network prompt if it appears. The board waits for a match confirmed by Valve and ten distinct accounts, identifies your side from the current match's console log, then imports the roster and starts public scouting. Saved teammate preferences are matched by Dota account ID. You can stop detection at any time. Manual scouting is available if Valve has not returned the lineup.

Team members can submit name and image proposals from Team after applying `supabase/migrations/004_team_identity_suggestions.sql`. Image links are unlisted and downloadable by anyone who has the URL. Allow the deployed `/?cup` URL in the Supabase Auth redirect settings for email confirmation.

### Steam registration

Apply `supabase/migrations/005_steam_sign_in.sql`. Configure server-only `SUPABASE_SERVICE_ROLE_KEY`, `STEAM_AUTH_ORIGIN` (the exact HTTPS origin of that deployment, without a trailing slash: production and the develop Preview each set their own), and a stable random `STEAM_AUTH_SECRET` of at least 32 characters in Vercel. Preserve the Steam auth secret across deployments because it is used to derive Steam account identifiers. The button appears only when server configuration is present. Steam OpenID does not use the scouting API key or send confirmation email. Existing email accounts and new Steam accounts are separate.


### Optional team and public profile import

Apply `supabase/migrations/006_open_battle_cup.sql` after 003 to enable the authenticated open lineup (five main places and one replacement). Team selection is optional. Existing team signups stay separate; switching lineups does not move or cancel a reservation. The open lineup shows display names and position preferences to signed-in players.

Profile now supports public OpenDota import: a new Steam profile loads suggestions when opened; existing profiles can use **Import public stats**. Suggested signatures are based on the last 180 days, editable, and saved only with **Save profile**. Existing signature selections and Today wishes are preserved. Private/unavailable data can be entered manually.

Preview `?demo&cup&profile` for the profile and close it to try booking and next-step cards. Sample data is local; it does not test Steam or database authorization.


### Google sign-in

The Google button appears on sign-in, registration and invitation screens. Its availability is read from the Supabase public Auth settings; until the Google provider is enabled it stays disabled with an explanation.

With `GOOGLE_CLIENT_ID` set in Vercel, the board signs in with Google directly (ID token, state and hashed nonce) and hands the token to Supabase (`signInWithIdToken`), so Google's consent screen shows the board's own address. Setup per environment:

- Google Cloud OAuth web client: add each site origin with a trailing slash (for example `https://captains-board.vercel.app/`) as an authorized redirect URI, and keep `https://<project>.supabase.co/auth/v1/callback` for the fallback.
- Supabase Authentication -> Providers -> Google: enable it and enter the same client ID and secret. The secret stays in Supabase only.
- Vercel: `GOOGLE_CLIENT_ID` for Production and for the develop Preview, then redeploy.

Without `GOOGLE_CLIENT_ID` the button falls back to Supabase's own Google redirect. Each origin, plus `/?cup`, must be allowed in Supabase Auth redirect URLs.

Profile import now seeds an empty Today list from signatures as an editable starting point. Existing Today selections remain unchanged. Selected heroes stay first in the picker grid when not searching, even if they do not match the preferred-role suggestion filter. Search still filters by name.

Google logo source: https://developers.google.com/static/identity/images/g-logo.png (official Google Identity branding asset).

### STRATZ counters

Divine/Immortal counters and synergy come from STRATZ. A STRATZ token works from only two IP addresses per 15 minutes, so board requests never call STRATZ. Instead `api/stratz-refresh.js` runs once a day (Vercel Schedules in `vercel.json`: production 04:00 UTC, preview 16:00 UTC) and stores every hero's matchups in `public.stratz_matchups` (migration 012). `api/stratz.js` reads them with the public anon key. Server-only Vercel variables for the refresh: `STRATZ_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`. Keep the STRATZ credit shown on the board.

### Build-time configuration

`npm run build` inlines the public configuration (Supabase URL, anon key and sign-in flags) into the bundle, so a signed-in reload goes straight to the team without waiting for `/api/config`. After changing `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `GOOGLE_CLIENT_ID`, redeploy. Steam and Google availability is still refreshed from `/api/config` in the background.

## Database migrations

Migrations live in `supabase/migrations/NNN_name.sql` and are applied with the Supabase CLI (`brew install supabase/tap/supabase`, one-time `supabase login`). The remote `supabase_migrations.schema_migrations` table records which versions each project already has, so `db push` only runs new files.

Always name the target project explicitly, develop first:

```bash
supabase db push --remote=defwtxxathsewjmuggpm --dry-run   # develop: shows what would run
supabase db push --remote=defwtxxathsewjmuggpm
```

Prod only at release time, before merging `develop` into `main`:

```bash
supabase db push --remote=cxawsjcmqajdyhrjrypn --dry-run   # prod
supabase db push --remote=cxawsjcmqajdyhrjrypn
```

Rules:
- New migration = new file with the next number (`015_…sql`). Never edit an applied migration; add a new one.
- Use `--include-all` only when an older-numbered file is intentionally still pending.
- Never pass `--include-seed` or `--include-roles` to a remote project.
- Never run `supabase config push`: `supabase/config.jsonc` holds local-development defaults and would overwrite hosted auth settings (redirect URLs, providers). Hosted settings are managed in the Supabase dashboard.
