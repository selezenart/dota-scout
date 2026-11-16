# Live lineup: player guide

With the helper running on the computer where you play Dota, Captain's Draft Board fills in both teams of your match **while heroes are being picked** and starts scouting the enemy players.

You set it up once (about 10 minutes). After that it is two steps per gaming session: start the helper, click **Detect live lineup**.

## What you need

- The computer you play Dota on (macOS or Windows).
- [Node.js](https://nodejs.org) 20 or newer, the "LTS" download.
- This repository on that computer (`git clone https://github.com/selezenart/dota-scout.git`, or GitHub → Code → Download ZIP).
- A **second Steam account** to act as the helper's bot. A free account is enough; it does not need games, purchases or play time. Never use your main account.

> The bot account signs in automatically and asks Dota's servers for your lobby. Running an automated client on a Steam account is a grey area under Steam's rules. If Valve ever acts on it, only the bot account is affected; the helper never signs in your main account.

## One-time setup

### 1. Let Dota write its console log

Steam → Library → right-click **Dota 2** → Properties → General → **Launch options**, add:

```
-condebug
```

Restart Dota if it is running.

### 2. Install the helper

Open a terminal in the repository's `helper` folder:

- **macOS:** Terminal app, then `cd` to the folder, e.g. `cd ~/Documents/dota-scout/helper`
- **Windows:** open the `helper` folder in File Explorer, type `cmd` in the address bar, press Enter.

Run:

```
npm ci --ignore-scripts
```

### 3. Sign in the bot account

In the same terminal:

```
npm run bot-login
```

Type the **bot** account's name, then its password (nothing appears while you type), then the Steam Guard code from that account's email or Steam app. When you see `Bot signed in. Saved its sign-in token…` you are done. The password is not stored; only a sign-in token is kept in `helper/bot-login-token.txt`. Do not share that file.

## Every time you play

1. **Start the helper** and keep its window open:
   - **macOS:** in Terminal, from the repository folder: `./helper/start.sh`
   - **Windows:** double-click `helper\start.bat`

   Wait for:
   ```
   Connected to the Dota game coordinator. The lineup appears when picks start.
   ```
2. **Open the board** at <https://captains-draft-three.vercel.app> in the same computer's browser, open your draft and take the **drafter seat**.
3. Go to **Setup → Enemy scouting → Detect live lineup**. If the browser asks to allow access to devices on your local network, allow it.
4. **Queue in Dota.** When the match is accepted and picks start, the board imports both teams (usually within 10 seconds) and starts scouting the enemy players. The button changes back once the lineup is imported.

To stop: click **Stop live detection** on the board; close the helper window (or press Ctrl+C) when you are done playing.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Board: "Check that the updated local helper is running…" | Start the helper (step 1) and keep its window open. Allow the browser's local network prompt. Use the board on the same computer as the helper. |
| Board keeps waiting during picks | Check Dota has `-condebug` in its launch options and was restarted. The helper only sees matches you join after Dota started with it. |
| Board: "Waiting for the drafter seat…" | Take the drafter seat on the board. |
| Board: "Live lineup differs from the assigned players" | The draft already has other players. Open a new draft and detect again. |
| Helper: `Bot sign-in failed (…)` | Run `npm run bot-login` again in the `helper` folder, then restart the helper. |
| Helper: `Nothing to read the lineup with` | The bot is not set up. Do setup steps 2 and 3. |
| Helper: `Port 8765 is already in use` | Another helper window is already open. Use that one or close it. |
| Helper: `Dota console log not found` | Add `-condebug` (step 1). If Dota is installed in an unusual place, set `DOTA_CONSOLE_LOG` to the full path of `console.log` (see [helper/README.md](../helper/README.md)). |
| Some players have no account | Their Dota profile hides it. Enter those players manually on the board. |

## Turning it off for good

1. Delete `helper/bot-login-token.txt`.
2. On the bot account, in the Steam app: Steam Guard → **Deauthorize all other devices** (or change the bot's password). This cancels the saved token everywhere.
3. Remove `-condebug` from Dota's launch options if you like.

## More detail

How it works, options and security: [helper/README.md](../helper/README.md).
