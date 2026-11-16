# Captain's Draft Board local helper

Runs on the PC where you play Dota and lets the board's **Setup → Enemy scouting → Detect live lineup** import the ten players of your current match while heroes are being picked.

## How it works

1. Dota 2 started with `-condebug` writes its console to `…/dota 2 beta/game/dota/console.log`. When you join the game server at the start of picks it logs
   `LOBBY STATE RUN: lobby <lobby id>: Player AccountID <you> connecting to MatchID <match id> …`.
2. **Bot account (main source).** The helper signs in a separate Steam account of yours (the "bot") with a saved sign-in token, connects it to the Dota game coordinator, and asks for that lobby with the same request the Dota client uses to find a game to watch (`FindTopSourceTVGames` with `lobby_ids`). The answer lists the ten players with their teams (0 = Radiant, 1 = Dire) and slots. In real matches all ten players came back within seconds of joining, during picks.
   The helper asks only for the lobby in your console log, at most every 10 s until the lineup is complete, and then stops asking for that lobby.
3. **Steam Web API (optional fallback).** With a Steam Web API key the helper also tries
   `GET https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/?server_steam_id=<game server>`.
   Valve answers this only for games it publishes for spectating (top-rated and featured games); ordinary matches get `HTTP 400`.
4. It serves `GET http://127.0.0.1:8765/live-roster` as
   `{status: "ready", matchId, accountId, teams: [{side: 2, ids: [5]}, {side: 3, ids: [5]}]}` (2 = Radiant, 3 = Dire),
   or `{status: "waiting" | "error", message}` until a source returns two full teams that include you.

The helper only reads files, talks to Steam as the bot account, and calls the Steam Web API. It does not read game memory, hook the game or send anything to your Dota client. Your main Steam account is never signed in by the helper.

## Setup

1. Install [Node.js](https://nodejs.org) 20 or newer (LTS).
2. In Steam: Dota 2 → Properties → Launch options → add `-condebug`. Restart Dota.
3. Set up the bot account once, in the `helper` folder:
   ```
   npm ci --ignore-scripts
   npm run bot-login
   ```
   Type the **bot** account's name, password (hidden) and Steam Guard code. The password is not stored; Steam's sign-in token is saved to `helper/bot-login-token.txt` (readable only by your user, ignored by Git and Vercel).
4. Optional: put a Steam Web API key from <https://steamcommunity.com/dev/apikey> on one line in `helper/steam-key.txt`, or set `STEAM_WEB_API_KEY`.
5. Start the helper and leave its window open:
   - Windows: double-click `helper\start.bat`.
   - macOS/Linux: `./helper/start.sh` (or `npm start` in the `helper` folder).
   It should print `Connected to the Dota game coordinator.`
6. On the board, take the drafter seat and choose Setup → Enemy scouting → Detect live lineup. Allow the browser's local network prompt if it appears.

### The bot account

- Use a separate Steam account, never your main one. It needs Dota 2 in its library (free); the helper adds the free license on first sign-in. Limited accounts (no purchases) work.
- An automated client on a Steam account is a grey area under Steam's subscriber agreement. If Valve acts on it, the bot account is what is at risk.
- To sign the bot out for good: delete `bot-login-token.txt`, and on the bot account use Steam Guard → "Deauthorize all other devices" (or change its password).
- If the helper prints `Bot sign-in failed`, run `npm run bot-login` again and restart the helper.

## Options (environment variables)

| Variable | Use |
| --- | --- |
| `STEAM_WEB_API_KEY` | Key instead of `steam-key.txt`. |
| `DOTA_CONSOLE_LOG` | Full path to `console.log` when Dota is not in a Steam library the helper can find. |
| `STEAM_PATH` | Steam install folder when it is not in the default place. |
| `DOTA_ACCOUNT_ID` | Your Dota friend ID for the Steam Web API fallback when several Steam accounts use the PC. The bot source reads your account from the console log. |
| `HELPER_ALLOWED_ORIGINS` | Comma-separated site origins allowed to read the roster. Default: `https://captains-draft-three.vercel.app,http://127.0.0.1:5173`. |

## Security

- Listens on `127.0.0.1:8765` only.
- Only the allowed origins get CORS access; other origins get `403`. Requests with an unexpected `Host` header get `421` (DNS-rebinding guard).
- Requests without an `Origin` header are refused when the browser marks them as coming from another site (`Sec-Fetch-Site`), so other pages cannot make the helper call Steam with `<img>` or `no-cors` requests.
- The Steam key and the bot token are never printed. Steam errors reach the browser as a generic message. After a `403` (bad key) or `429` (rate limit) the helper waits 30 s before asking Steam again for that server.
- Browser requests never trigger more than one coordinator request per 10 s; a complete lineup is answered from memory.

## Limits

- The lineup is available once you are connected to the game server (start of picks), not while the match is being accepted.
- The console-log line and the coordinator message fields were checked against the macOS Dota client in November 2026; a Dota update can change them.
- Players whose profile hides their account appear without an id; the board then asks you to enter the lineup manually.
