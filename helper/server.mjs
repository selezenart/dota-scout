// Captain's Draft Board local helper.
// Reads Dota 2's console.log (written when Dota runs with -condebug) to find the
// current game server, then asks the official Steam Web API for that server's
// live lineup. It never reads game memory or injects anything into the game.
import {createServer} from 'node:http';
import {open, readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  DEFAULT_ALLOWED_ORIGINS, corsHeaders, isLocalHost, libraryPathsFromVdf, localAccountFromLoginUsers,
  redact, serverSteamIdFromLog, shapeLiveRoster, steamKeyFrom,
} from './lib.mjs';

const HOST = '127.0.0.1';
const PORT = 8765;
const LOG_TAIL_BYTES = 4 * 1024 * 1024;
const STATUS_PAGE = `<!doctype html><meta charset="utf-8"><title>Captain's Draft Board helper</title>
<body style="font:16px system-ui;max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>Captain's Draft Board helper is running</h1>
<p>Keep the helper window open while you play. On the board, choose Setup → Enemy scouting → Detect live lineup.</p>
<p><a href="/live-roster">Current live roster status</a></p></body>`;

export function createHelperServer({readConsoleLog, getLocalAccountId, fetchRealtimeStats, allowedOrigins = DEFAULT_ALLOWED_ORIGINS, port, log = () => {}}) {
  async function liveRoster() {
    const text = await readConsoleLog();
    if (text == null) return {status: 'waiting', message: 'Dota console log not found. Add -condebug to the Dota 2 launch options and restart Dota.'};
    const serverSteamId = serverSteamIdFromLog(text);
    if (!serverSteamId) return {status: 'waiting', message: 'Waiting for a live match in the Dota console log.'};
    const accountId = await getLocalAccountId();
    let stats;
    try {
      stats = await fetchRealtimeStats(serverSteamId);
    } catch (error) {
      const hint = error?.status === 403 ? ' Steam rejected the key; check steam-key.txt.' : '';
      log(`Steam Web API request failed${error?.status ? ` (HTTP ${error.status})` : ''}.${hint}`);
      return {status: 'error', message: 'Steam Web API request failed. Check the helper window.'};
    }
    return shapeLiveRoster(stats, accountId);
  }

  const server = createServer(async (request, response) => {
    const send = (status, headers, body = '') => {
      response.writeHead(status, {'Cache-Control': 'no-store', ...headers});
      response.end(body);
    };
    if (!isLocalHost(request.headers.host, port || server.address()?.port)) return send(421, {'Content-Type': 'text/plain'}, 'Unknown host');
    const cors = corsHeaders(request.headers.origin, allowedOrigins);
    if (!cors) return send(403, {'Content-Type': 'text/plain'}, 'Origin not allowed');
    const path = new URL(request.url, 'http://localhost').pathname;
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

// The board polls every 5 s; reuse one Steam answer per server for 4 s.
function steamFetcher(key) {
  let cached = {serverSteamId: null, at: 0, result: null};
  return async serverSteamId => {
    if (cached.serverSteamId === serverSteamId && Date.now() - cached.at < 4000) return cached.result;
    const url = new URL('https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/');
    url.searchParams.set('key', key);
    url.searchParams.set('server_steam_id', serverSteamId);
    let response;
    try {
      response = await fetch(url, {signal: AbortSignal.timeout(10000)});
    } catch (error) {
      throw new Error(redact(error?.message || 'network error', key));
    }
    if (!response.ok) throw Object.assign(new Error('Steam Web API error'), {status: response.status});
    const result = await response.json().catch(() => ({}));
    cached = {serverSteamId, at: Date.now(), result};
    return result;
  };
}

async function main() {
  const keyFile = fileURLToPath(new URL('./steam-key.txt', import.meta.url));
  const key = steamKeyFrom(process.env.STEAM_WEB_API_KEY, await readText(keyFile));
  if (!key) {
    console.error(`No Steam Web API key. Put your key on one line in ${keyFile} or set STEAM_WEB_API_KEY.\nGet a key at https://steamcommunity.com/dev/apikey`);
    process.exitCode = 1;
    return;
  }
  if (!/^[0-9A-F]{32}$/i.test(key)) console.warn('Warning: the Steam Web API key does not look like a 32-character key.');
  const allowedOrigins = process.env.HELPER_ALLOWED_ORIGINS
    ? process.env.HELPER_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  const server = createHelperServer({
    readConsoleLog, getLocalAccountId, fetchRealtimeStats: steamFetcher(key), allowedOrigins, port: PORT,
    log: message => console.log(redact(message, key)),
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other helper window and try again.` : 'The helper could not start.');
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, async () => {
    console.log(`Captain's Draft Board helper running at http://${HOST}:${PORT}`);
    console.log(`Allowed sites: ${allowedOrigins.join(', ')}`);
    console.log((await readConsoleLog()) == null ? 'Dota console log not found yet. Add -condebug to the Dota 2 launch options, or set DOTA_CONSOLE_LOG.' : 'Dota console log found.');
    console.log((await getLocalAccountId()) ? 'Steam account found.' : 'Steam account not found. Set DOTA_ACCOUNT_ID to your Dota friend ID.');
    console.log('Keep this window open while you play. Press Ctrl+C to stop.');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
