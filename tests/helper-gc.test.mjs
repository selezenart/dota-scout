import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFields, decodeFindResponse, encodeClientHello, encodeFindLobbies, encodeFindResponseForTest,
} from '../helper/gc/protobuf.mjs';
import http from 'node:http';
import {lastLobbyFromLog} from '../helper/gc/lobby-log.mjs';
import {createLobbyLookup} from '../helper/gc/lookup.mjs';
import {createDotaWatch, dotaInProcessList, dotaRunningCheck} from '../helper/gc/dota-watch.mjs';
import {launchAgentPlist, windowsStartupScript} from '../helper/autostart.mjs';
import {shapeGcRoster} from '../helper/lib.mjs';
import {createHelperServer} from '../helper/server.mjs';
import {liveLineup} from '../web/live-roster.js';

test('gc: ClientHello asks for the Source 2 engine (field 7 = 1)', () => {
  assert.deepEqual([...encodeClientHello()], [0x38, 0x01]);
});

test('gc: FindTopSourceTVGames encodes 64-bit lobby ids in field 6', () => {
  const lobby = '30108445531180688';
  const fields = decodeFields(encodeFindLobbies([lobby]));
  assert.deepEqual([...fields.keys()], [6]);
  assert.equal(String(fields.get(6)[0]), lobby);
});

test('gc: response decoding returns lobby, match, negative game time and players', () => {
  const players = Array.from({length: 10}, (_, i) => ({accountId: 1000 + i, heroId: i === 0 ? 0 : 10 + i, teamSlot: i % 5, team: i < 5 ? 2 : 3}));
  const payload = encodeFindResponseForTest([
    {lobbyId: '1', matchId: '2', players: []},
    {lobbyId: '30108445531180688', matchId: '9092239673', gameTime: -53, delay: 120, players},
  ]);
  const response = decodeFindResponse(payload);
  assert.equal(response.numGames, 2);
  assert.equal(response.specificGames, true);
  const game = response.games.find(entry => entry.lobbyId === '30108445531180688');
  assert.equal(game.matchId, '9092239673');
  assert.equal(game.gameTime, -53);
  assert.equal(game.delay, 120);
  assert.equal(game.players.length, 10);
  assert.deepEqual(game.players[7], {accountId: '1007', heroId: 17, teamSlot: 2, team: 3, fields: [1, 2, 3, 4]});
});

test('gc: decoding rejects truncated payloads instead of reading past the end', () => {
  const payload = encodeFindResponseForTest([{lobbyId: '5', matchId: '6', players: [{accountId: 1}]}]);
  assert.throws(() => decodeFindResponse(payload.subarray(0, payload.length - 3)), RangeError);
});

test('gc: reads the last lobby from console.log and notices when it ended', () => {
  const line = (time, lobby, account, match) => `11/16 ${time} LOBBY STATE RUN: lobby ${lobby}: Player AccountID ${account} connecting to MatchID ${match} at ServerID [A:1:1240573965:52516] =[A:1:1240573965:52516]`;
  const log = [
    line('00:10:00', '111', '42', '900'),
    "11/16 00:40:00 [NetSteamConn] Closing Steam Net Connection on socket 'client' to =[A:1:1:1], handle #1 (1002 NETWORK_DISCONNECT_DISCONNECT_BY_USER)",
    line('01:10:26', '30108445531180688', '42', '9092239673'),
    '11/16 01:10:28 [Client] CL:  Connected to =[A:1:1240573965:52516]',
  ].join('\r\n');
  assert.deepEqual(lastLobbyFromLog(log), {loggedAt: '11/16 01:10:26', lobbyId: '30108445531180688', accountId: '42', matchId: '9092239673', ended: false});
  const ended = `${log}\r\n11/16 01:41:21 [NetSteamConn] Closing Steam Net Connection on socket 'client' to =[A:1:1240573965:52516]`;
  assert.equal(lastLobbyFromLog(ended).ended, true);
  assert.equal(lastLobbyFromLog('nothing here'), null);
  assert.equal(lastLobbyFromLog(null), null);
});

