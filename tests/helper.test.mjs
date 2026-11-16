import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {liveLineup} from '../web/live-roster.js';
import {
  anonServerSteamId64, serverSteamIdFromLog, localAccountFromLoginUsers, libraryPathsFromVdf,
  shapeLiveRoster, corsHeaders, isLocalHost, steamKeyFrom, redact, DEFAULT_ALLOWED_ORIGINS,
} from '../helper/lib.mjs';
import {createHelperServer, steamFetcher} from '../helper/server.mjs';

const fx = name => readFile(new URL(`./fixtures/helper/${name}`, import.meta.url), 'utf8');
const root = new URL('..', import.meta.url).pathname;
const ORIGIN = 'https://captains-draft-three.vercel.app';
const SERVER_ID = '90108373362313221';
const LOCAL = '39734273';

const player = (accountid, team, i = 0) => ({accountid, playerid: i, team, name: `p${accountid}`, heroid: 0});
const side = (n, base) => ({team_number: n, players: [0, 1, 2, 3, 4].map(i => player(base + i, n, i))});
const stats = (over = {}) => ({match: {matchid: '8012345678', server_steam_id: SERVER_ID}, teams: [side(2, 100), side(3, 200)], ...over});

// --- anonServerSteamId64 / serverSteamIdFromLog ---

test('anonServerSteamId64 converts an anonymous game server id', () => {
  assert.equal(anonServerSteamId64(2441906181, 8470), SERVER_ID);
  assert.equal(anonServerSteamId64('2441906181', '8470'), SERVER_ID);
});

test('serverSteamIdFromLog reads the bracketed anonymous id form', () => {
  assert.equal(serverSteamIdFromLog('Connecting to [A:1:2441906181:8470]'), SERVER_ID);
});

test('serverSteamIdFromLog reads steamid: and steamid : and parenthesised forms', () => {
  assert.equal(serverSteamIdFromLog('[SteamNetSockets] SDR server steamid:90108373362313221 vport 0'), SERVER_ID);
  assert.equal(serverSteamIdFromLog('[Client] steamid : 90108373362313221'), SERVER_ID);
  assert.equal(serverSteamIdFromLog('[Client] steamid : [A:1:2441906181:8470] (90108373362313221)'), SERVER_ID);
});

test('serverSteamIdFromLog: last occurrence wins regardless of form', () => {
  const a = '[A:1:1111111111:5555]';
  assert.equal(serverSteamIdFromLog(`${a}\nsteamid:${SERVER_ID} vport 0`), SERVER_ID);
  assert.equal(serverSteamIdFromLog(`steamid:${SERVER_ID}\n${a}`), anonServerSteamId64(1111111111, 5555));
});

test('serverSteamIdFromLog ignores user ids and 7656119 SteamID64s', () => {
  assert.equal(serverSteamIdFromLog('user [U:1:123] 76561198000000001 steamid:76561198000000001'), null);
  assert.equal(serverSteamIdFromLog(`${'[A:1:2441906181:8470]'}\nuser [U:1:123] steamid : 76561198000000001`), SERVER_ID);
});

test('serverSteamIdFromLog handles empty, null and CRLF input', () => {
  assert.equal(serverSteamIdFromLog(''), null);
  assert.equal(serverSteamIdFromLog(null), null);
  assert.equal(serverSteamIdFromLog('nothing here\r\nat all\r\n'), null);
  assert.equal(serverSteamIdFromLog('a\r\n[A:1:2441906181:8470]\r\nb\r\n'), SERVER_ID);
});

test('fixture: in-match console log returns the later server', async () => {
  assert.equal(serverSteamIdFromLog(await fx('console-in-match.log')), SERVER_ID);
});

test('fixture: menu console log has no server', async () => {
  assert.equal(serverSteamIdFromLog(await fx('console-menu.log')), null);
});

// --- Steam config parsing ---

test('localAccountFromLoginUsers picks the MostRecent user', async () => {
  assert.equal(localAccountFromLoginUsers(await fx('loginusers.vdf')), '52079950');
});

