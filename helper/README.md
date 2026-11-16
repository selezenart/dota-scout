# Captain's Draft Board local helper

Runs on the Dota PC and lets the board's **Setup → Enemy scouting → Detect live lineup** import the ten players of your current match.

## How it works

1. Dota 2 started with `-condebug` writes its console to `…/dota 2 beta/game/dota/console.log`.
2. The helper reads the end of that file and takes the most recent game server id (`[A:1:<account>:<instance>]`, converted to a SteamID64, or a `steamid:9…` / `(9…)` value).
3. It calls the official Steam Web API endpoint
   `GET https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/?key=<key>&server_steam_id=<SteamID64>`.
   The response has `match.matchid` and `teams[]` with `team_number` (2 = Radiant, 3 = Dire) and `players[].accountid`.
4. Your own account comes from Steam's `config/loginusers.vdf` (the `MostRecent` login, or on newer Steam clients the saved account with the newest login `timestamp`), or from `DOTA_ACCOUNT_ID`.
5. It serves `GET http://127.0.0.1:8765/live-roster` as
   `{status: "ready", matchId, accountId, teams: [{side: 2, ids: [5]}, {side: 3, ids: [5]}]}`,
   or `{status: "waiting" | "error", message}` until Valve returns two full teams that include you.

The helper only reads files and calls the Steam Web API. It does not read game memory, hook the game or send anything to Dota.

`GetRealtimeStats` is the only public Steam Web API call that takes a game server id; the other live endpoints (`IDOTA2Match_570/GetLiveLeagueGames`, `GetTopLiveGame`) list league or featured games, not an ordinary lobby.

## Setup

1. Install [Node.js](https://nodejs.org) 20 or newer (LTS).
2. Get a Steam Web API key at <https://steamcommunity.com/dev/apikey> (any domain name works, e.g. `localhost`).
3. Create `helper/steam-key.txt` and paste the key on one line. Git and Vercel ignore this file (`*key*.txt`). Alternatively set the `STEAM_WEB_API_KEY` environment variable. The helper never prints the key.
4. In Steam: Dota 2 → Properties → Launch options → add `-condebug`. Restart Dota.
5. Start the helper and leave its window open:
   - Windows: double-click `helper\start.bat`.
   - macOS/Linux: `./helper/start.sh` (or `node helper/server.mjs`).
6. On the board, take the drafter seat and choose Setup → Enemy scouting → Detect live lineup. Allow the browser's local network prompt if it appears.

## Options (environment variables)

| Variable | Use |
| --- | --- |
| `STEAM_WEB_API_KEY` | Key instead of `steam-key.txt`. |
| `DOTA_CONSOLE_LOG` | Full path to `console.log` when Dota is not in a Steam library the helper can find. |
| `STEAM_PATH` | Steam install folder when it is not in the default place. |
| `DOTA_ACCOUNT_ID` | Your Dota friend ID when several Steam accounts use the PC. |
| `HELPER_ALLOWED_ORIGINS` | Comma-separated site origins allowed to read the roster. Default: `https://captains-draft.vercel.app,http://127.0.0.1:5173`. |

## Security

- Listens on `127.0.0.1:8765` only.
- Only the allowed origins get CORS access; other origins get `403`. Requests with an unexpected `Host` header get `421` (DNS-rebinding guard).
- Requests without an `Origin` header are refused when the browser marks them as coming from another site (`Sec-Fetch-Site`), so other pages cannot spend your Steam key quota with `<img>` or `no-cors` requests.
- Steam errors reach the browser as a generic message; the helper window shows only the HTTP status. After a `403` (bad key) or `429` (rate limit) the helper waits 30 s before asking Steam again for that server.

## Limits

- Valve publishes realtime stats for a server only after the game has been running for a while (community reports say a few minutes), so the lineup may not be available during hero selection. The board keeps polling and offers manual scouting meanwhile.
- The console-log patterns come from public reports of Dota's console and `status` output; they have not been checked against a current Dota client.