test('gc: the loopback close logged right after joining does not end the lobby', () => {
  const log = [
    "11/16 04:15:27 LOBBY STATE RUN: lobby 30108445664265595: Player AccountID 42 connecting to MatchID 9092336838 at ServerID [A:1:1496481792:52516] =[A:1:1496481792:52516]",
    "11/16 04:15:27 [NetSteamConn] Closing Steam Net Connection on socket 'client' to loopback:1, handle #3704546215 (2055 NETWORK_DISCONNECT_LOOPDEACTIVATE)",
    "11/16 04:15:27 [NetSteamConn] Opened Steam Net Connection on socket 'client' to =[A:1:1496481792:52516], connection #3481704360",
  ].join('\n');
  assert.equal(lastLobbyFromLog(log).ended, false);
  const left = `${log}\n11/16 05:00:35 [NetSteamConn] Closing Steam Net Connection on socket 'client' to =[A:1:1496481792:52516], handle #3481704360 (1002 NETWORK_DISCONNECT_DISCONNECT_BY_USER)`;
  assert.equal(lastLobbyFromLog(left).ended, true);
});

// --- Lineup from the game coordinator ---

const LOBBY = '30108445664265595';
const MATCH = '9092336838';
const ME = '42';
const LOG = `11/16 04:15:27 LOBBY STATE RUN: lobby ${LOBBY}: Player AccountID ${ME} connecting to MatchID ${MATCH} at ServerID [A:1:1496481792:52516] =[A:1:1496481792:52516]\n`;
// Order and team numbers as the coordinator sent them in a real match: Radiant (0) first, team_slot 1-5.
const PLAYERS = Array.from({length: 10}, (_, i) => ({accountId: i === 7 ? Number(ME) : 1000 + i, team: i < 5 ? 0 : 1, teamSlot: (i % 5) + 1}));
const gcGame = (players = PLAYERS) => ({lobbyId: LOBBY, matchId: MATCH, gameTime: -44, delay: 120, players});
const decodedGame = (players = PLAYERS) => decodeFindResponse(encodeFindResponseForTest([gcGame(players)])).games[0];

function fakeCoordinator({ready = true} = {}) {
  const sent = [];
  let clock = 0;
  const lookup = createLobbyLookup({send: payload => sent.push(payload), isReady: () => ready, now: () => clock, timeoutMs: 20});
  return {sent, lookup, tick: ms => { clock += ms; }, setReady: value => { ready = value; }};
}

test('gc lookup: asks for the lobby once and caches a full lineup', async () => {
  const gc = fakeCoordinator();
  const pending = gc.lookup.lookup(LOBBY);
  const shared = gc.lookup.lookup(LOBBY);
  assert.equal(gc.sent.length, 1);
  assert.equal(String(decodeFields(gc.sent[0]).get(6)[0]), LOBBY);
  gc.lookup.handleResponse(encodeFindResponseForTest([{lobbyId: '1', matchId: '2'}, gcGame()]));
  const game = await pending;
  assert.equal(await shared, game);
  assert.equal(game.players.length, 10);
  assert.equal(await gc.lookup.lookup(LOBBY), game);
  assert.equal(gc.sent.length, 1, 'a known lineup is never asked for again');
});

test('gc lookup: waits 10 s before asking again for an unlisted lobby, and does not ask before the coordinator is ready', async () => {
  const gc = fakeCoordinator({ready: false});
  assert.equal(await gc.lookup.lookup(LOBBY), null);
  assert.equal(gc.sent.length, 0);
  gc.setReady(true);
  const first = gc.lookup.lookup(LOBBY);
  gc.lookup.handleResponse(encodeFindResponseForTest([]));
  assert.equal(await first, null);
  assert.equal(await gc.lookup.lookup(LOBBY), null);
  assert.equal(gc.sent.length, 1);
  gc.tick(10000);
  const second = gc.lookup.lookup(LOBBY);
  assert.equal(gc.sent.length, 2);
  gc.lookup.handleResponse(encodeFindResponseForTest([gcGame()]));
  assert.equal((await second).lobbyId, LOBBY);
});

test('gc lookup: an unanswered request times out, bad replies and resets resolve to null', async () => {
  const gc = fakeCoordinator();
  assert.equal(await gc.lookup.lookup(LOBBY), null);
  gc.tick(10000);
  const garbled = gc.lookup.lookup(LOBBY);
  gc.lookup.handleResponse(Buffer.from([0x3a, 0x7f]));
  assert.equal(await garbled, null);
  gc.tick(10000);
  const dropped = gc.lookup.lookup(LOBBY);
  gc.lookup.reset();
  assert.equal(await dropped, null);
  assert.equal(await gc.lookup.lookup('not-a-lobby'), null);
  assert.equal(gc.sent.length, 3);
});

