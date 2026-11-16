# Captain's Draft Board

A shared drafting board for Dota 2 Captain's Mode teams. The team's drafter runs the draft on one board while teammates follow it live; recommendations come from each player's hero preferences and public match data.

Live site: <https://captains-draft-three.vercel.app>

## What you can do

- **Teams:** create a team, invite teammates with a private link, and keep each player's roles and heroes for today.
- **Shared drafts:** one drafter controls bans and picks; everyone else follows in real time. Seats can be released, reclaimed or handed over.
- **Recommendations:** suggested bans and picks with visible reasons, based on your roster's preferences and public OpenDota data. They are heuristics, not win probabilities.
- **Enemy scouting:** enter enemy players by hand, or let the [local helper](#live-lineup-during-picks) import both teams while heroes are being picked.
- **Battle Cup signup:** book a main or replacement spot for the weekly Battle Cup.
- **Practice and demo:** `?practice` runs a local draft without an account; `?demo` uses invented players.

## Live lineup during picks

The optional helper runs on the computer where you play Dota. It reads Dota's console log to find your lobby and asks Dota's servers, through a separate bot Steam account, for the ten players. The board then imports both teams and starts scouting the enemy.

Player guide (setup, daily use, troubleshooting): **[docs/live-lineup.md](docs/live-lineup.md)**
Technical reference: [helper/README.md](helper/README.md)

## Development

Requires Node.js 22+.

```sh
npm install
npm run dev     # http://127.0.0.1:5173
npm test
npm run build
```

Without Supabase configuration the app runs in local practice mode. Hosting, Supabase migrations, sign-in providers and deployment: [README-HOSTED.md](README-HOSTED.md).

## Project layout

| Path | Contents |
| --- | --- |
| `web/` | The board (static front end, bundled by Vite). |
| `api/` | Vercel functions: public configuration and Steam sign-in. |
| `supabase/migrations/` | Database schema and row-level security. |
| `helper/` | Local live-lineup helper (Node.js, runs on the player's computer, never deployed). |
| `tests/` | `node --test` suites, including jsdom draft flows and helper tests. |
| `scripts/safety.mjs` | Build check that only allowlisted files are uploaded to Vercel. |