test('localAccountFromLoginUsers picks the newest login when Steam writes no MostRecent flag', () => {
  // Current macOS Steam clients store only a login timestamp per saved account.
  const user = (id, autoLogin, timestamp) => `\t"${id}"\n\t{\n\t\t"AccountName"\t\t"x"\n\t\t"AutoLogin"\t\t"${autoLogin}"\n\t\t"timestamp"\t\t"${timestamp}"\n\t}\n`;
  const vdf = `"users"\n{\n${user('76561198000000002', '0', '1794689934')}${user('76561198012345678', '1', '1794780390')}${user('76561198000000001', '0', '1794677237')}}\n`;
  assert.equal(localAccountFromLoginUsers(vdf), '52079950');
  const tie = `"users"\n{\n${user('76561198000000002', '0', '5')}${user('76561198000000001', '0', '5')}}\n`;
  assert.equal(localAccountFromLoginUsers(tie), null);
  const flagged = `"users"\n{\n"76561198000000001"\n{\n"MostRecent" "1"\n"timestamp" "1"\n}\n${user('76561198012345678', '0', '9')}}\n`;
  assert.equal(localAccountFromLoginUsers(flagged), LOCAL);
  const partial = `"users"\n{\n"76561198000000001"\n{\n"MostRecent" "0"\n}\n${user('76561198012345678', '0', '9')}}\n`;
  assert.equal(localAccountFromLoginUsers(partial), null);
  const junk = `"users"\n{\n${user('76561198000000002', '0', 'abc')}${user('76561198012345678', '0', '9')}}\n`;
  assert.equal(localAccountFromLoginUsers(junk), null);
  assert.equal(localAccountFromLoginUsers(`"users"\n{\n${user('76561198000000001', '0', '0')}}\n`), LOCAL);
});

test('localAccountFromLoginUsers falls back to a single user, else null', () => {
  const one = '"users"\n{\n"76561198000000001"\n{\n"MostRecent" "0"\n}\n}';
  assert.equal(localAccountFromLoginUsers(one), LOCAL);
  const two = '"users"\n{\n"76561198000000001"\n{\n"MostRecent" "0"\n}\n"76561198012345678"\n{\n"MostRecent" "0"\n}\n}';
  assert.equal(localAccountFromLoginUsers(two), null);
  assert.equal(localAccountFromLoginUsers(''), null);
  assert.equal(localAccountFromLoginUsers(null), null);
});