test('gc lookup: a partial lineup is returned but not cached', async () => {
  const gc = fakeCoordinator();
  const partial = gc.lookup.lookup(LOBBY);
  gc.lookup.handleResponse(encodeFindResponseForTest([gcGame(PLAYERS.slice(0, 9))]));
  assert.equal((await partial).players.length, 9);
  gc.tick(10000);
  gc.lookup.lookup(LOBBY);
  assert.equal(gc.sent.length, 2);
});

test('shapeGcRoster maps coordinator teams 0/1 to board sides 2/3 in slot order', () => {
  const lobby = lastLobbyFromLog(LOG);
  const shuffled = [...decodedGame().players].reverse();
  const roster = shapeGcRoster({...decodedGame(), players: shuffled}, lobby);
  assert.equal(roster.status, 'ready');
  assert.equal(roster.matchId, MATCH);
  assert.equal(roster.accountId, ME);
  assert.deepEqual(roster.teams, [
    {side: 2, ids: ['1000', '1001', '1002', '1003', '1004']},
    {side: 3, ids: ['1005', '1006', ME, '1008', '1009']},
  ]);
  assert.ok(liveLineup(roster));
});

test('shapeGcRoster refuses lineups the board cannot trust', () => {
  const lobby = lastLobbyFromLog(LOG);
  assert.equal(shapeGcRoster(decodedGame(PLAYERS.map(p => ({...p, accountId: p.accountId === Number(ME) ? 77 : p.accountId}))), lobby).status, 'waiting');
  assert.equal(shapeGcRoster(decodedGame(PLAYERS.map((p, i) => ({...p, team: i < 6 ? 0 : 1}))), lobby).status, 'waiting');
  assert.equal(shapeGcRoster(decodedGame(PLAYERS.map((p, i) => ({...p, accountId: i === 0 ? 0 : p.accountId}))), lobby).status, 'waiting');
  assert.equal(shapeGcRoster({...decodedGame(), matchId: '0'}, lobby).matchId, MATCH, 'falls back to the match id in console.log');
  assert.equal(shapeGcRoster(null, lobby).status, 'waiting');
});

