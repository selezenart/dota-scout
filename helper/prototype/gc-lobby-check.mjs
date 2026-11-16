// Prototype: can a second Steam account get the 10 players of your live lobby from the
// Dota game coordinator during picks?
//
// 1. Signs in a separate Steam account (you type the name, password and Steam Guard code once;
//    only Steam's sign-in token is saved, in bot-login-token.txt next to this file).
// 2. Reads the lobby id from Dota's console.log (Dota launched with -condebug).
// 3. Asks the coordinator for that lobby (the same request the client uses to find a game to watch)
//    and prints counts and timing only — no account ids, names or tokens.
//
// It never touches the Dota client, its memory or your main account.
import {chmod, open, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {MSG, decodeFindResponse, encodeClientHello, encodeFindLobbies} from './protobuf.mjs';
import {lastLobbyFromLog} from './lobby-log.mjs';

const DOTA_APP_ID = 570;
const POLL_MS = 10000;
const TOKEN_FILE = fileURLToPath(new URL('./bot-login-token.txt', import.meta.url));
// Local only (git-ignored): the player order of the last lobby, to check sides against the finished match.
const LINEUP_FILE = fileURLToPath(new URL('./lobby-players.local.json', import.meta.url));

function consoleLogPath() {
  if (process.env.DOTA_CONSOLE_LOG) return process.env.DOTA_CONSOLE_LOG;
  const steam = process.env.STEAM_PATH || (process.platform === 'win32'
    ? join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Steam') : join(homedir(), '.local', 'share', 'Steam'));
  return join(steam, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'console.log');
}

async function readLogTail(path, bytes = 4 * 1024 * 1024) {
  let file;
  try {
    file = await open(path, 'r');
    const {size} = await file.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

function ask(question, {hidden = false} = {}) {
  return new Promise(resolve => {
    const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) rl.output.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = message => console.log(`${stamp()} ${message}`);

let SteamUser;
try {
  ({default: SteamUser} = await import('steam-user'));
} catch {
  console.error('Missing dependency. Run this once in this folder:  npm ci --ignore-scripts');
  process.exit(1);
}

const user = new SteamUser({dataDirectory: null, autoRelogin: true});
let gcReady = false;
let helloTimer = null;
let pending = null;
let pollTimer = null;
let usingToken = false;
let lastNote = '';
let savedLobbyId = null;

const note = message => { if (message !== lastNote) { lastNote = message; say(message); } };

user.on('refreshToken', async token => {
  await writeFile(TOKEN_FILE, token, {mode: 0o600});
  await chmod(TOKEN_FILE, 0o600);
  say('Saved the bot sign-in token (bot-login-token.txt). Next start needs no password.');
});

user.on('steamGuard', async (domain, callback, lastCodeWrong) => {
  if (lastCodeWrong) say('That Steam Guard code was wrong. Wait 30 s before the next one.');
  callback(await ask(domain ? `Steam Guard code sent to your email at ${domain}: ` : 'Steam Guard code from the Steam app: '));
});

user.on('loggedOn', () => {
  say('Bot account signed in.');
  user.requestFreeLicense([DOTA_APP_ID], () => {
    user.gamesPlayed([DOTA_APP_ID]);
    clearInterval(helloTimer);
    const hello = () => { if (!gcReady) user.sendToGC(DOTA_APP_ID, MSG.CLIENT_HELLO, {}, encodeClientHello()); };
    hello();
    helloTimer = setInterval(hello, 5000);
  });
});

user.on('playingState', (blocked, playingApp) => {
  if (blocked) say(`The bot account is playing elsewhere (app ${playingApp}); stop that session first.`);
});

user.on('receivedFromGC', (appid, msgType, payload) => {
  if (appid !== DOTA_APP_ID) return;
  if (msgType === MSG.CLIENT_WELCOME && !gcReady) {
    gcReady = true;
    clearInterval(helloTimer);
    say('Connected to the Dota game coordinator. Watching console.log for your next lobby…');
    schedulePoll(0);
  }
  if (msgType === MSG.FIND_SOURCETV_GAMES_RESPONSE && pending) report(payload);
});

user.on('disconnected', () => { gcReady = false; clearTimeout(pollTimer); say('Disconnected from Steam; reconnecting…'); });

user.on('error', async error => {
  const reason = SteamUser.EResult[error.eresult] || error.message;
  say(`Steam sign-in failed: ${reason}.`);
  if (usingToken) {
    await rm(TOKEN_FILE, {force: true});
    say('Removed the saved token. Start again to sign in with the password.');
  }
  process.exit(1);
});

function report(payload) {
  const {lobby, sentAt} = pending;
  pending = null;
  let response;
  try {
    response = decodeFindResponse(payload);
  } catch {
    say('Could not read the coordinator answer.');
    return;
  }
  const game = response.games.find(entry => entry.lobbyId === lobby.lobbyId);
  const waited = Math.round((Date.now() - sentAt) / 1000);
  if (!game) {
    say(`Lobby not listed by the coordinator yet (answer in ${waited}s, ${response.games.length} other games).`);
    return;
  }
  const withIds = game.players.filter(player => player.accountId !== '0');
  const you = game.players.some(player => player.accountId === lobby.accountId);
  const sides = [2, 3].map(team => game.players.filter(player => player.team === team).length).join('/');
  if (savedLobbyId !== lobby.lobbyId) {
    savedLobbyId = lobby.lobbyId;
    void saveLineup(lobby, game);
  }
  say(`LOBBY FOUND: players ${game.players.length} (with account id ${withIds.length}, sides ${sides}), you ${you ? 'included' : 'not listed'}, match id ${game.matchId === lobby.matchId ? 'matches' : 'differs'}, game time ${game.gameTime}s, spectator delay ${game.delay}s.`);
}

async function saveLineup(lobby, game) {
  const fields = [...new Set(game.players.flatMap(player => player.fields))].sort((a, b) => a - b);
  say(`Player entry fields: ${fields.join(',')} | team_slot order: ${game.players.map(player => player.teamSlot).join(',')} | hero ids set: ${game.players.filter(player => player.heroId > 0).length}`);
  try {
    const players = game.players.map(({accountId, heroId, teamSlot, team}) => ({accountId, heroId, teamSlot, team}));
    await writeFile(LINEUP_FILE, JSON.stringify({matchId: game.matchId, lobbyId: lobby.lobbyId, savedAt: new Date().toISOString(), players}, null, 2), {mode: 0o600});
    await chmod(LINEUP_FILE, 0o600);
    say('Saved the player order to lobby-players.local.json (stays on this Mac).');
  } catch {
    say('Could not save the player order.');
  }
}

// One polling loop at a time, even after reconnects.
function schedulePoll(delay = POLL_MS) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(), delay);
}

async function poll() {
  if (!gcReady) return;
  try {
    const lobby = lastLobbyFromLog(await readLogTail(consoleLogPath()));
    if (!lobby) note('No lobby in console.log yet. Queue a match (Dota must run with -condebug).');
    else if (lobby.ended) note(`Last lobby (joined ${lobby.loggedAt}) has ended. Waiting for the next one.`);
    else if (!pending) {
      note(`Lobby joined at ${lobby.loggedAt}. Asking the coordinator every ${POLL_MS / 1000} s…`);
      pending = {lobby, sentAt: Date.now()};
      user.sendToGC(DOTA_APP_ID, MSG.FIND_SOURCETV_GAMES, {}, encodeFindLobbies([lobby.lobbyId]));
      setTimeout(() => { if (pending?.lobby === lobby) { pending = null; say('No answer from the coordinator within 8 s.'); } }, 8000);
    }
  } catch {
    pending = null;
    note('Request failed; retrying.');
  }
  schedulePoll();
}

process.on('SIGINT', () => { say('Signing the bot out.'); user.logOff(); setTimeout(() => process.exit(0), 500); });

const token = (await readFile(TOKEN_FILE, 'utf8').catch(() => '')).trim();
if (token) {
  say('Signing in the bot account with the saved token…');
  usingToken = true;
  user.logOn({refreshToken: token});
} else {
  console.log('Sign in the SEPARATE bot Steam account (not your main account). The password is not stored.');
  const accountName = await ask('Bot account name: ');
  const password = await ask('Bot account password: ', {hidden: true});
  user.logOn({accountName, password});
}
