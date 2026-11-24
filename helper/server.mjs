// Captain's Draft Board local helper.
// Reads Dota 2's console.log (written when Dota runs with -condebug) to find the
// current lobby, then asks the Dota game coordinator through a separate bot Steam account
// for its players (falling back to the Steam Web API for published games).
// It never reads game memory or injects anything into the game.
import {createServer} from 'node:http';
import {open, readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  DEFAULT_ALLOWED_ORIGINS, corsHeaders, isLocalHost, libraryPathsFromVdf, localAccountFromLoginUsers,
  redact, serverSteamIdFromLog, shapeGcRoster, shapeLiveRoster, steamKeyFrom,
} from './lib.mjs';
import {lastLobbyFromLog} from './gc/lobby-log.mjs';

const HOST = '127.0.0.1';
const PORT = 8765;
const LOG_TAIL_BYTES = 4 * 1024 * 1024;
const STATUS_PAGE = `<!doctype html><meta charset="utf-8"><title>Captain's Draft Board helper</title>
<body style="font:16px system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>Captain's Draft Board helper is running</h1>
<p>Keep the helper window open while you play. On the board, choose Setup → Enemy scouting → Detect live lineup.</p>
<p><a href="/live-roster">Current live roster status</a></p></body>`;

export function createHelperServer({readConsoleLog, getLocalAccountId, fetchRealtimeStats = null, lookupLobby = null, allowedOrigins = DEFAULT_ALLOWED_ORIGINS, port, log = () => {}}) {
  async function liveRoster() {
    const text = await readConsoleLog();
    if (text == null) return {status: 'waiting', message: 'Dota console log not found. Add -condebug to the Dota 2 launch options and restart Dota.'};
    // First choice: the game coordinator lists the lobby's ten players as soon as picks start.
    if (lookupLobby) {
      const lobby = lastLobbyFromLog(text);
      if (lobby && !lobby.ended) {
        let game = null;
        try {
          game = await lookupLobby(lobby.lobbyId);
        } catch {
          log('The game coordinator lookup failed.');
        }
        const roster = game ? shapeGcRoster(game, lobby) : null;
        if (roster?.status === 'ready') return roster;
        if (!fetchRealtimeStats) return roster || {status: 'waiting', message: 'Asking the Dota game coordinator for your lobby…'};
      } else if (!fetchRealtimeStats) {
        return {status: 'waiting', message: 'Waiting for your next match in the Dota console log.'};
      }
    }
    // Fallback: the Steam Web API, which only covers games Valve publishes for spectating.
    const serverSteamId = serverSteamIdFromLog(text);
    if (!serverSteamId) return {status: 'waiting', message: 'Waiting for a live match in the Dota console log.'};
    const accountId = await getLocalAccountId();
    let stats;
    try {
      stats = await fetchRealtimeStats(serverSteamId);
    } catch (error) {
      const hint = error?.status === 403 ? ' Steam rejected the key; check steam-key.txt.' : '';
      const reason = error?.detail ? ` Steam says: ${error.detail}` : '';
      log(`Steam Web API request failed${error?.status ? ` (HTTP ${error.status})` : ''}.${hint}${reason}`);
      return {status: 'error', message: 'Steam Web API request failed. Check the helper window.'};
    }
    return shapeLiveRoster(stats, accountId);
  }

  async function handle(request, send) {
    if (!isLocalHost(request.headers.host, port || server.address()?.port)) return send(421, {'Content-Type': 'text/plain'}, 'Unknown host');
    const cors = corsHeaders(request.headers.origin, allowedOrigins);
    if (!cors) return send(403, {'Content-Type': 'text/plain'}, 'Origin not allowed');
    if (!URL.canParse(request.url, 'http://localhost')) return send(400, {'Content-Type': 'text/plain'}, 'Bad request');
    const path = new URL(request.url, 'http://localhost').pathname;
    // Browsers omit Origin on no-cors requests (<img>, mode: 'no-cors'); refuse those from other sites.
    const fetchSite = request.headers['sec-fetch-site'];
    if (path === '/live-roster' && request.headers.origin === undefined && fetchSite && !['none', 'same-origin'].includes(fetchSite)) return send(403, {'Content-Type': 'text/plain'}, 'Origin not allowed');
    if (path === '/' && request.method === 'GET') return send(200, {'Content-Type': 'text/html; charset=utf-8'}, STATUS_PAGE);
    if (path !== '/live-roster') return send(404, {...cors, 'Content-Type': 'text/plain'}, 'Not found');
    if (request.method === 'OPTIONS') {
      const preflight = {...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600'};
      if (request.headers['access-control-request-private-network'] === 'true') preflight['Access-Control-Allow-Private-Network'] = 'true';
      return send(204, preflight);
    }
    if (request.method !== 'GET') return send(405, {...cors, Allow: 'GET, OPTIONS'});
    let body;
    try {
      body = await liveRoster();
    } catch {
      log('Could not read the live roster.');
      body = {status: 'error', message: 'The helper could not read the live roster.'};
    }
    send(200, {...cors, 'Content-Type': 'application/json; charset=utf-8'}, JSON.stringify(body));
  }

  const server = createServer((request, response) => {
    const send = (status, headers, body = '') => {
      if (response.headersSent) return;
      response.writeHead(status, {'Cache-Control': 'no-store', ...headers});
      response.end(body);
    };
    handle(request, send).catch(() => send(400, {'Content-Type': 'text/plain'}, 'Bad request'));
  });
  return server;
}

function steamRoots() {
  if (process.env.STEAM_PATH) return [process.env.STEAM_PATH];
  if (process.platform === 'win32') return [join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')];
  if (process.platform === 'darwin') return [join(homedir(), 'Library', 'Application Support', 'Steam')];
  return [join(homedir(), '.steam', 'steam'), join(homedir(), '.local', 'share', 'Steam')];
}

const readText = path => readFile(path, 'utf8').catch(() => null);

async function consoleLogCandidates() {
  if (process.env.DOTA_CONSOLE_LOG) return [process.env.DOTA_CONSOLE_LOG];
  const libraries = [];
  for (const root of steamRoots()) libraries.push(root, ...libraryPathsFromVdf(await readText(join(root, 'steamapps', 'libraryfolders.vdf'))));
  return [...new Set(libraries)].map(library => join(library, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'console.log'));
}

// Only the end of the log matters; it can grow large across sessions.
async function readLogTail(path) {
  let file;
  try {
    file = await open(path, 'r');
    const {size} = await file.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

async function readConsoleLog() {
  for (const path of await consoleLogCandidates()) {
    const text = await readLogTail(path);
    if (text != null) return text;
  }
  return null;
}

async function getLocalAccountId() {
  if (/^\d+$/.test(process.env.DOTA_ACCOUNT_ID || '')) return process.env.DOTA_ACCOUNT_ID;
  for (const root of steamRoots()) {
    const account = localAccountFromLoginUsers(await readText(join(root, 'config', 'loginusers.vdf')));
    if (account) return account;
  }
  return null;
}

// The board polls every 5 s; reuse one Steam answer per server for 4 s,
// and back off for 30 s when Steam rejects the key or rate-limits us.
export function steamFetcher(key, fetchImpl = fetch) {
  let cached = {serverSteamId: null, at: 0, result: null};
  let failure = {serverSteamId: null, at: 0, error: null};
  return async serverSteamId => {
    if (failure.serverSteamId === serverSteamId && Date.now() - failure.at < 30000) throw failure.error;
    if (cached.serverSteamId === serverSteamId && Date.now() - cached.at < 4000) return cached.result;
    const url = new URL('https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/');
    url.searchParams.set('key', key);
    url.searchParams.set('server_steam_id', serverSteamId);
    let response;
    try {
      response = await fetchImpl(url, {signal: AbortSignal.timeout(10000)});
    } catch (error) {
      throw new Error(redact(error?.message || 'network error', key));
    }
    if (!response.ok) {
      // Steam explains rejected requests in the body (HTML or text); keep a short, key-free reason.
      let reason = '';
      try { reason = String(await response.text()); } catch { /* no readable body */ }
      const detail = redact(reason.slice(0, 4000).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), key).slice(0, 200);
      const error = Object.assign(new Error('Steam Web API error'), {status: response.status, detail});
      if ([403, 429].includes(response.status)) failure = {serverSteamId, at: Date.now(), error};
      throw error;
    }
    const result = await response.json().catch(() => ({}));
    cached = {serverSteamId, at: Date.now(), result};
    return result;
  };
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    console.error(`Node.js 20 or newer is required (found ${process.version}). Install the LTS version from https://nodejs.org.`);
    process.exitCode = 1;
    return;
  }
  const keyFile = fileURLToPath(new URL('./steam-key.txt', import.meta.url));
  const tokenFile = fileURLToPath(new URL('./bot-login-token.txt', import.meta.url));
  const key = steamKeyFrom(process.env.STEAM_WEB_API_KEY, await readText(keyFile));
  const refreshToken = ((await readText(tokenFile)) || '').trim();
  if (key && !/^[0-9A-F]{32}$/i.test(key)) {
    console.error('The Steam Web API key must be 32 letters and digits (0-9, A-F). Check steam-key.txt.');
    process.exitCode = 1;
    return;
  }
  const secrets = [key, refreshToken];
  // Started at login (npm run autostart-on) the output goes to a log file, so stamp each line.
  const stamp = () => (process.env.HELPER_AUTOSTART === '1' ? `${new Date().toISOString()} ` : '');
  const log = message => console.log(stamp() + secrets.reduce((text, secret) => redact(text, secret), String(message)));
  let bot = null;
  if (refreshToken) {
    try {
      const {default: SteamUser} = await import('steam-user');
      const {startBot} = await import('./gc/bot.mjs');
      const {createDotaWatch, dotaRunningCheck} = await import('./gc/dota-watch.mjs');
      // Sign in with the newest token: Steam may renew it while the helper runs.
      const currentToken = () => secrets.at(-1) || refreshToken;
      // The bot signs in only while Dota is running.
      bot = createDotaWatch({
        isDotaRunning: dotaRunningCheck(),
        startBot: () => startBot({SteamUser, refreshToken: currentToken(), tokenFile, log, onToken: token => secrets.push(token)}),
        log,
      });
    } catch {
      console.error('The bot needs one dependency. Run this once in the helper folder:  npm ci --ignore-scripts');
    }
  }
  if (!bot && !key) {
    console.error([
      'Nothing to read the lineup with. Set up at least one of:',
      '  - the bot account (recommended, works during picks): run "npm ci --ignore-scripts" and "npm run bot-login" in the helper folder;',
      `  - a Steam Web API key on one line in ${keyFile} (only works for games Valve publishes for spectating).`,
    ].join('\n'));
    process.exitCode = 1;
    return;
  }
  const allowedOrigins = process.env.HELPER_ALLOWED_ORIGINS
    ? process.env.HELPER_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  const server = createHelperServer({
    readConsoleLog, getLocalAccountId, fetchRealtimeStats: key ? steamFetcher(key) : null,
    lookupLobby: bot?.lookupLobby || null, allowedOrigins, port: PORT, log,
  });
  const shutdown = () => {
    bot?.stop();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Close the other helper window and try again.`);
      // Started at login while another helper is open: stop quietly instead of being restarted.
      process.exitCode = process.env.HELPER_AUTOSTART === '1' ? 0 : 1;
    } else {
      console.error('The helper could not start.');
      process.exitCode = 1;
    }
    bot?.stop();
    setTimeout(() => process.exit(), 300);
  });
  server.listen(PORT, HOST, async () => {
    // Only now that this helper owns the port: a second helper must not sign the same bot in.
    if (bot) {
      void bot.check();
      setInterval(() => void bot.check(), 15000).unref();
    }
    console.log(`Captain's Draft Board helper running at http://${HOST}:${PORT}`);
    console.log(`Allowed sites: ${allowedOrigins.join(', ')}`);
    console.log(`Lineup sources: ${[bot && 'bot account (signs in while Dota is running)', key && 'Steam Web API'].filter(Boolean).join(', ')}.`);
    console.log((await readConsoleLog()) == null ? 'Dota console log not found yet. Add -condebug to the Dota 2 launch options, or set DOTA_CONSOLE_LOG.' : 'Dota console log found.');
    console.log((await getLocalAccountId()) ? 'Steam account found.' : 'Steam account not found. Set DOTA_ACCOUNT_ID to your Dota friend ID.');
    console.log('Keep this window open while you play. Press Ctrl+C to stop.');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