async function getRoster(options) {
  const server = createHelperServer({readConsoleLog: async () => LOG, getLocalAccountId: async () => ME, allowedOrigins: [], port: 0, ...options});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await new Promise((resolve, reject) => {
      http.get({host: '127.0.0.1', port, path: '/live-roster', headers: {Host: `127.0.0.1:${port}`}}, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('server: serves the coordinator lineup during picks without calling the Steam Web API', async () => {
  let webCalls = 0;
  const asked = [];
  const roster = await getRoster({
    lookupLobby: async lobbyId => { asked.push(lobbyId); return decodedGame(); },
    fetchRealtimeStats: async () => { webCalls++; return {}; },
  });
  assert.equal(roster.status, 'ready');
  assert.deepEqual(asked, [LOBBY]);
  assert.equal(webCalls, 0);
});

test('server: falls back to the Steam Web API when the coordinator has no lineup or fails', async () => {
  for (const lookupLobby of [async () => null, async () => { throw new Error('boom'); }]) {
    let webCalls = 0;
    const roster = await getRoster({lookupLobby, fetchRealtimeStats: async () => { webCalls++; return {}; }});
    assert.equal(webCalls, 1);
    assert.equal(roster.status, 'waiting');
  }
});

test('server: with only the bot, waits for the coordinator and skips ended lobbies', async () => {
  const waiting = await getRoster({lookupLobby: async () => null});
  assert.deepEqual(waiting, {status: 'waiting', message: 'Asking the Dota game coordinator for your lobby…'});
  let asked = 0;
  const ended = `${LOG}11/16 05:00:35 [NetSteamConn] Closing Steam Net Connection on socket 'client' to =[A:1:1496481792:52516], handle #1\n`;
  const after = await getRoster({readConsoleLog: async () => ended, lookupLobby: async () => { asked++; return decodedGame(); }});
  assert.equal(asked, 0);
  assert.equal(after.status, 'waiting');
  const partial = await getRoster({lookupLobby: async () => decodedGame(PLAYERS.slice(0, 9))});
  assert.equal(partial.status, 'waiting');
});

test('gc lookup (review): a reply listing only other lobbies does not end the request; strict lobby ids', async () => {
  const gc = fakeCoordinator();
  const pending = gc.lookup.lookup(LOBBY);
  gc.lookup.handleResponse(encodeFindResponseForTest([{lobbyId: '1', matchId: '2'}]));
  gc.lookup.handleResponse(encodeFindResponseForTest([gcGame()]));
  assert.equal((await pending).lobbyId, LOBBY);
  for (const bad of ['0123', '18446744073709551616', '99999999999999999999']) assert.equal(await gc.lookup.lookup(bad), null);
  assert.equal(gc.sent.length, 1);
});

// --- Bot only while Dota runs, and autostart files ---

test('dota watch: finds Dota in macOS, Linux and Windows process lists', async () => {
  assert.equal(dotaInProcessList('/sbin/launchd\n/Users/me/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/bin/osx64/dota2.app/Contents/MacOS/dota2\n', 'darwin'), true);
  assert.equal(dotaInProcessList('/usr/bin/steam\n/opt/dota2helper\n', 'linux'), false);
  assert.equal(dotaInProcessList('"dota2.exe","1234","Console","1","2,000,000 K"\r\n', 'win32'), true);
  assert.equal(dotaInProcessList('INFO: No tasks are running which match the specified criteria.\r\n', 'win32'), false);
  const calls = [];
  const check = dotaRunningCheck('darwin', async (command, args) => { calls.push([command, ...args]); return 'dota2\n'; });
  assert.equal(await check(), true);
  assert.deepEqual(calls, [['ps', '-A', '-o', 'comm=']]);
});

test('dota watch: signs the bot in when Dota starts and out two minutes after it closes', async () => {
  let running = false;
  let clock = 0;
  const bots = [];
  const watch = createDotaWatch({
    isDotaRunning: async () => running,
    startBot: () => { const bot = {stopped: false, stop() { this.stopped = true; }, lookupLobby: async () => 'game'}; bots.push(bot); return bot; },
    now: () => clock,
  });
  await watch.check();
  assert.equal(bots.length, 0);
  assert.equal(await watch.lookupLobby(LOBBY), null);
  running = true;
  await watch.check();
  await watch.check();
  assert.equal(bots.length, 1, 'one sign-in per Dota session');
  assert.equal(await watch.lookupLobby(LOBBY), 'game');
  running = false;
  clock += 119000;
  await watch.check();
  assert.equal(bots[0].stopped, false, 'a short gap (Dota restarting) keeps the bot');
  clock += 1000;
  await watch.check();
  assert.equal(bots[0].stopped, true);
  assert.equal(watch.isActive(), false);
  running = true;
  await watch.check();
  assert.equal(bots.length, 2, 'signs in again with the next Dota session');
});

test('dota watch: if the process list cannot be read, the bot stays available', async () => {
  let started = 0;
  const watch = createDotaWatch({isDotaRunning: async () => { throw new Error('ps missing'); }, startBot: () => { started++; return {stop() {}, lookupLobby: async () => null}; }});
  await watch.check();
  assert.equal(started, 1);
});

test('autostart: LaunchAgent runs the helper at login, escapes paths and stores no secrets', () => {
  const plist = launchAgentPlist({nodePath: '/opt/node/bin/node', serverPath: '/Users/me/A&B <x>/helper/server.mjs', workDir: '/Users/me/A&B <x>/helper', logPath: '/Users/me/Library/Logs/CaptainsDraftHelper.log', env: {HELPER_ALLOWED_ORIGINS: 'https://captains-draft-three.vercel.app'}});
  assert.match(plist, /<string>\/Users\/me\/A&amp;B &lt;x&gt;\/helper\/server\.mjs<\/string>/);
  assert.match(plist, /<key>HELPER_AUTOSTART<\/key><string>1<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>SuccessfulExit<\/key><false\/>/);
  assert.doesNotMatch(plist, /STEAM_WEB_API_KEY|token/i);
});

test('autostart: Windows startup script runs node hidden with quoted paths', () => {
  const script = windowsStartupScript({nodePath: 'C:\\Program Files\\nodejs\\node.exe', workDir: 'C:\\Users\\Me\\dota scout\\helper', logPath: 'C:\\Users\\Me\\AppData\\Local\\CaptainsDraftHelper\\helper.log'});
  assert.match(script, /shell\.CurrentDirectory = "C:\\Users\\Me\\dota scout\\helper"/);
  assert.match(script, /shell\.Environment\("PROCESS"\)\("HELPER_AUTOSTART"\) = "1"/);
  assert.ok(script.includes('shell.Run "cmd /c """"C:\\Program Files\\nodejs\\node.exe"" server.mjs >> ""C:\\Users\\Me\\AppData\\Local\\CaptainsDraftHelper\\helper.log"" 2>&1""", 0, False'));
  assert.ok(script.includes('\r\n'));
});