test('libraryPathsFromVdf returns unescaped library roots', async () => {
  assert.deepEqual(libraryPathsFromVdf(await fx('libraryfolders.vdf')), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  assert.deepEqual(libraryPathsFromVdf(''), []);
});

// --- shapeLiveRoster ---

test('shapeLiveRoster shapes a ready roster accepted by the web validator', () => {
  const out = shapeLiveRoster(stats(), '203');
  assert.equal(out.status, 'ready');
  assert.equal(out.matchId, '8012345678');
  assert.equal(out.accountId, '203');
  assert.deepEqual(out.teams, [
    {side: 2, ids: ['100', '101', '102', '103', '104']},
    {side: 3, ids: ['200', '201', '202', '203', '204']},
  ]);
  const lineup = liveLineup(out);
  assert.deepEqual(lineup.ours, ['200', '201', '202', '203', '204']);
  assert.deepEqual(lineup.enemies, ['100', '101', '102', '103', '104']);
});

test('shapeLiveRoster reads match_id, the field GetRealtimeStats actually returns', () => {
  // Field names observed in a live top-game response: match.match_id (digit string), teams[].team_number, players[].accountid.
  const s = stats({match: {match_id: '8012345678', server_steam_id: SERVER_ID, game_time: -53}});
  const out = shapeLiveRoster(s, '203');
  assert.equal(out.status, 'ready');
  assert.equal(out.matchId, '8012345678');
  assert.equal(shapeLiveRoster(stats({match: {match_id: '0'}}), '203').status, 'waiting');
});

test('shapeLiveRoster accepts numeric matchid and falls back to player team', () => {
  const s = stats({match: {matchid: 8012345678}});
  s.teams.forEach(t => delete t.team_number);
  const out = shapeLiveRoster(s, '103');
  assert.equal(out.status, 'ready');
  assert.equal(out.matchId, '8012345678');
  assert.deepEqual(out.teams.map(t => t.side), [2, 3]);
  assert.ok(liveLineup(out));
});

test('shapeLiveRoster fixture with extra fields is ready', async () => {
  const out = shapeLiveRoster(JSON.parse(await fx('realtime-stats.json')), LOCAL);
  assert.equal(out.status, 'ready');
  assert.equal(out.accountId, LOCAL);
  assert.ok(liveLineup(out));
});

test('shapeLiveRoster returns waiting for incomplete or unusable stats', () => {
  const dupe = stats(); dupe.teams[1].players[1].accountid = 100;
  const bot = stats(); bot.teams[0].players[2].accountid = 0;
  const anon = stats(); delete anon.teams[0].players[2].accountid;
  const short = stats(); short.teams[1].players.pop();
  const cases = {
    null: [null, '203'], empty: [{}, '203'],
    'no matchid': [stats({match: {}}), '203'],
    'zero matchid': [stats({match: {matchid: 0}}), '203'],
    short: [short, '203'], bot: [bot, '203'], anon: [anon, '203'], dupe: [dupe, '203'],
    'local not in match': [stats(), '999'],
    'missing local': [stats(), undefined],
    'null local': [stats(), null],
  };
  for (const [name, [s, local]] of Object.entries(cases)) {
    const out = shapeLiveRoster(s, local);
    assert.equal(out.status, 'waiting', name);
    assert.equal(typeof out.message, 'string', name);
    assert.ok(out.message.length > 0, name);
  }
});

test('shapeLiveRoster never throws on garbage', () => {
  for (const g of [undefined, 42, 'x', [], {teams: 'nope'}, {teams: [null, 1]}, {match: 5, teams: [{players: 'x'}]}]) {
    assert.equal(shapeLiveRoster(g, '203').status, 'waiting');
  }
});

// --- request guards and secrets ---

test('corsHeaders allows listed origins, rejects others, skips absent origin', () => {
  const ok = corsHeaders(ORIGIN, [ORIGIN]);
  assert.equal(ok['Access-Control-Allow-Origin'], ORIGIN);
  assert.equal(ok['Vary'], 'Origin');
  assert.equal(corsHeaders('https://evil.example', [ORIGIN]), null);
  assert.deepEqual(corsHeaders(undefined, [ORIGIN]), {});
});

test('isLocalHost only accepts loopback hosts on the helper port', () => {
  for (const h of ['localhost:8765', '127.0.0.1:8765', '[::1]:8765', 'LocalHost:8765']) assert.equal(isLocalHost(h, 8765), true, h);
  for (const h of ['evil.com:8765', 'localhost.evil.com:8765', '127.0.0.1:9999', '127.0.0.1', '', undefined, null]) assert.equal(isLocalHost(h, 8765), false, String(h));
});

test('steamKeyFrom prefers env, then first real file line', () => {
  assert.equal(steamKeyFrom('  ENVKEY \n', 'FILEKEY'), 'ENVKEY');
  assert.equal(steamKeyFrom('', '\uFEFF# comment\r\n\r\n  FILEKEY  \r\nOTHER\r\n'), 'FILEKEY');
  assert.equal(steamKeyFrom(undefined, '# only comment\n\n'), null);
  assert.equal(steamKeyFrom('   ', ''), null);
  assert.equal(steamKeyFrom(undefined, undefined), null);
});

test('redact replaces every occurrence and ignores empty secrets', () => {
  assert.equal(redact('a SECRET b SECRET', 'SECRET'), 'a [redacted] b [redacted]');
  assert.equal(redact('unchanged', ''), 'unchanged');
  assert.equal(redact('unchanged', undefined), 'unchanged');
});

// --- HTTP server ---

async function withServer(overrides, run) {
  const calls = {fetch: 0, logs: []};
  const server = createHelperServer({
    readConsoleLog: async () => 'x\r\n[A:1:2441906181:8470]\r\n',
    getLocalAccountId: async () => LOCAL,
    fetchRealtimeStats: async () => { calls.fetch++; return JSON.parse(await fx('realtime-stats.json')); },
    allowedOrigins: [ORIGIN],
    port: 0,
    log: msg => calls.logs.push(String(msg)),
    ...overrides,
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try { return await run({port, calls}); } finally { await new Promise(r => server.close(r)); }
}

function request({port, method = 'GET', path = '/live-roster', headers = {}}) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, method, path, headers: {Host: `127.0.0.1:${port}`, ...headers}}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
    });
    req.on('error', reject);
    req.end();
  });
}

