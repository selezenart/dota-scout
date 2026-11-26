# Captain's Draft Board

A shared drafting board for Dota 2 Captain's Mode teams. The team's drafter runs the draft on one board while teammates follow it live; recommendations come from each player's hero preferences and public match data.

Live site: <https://captains-board.vercel.app>

## How to use it

1. **Sign in.** Use *Continue with Steam*, *Continue with Google* or an email and password. Each method creates its own account, so sign in the same way every time. No account? *Practice locally* runs everything on this device.
2. **Set up your profile.** Enter a display name and, optionally, your Dotabuff/OpenDota player link, SteamID64 or Dota account ID. *Import public stats* suggests signature heroes from your last 180 days of public matches. Pick your roles and today's heroes, then *Save profile*. Steam accounts fill in the account ID automatically.
3. **Create or join a team.** From your player home choose *Create or join a team*. The owner copies the *Team invite link* (it expires) and sends it privately. Teammates open it, sign in and accept. Owners can remove members or delete the team; members can leave.
4. **Draft.** *Open draft board*. One player takes the drafter seat and makes the bans and picks; everyone else follows live. Click a hero or a recommendation, then confirm *Ban* or *Pick*. Enemy actions are entered by hand. Keyboard: type to search, Enter stages the first hero, Escape clears, Ctrl+Z undoes. The owner can release or reclaim the seat.
5. **Scout the enemy.** Use *Add enemy* with an account ID or player link, or let the [local helper](#live-lineup-during-picks) import both teams once picks start.
6. **Battle Cup.** *Battle Cup* in the top bar (or `?cup`) books one of five main spots or the replacement for the next Saturday 20:00 Kyiv.

Try it without an account: `?demo` (invented players), `?onboarding-demo` (invitation and profile walkthrough), `?demo&cup` (Battle Cup booking).

## What you can do

- **Teams:** create a team, invite teammates with a private link, and keep each player's roles and heroes for today.
- **Shared drafts:** one drafter controls bans and picks; everyone else follows in real time. Seats can be released, reclaimed or handed over.
- **Recommendations:** suggested bans and picks with visible reasons, based on your roster's preferences, the current meta (OpenDota hero stats) and Divine/Immortal counters and synergy from STRATZ, refreshed daily. They are heuristics, not win probabilities.
- **Enemy scouting:** enter enemy players by hand, or let the [local helper](#live-lineup-during-picks) import both teams while heroes are being picked.
- **Battle Cup signup:** book a main or replacement spot for the weekly Battle Cup.
- **Practice and demo:** `?practice` runs a local draft without an account; `?demo` uses invented players.

## Live lineup during picks

The optional helper runs on the computer where you play Dota. It reads Dota's console log to find your lobby and asks Dota's servers, through a separate bot Steam account, for the ten players. The board then imports both teams and starts scouting the enemy.

Player guide (setup, daily use, troubleshooting): **[docs/live-lineup.md](docs/live-lineup.md)**
Technical reference: [helper/README.md](helper/README.md)

## Development

Requires Node.js 22+ (the helper alone needs 20+).

```sh
npm ci
npm run dev     # http://127.0.0.1:5173
npm test
npm run build   # Vite build + upload allowlist check
```

Without `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the shell environment the app runs in local practice mode (`.env` files are ignored). Steam sign-in does not work on localhost or preview URLs. Hosting, Supabase migrations, sign-in providers and deployment: [README-HOSTED.md](README-HOSTED.md).

## Project layout

| Path | Contents |
| --- | --- |
| `web/` | The board (static front end, bundled by Vite). |
| `api/` | Vercel functions: public configuration, Steam sign-in, STRATZ matchups and their daily refresh. |
| `supabase/migrations/` | Database schema and row-level security. |
| `helper/` | Local live-lineup helper (Node.js, runs on the player's computer, never deployed). |
| `tests/` | `node --test` suites, including jsdom draft flows and helper tests. |
| `scripts/safety.mjs` | Build check that only allowlisted files are uploaded to Vercel. |
