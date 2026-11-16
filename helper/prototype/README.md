# Prototype: live lobby players from the Dota game coordinator

Question it answers: can a **separate** Steam account get the ten players of your live match from the
Dota game coordinator during picks? The Steam Web API (`GetRealtimeStats`) returns data only for top/watched
games, so ordinary pubs need another official source.

How it works:

1. Signs in a separate Steam account with [`steam-user`](https://github.com/DoctorMcKay/node-steam-user).
   You type the account name, password and Steam Guard code once in the terminal. The password is not stored;
   Steam's sign-in token is saved in `bot-login-token.txt` here (Git and Vercel ignore it).
2. Launches Dota for that account at the protocol level (no game client) and says hello to the coordinator.
3. Reads the lobby id from the `LOBBY STATE RUN: lobby …` line that Dota writes to `console.log`
   (launch Dota with `-condebug`) when you join the game server at the start of picks.
4. Every 10 s sends `k_EMsgClientToGCFindTopSourceTVGames` (8009) with `lobby_ids` — the request the client uses
   to find a game to watch — and prints counts and timing only: number of players, how many have an account id,
   whether you are listed, game time and spectator delay. It prints no account ids, names or tokens.

It does not touch your main account, the Dota client or its memory.

## Run

```bash
cd helper/prototype
npm install
npm start
```

Use the bot account, not your main account. Do not play Dota on the bot account while this runs.
Queue a match on your main account; watch the output during picks. Press Ctrl+C to stop.
Delete `bot-login-token.txt` to sign the bot out permanently.