test('server: GET /live-roster with allowed origin returns a ready roster', async () => {
  await withServer({}, async ({port, calls}) => {
    const res = await request({port, headers: {Origin: ORIGIN}});
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.headers['content-type'], /application\/json/);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'ready');
    assert.ok(liveLineup(body));
    assert.equal(calls.fetch, 1);
  });
});

test('review: anonServerSteamId64 rejects ids wider than their SteamID fields', () => {
  assert.equal(anonServerSteamId64(4294967296, 1), null);
  assert.equal(anonServerSteamId64(1, 1048576), null);
  assert.equal(serverSteamIdFromLog('[A:1:9999999999:1]'), null);
});

test('review: a malformed request target gets 400 and the helper keeps running', async () => {
  await withServer({}, async ({port}) => {
    const raw = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
      let data = '';
      socket.on('data', chunk => data += chunk);
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    assert.match(raw, /^HTTP\/1\.1 400/);
    assert.equal((await request({port, headers: {Origin: ORIGIN}})).status, 200);
  });
});

test('review: cross-site no-cors requests without Origin are rejected before any Steam call', async () => {
  await withServer({}, async ({port, calls}) => {
    const res = await request({port, headers: {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors'}});
    assert.equal(res.status, 403);
    assert.equal(calls.fetch, 0);
    const direct = await request({port, headers: {'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate'}});
    assert.equal(direct.status, 200);
    const statusPage = await request({port, path: '/', headers: {'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'navigate'}});
    assert.equal(statusPage.status, 200);
  });
});

test('review: Steam 403/429 failures are cached so polling does not hammer Steam', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return {ok: false, status: 403, json: async () => ({})}; };
  const fetchStats = steamFetcher('0123456789ABCDEF0123456789ABCDEF', fetchImpl);
  await assert.rejects(fetchStats('90108373362313221'), error => error.status === 403);
  await assert.rejects(fetchStats('90108373362313221'), error => error.status === 403);
  assert.equal(calls, 1);
});

test('review: Steam error reasons reach the helper window without the key', async () => {
  const key = '0123456789ABCDEF0123456789ABCDEF';
  const fetchImpl = async () => ({ok: false, status: 400, text: async () => `<html><body><h1>Bad Request</h1>Invalid server_steam_id for key=${key}</body></html>`, json: async () => ({})});
  const fetchStats = steamFetcher(key, fetchImpl);
  const error = await fetchStats('90108373362313221').catch(caught => caught);
  assert.equal(error.status, 400);
  assert.match(error.detail, /Invalid server_steam_id/);
  assert.ok(!error.detail.includes(key));
  assert.ok(!error.detail.includes('<'));
  await withServer({fetchRealtimeStats: async () => { throw error; }}, async ({port, calls}) => {
    const res = await request({port, headers: {Origin: ORIGIN}});
    assert.ok(!res.body.includes('Invalid server_steam_id'));
    assert.ok(calls.logs.some(line => line.includes('HTTP 400') && line.includes('Invalid server_steam_id')));
  });
});

test('server: disallowed origin gets 403 and no Steam call', async () => {
  await withServer({}, async ({port, calls}) => {
    const res = await request({port, headers: {Origin: 'https://evil.example'}});
    assert.equal(res.status, 403);
    assert.equal(calls.fetch, 0);
  });
});

test('server: bad Host header is rejected without a Steam call', async () => {
  await withServer({}, async ({port, calls}) => {
    for (const host of ['evil.com:8765', `localhost.evil.com:${port}`]) {
      const res = await request({port, headers: {Host: host, Origin: ORIGIN}});
      assert.ok(res.status >= 400, host);
    }
    assert.equal(calls.fetch, 0);
  });
});

test('server: private network preflight is answered', async () => {
  await withServer({}, async ({port}) => {
    const res = await request({port, method: 'OPTIONS', headers: {
      Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true'}});
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-private-network'], 'true');
    assert.match(res.headers['access-control-allow-methods'], /GET/);
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
  });
});

test('server: missing console log asks for -condebug', async () => {
  await withServer({readConsoleLog: async () => null}, async ({port, calls}) => {
    const res = await request({port, headers: {Origin: ORIGIN}});
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'waiting');
    assert.match(body.message, /-condebug/);
    assert.equal(calls.fetch, 0);
  });
});

test('server: log without a server id is waiting', async () => {
  await withServer({readConsoleLog: async () => await fx('console-menu.log')}, async ({port, calls}) => {
    const res = await request({port, headers: {Origin: ORIGIN}});
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).status, 'waiting');
    assert.equal(calls.fetch, 0);
  });
});

test('server: upstream errors are not echoed to the client', async () => {
  const secret = 'ABCDEF0123456789ABCDEF0123456789';
  const fetchRealtimeStats = async () => { throw new Error(`fetch failed for key=${secret}`); };
  await withServer({fetchRealtimeStats}, async ({port}) => {
    const res = await request({port, headers: {Origin: ORIGIN}});
    assert.ok([200, 502].includes(res.status));
    assert.notEqual(JSON.parse(res.body).status, 'ready');
    assert.ok(!res.body.includes(secret));
    assert.ok(!res.body.includes('fetch failed'));
  });
});

test('server: unknown path is 404 and POST is 405', async () => {
  await withServer({}, async ({port, calls}) => {
    assert.equal((await request({port, path: '/nope'})).status, 404);
    assert.equal((await request({port, method: 'POST', headers: {Origin: ORIGIN}})).status, 405);
    assert.equal(calls.fetch, 0);
  });
});

test('server: GET / serves an HTML status page', async () => {
  await withServer({}, async ({port}) => {
    const res = await request({port, path: '/'});
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
  });
});

// --- repo safety ---

test('repo: helper key file is git-ignored', () => {
  execFileSync('git', ['check-ignore', '-q', 'helper/steam-key.txt'], {cwd: root});
});

test('repo: .vercelignore excludes everything and never re-includes helper', async () => {
  const rules = (await readFile(new URL('../.vercelignore', import.meta.url), 'utf8')).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  assert.ok(rules.includes('*'));
  assert.equal(rules.filter(l => l.startsWith('!') && /helper/.test(l)).length, 0);
});

test('review: the default allowlist trusts the board, not the unrelated captains-draft.vercel.app site', () => {
  assert.deepEqual(DEFAULT_ALLOWED_ORIGINS, ['https://captains-draft-three.vercel.app', 'http://127.0.0.1:5173']);
  assert.equal(corsHeaders('https://captains-draft.vercel.app'), null);
  assert.deepEqual(corsHeaders('https://captains-draft-three.vercel.app'), {'Access-Control-Allow-Origin': 'https://captains-draft-three.vercel.app', 'Vary': 'Origin'});
});

test('review: with no allowlist configured, the server refuses the unrelated captains-draft.vercel.app site', async () => {
  await withServer({allowedOrigins: undefined}, async ({port, calls}) => {
    const foreign = await request({port, headers: {Origin: 'https://captains-draft.vercel.app'}});
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers['access-control-allow-origin'], undefined);
    assert.equal(calls.fetch, 0);
    const board = await request({port, headers: {Origin: 'https://captains-draft-three.vercel.app'}});
    assert.equal(board.status, 200);
    assert.equal(board.headers['access-control-allow-origin'], 'https://captains-draft-three.vercel.app');
  });
});
