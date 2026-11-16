import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFields, decodeFindResponse, encodeClientHello, encodeFindLobbies, encodeFindResponseForTest,
} from '../helper/prototype/protobuf.mjs';
import {lastLobbyFromLog} from '../helper/prototype/lobby-log.mjs';

test('prototype: ClientHello asks for the Source 2 engine (field 7 = 1)', () => {
  assert.deepEqual([...encodeClientHello()], [0x38, 0x01]);
});

test('prototype: FindTopSourceTVGames encodes 64-bit lobby ids in field 6', () => {
  const lobby = '30108445531180688';
  const fields = decodeFields(encodeFindLobbies([lobby]));
  assert.deepEqual([...fields.keys()], [6]);
  assert.equal(String(fields.get(6)[0]), lobby);
});

test('prototype: response decoding returns lobby, match, negative game time and players', () => {
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

test('prototype: decoding rejects truncated payloads instead of reading past the end', () => {
  const payload = encodeFindResponseForTest([{lobbyId: '5', matchId: '6', players: [{accountId: 1}]}]);
  assert.throws(() => decodeFindResponse(payload.subarray(0, payload.length - 3)), RangeError);
});

test('prototype: reads the last lobby from console.log and notices when it ended', () => {
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

test('prototype: the loopback close logged right after joining does not end the lobby', () => {
  const log = [
    "11/16 04:15:27 LOBBY STATE RUN: lobby 30108445664265595: Player AccountID 42 connecting to MatchID 9092336838 at ServerID [A:1:1496481792:52516] =[A:1:1496481792:52516]",
    "11/16 04:15:27 [NetSteamConn] Closing Steam Net Connection on socket 'client' to loopback:1, handle #3704546215 (2055 NETWORK_DISCONNECT_LOOPDEACTIVATE)",
    "11/16 04:15:27 [NetSteamConn] Opened Steam Net Connection on socket 'client' to =[A:1:1496481792:52516], connection #3481704360",
  ].join('\n');
  assert.equal(lastLobbyFromLog(log).ended, false);
  const left = `${log}\n11/16 05:00:35 [NetSteamConn] Closing Steam Net Connection on socket 'client' to =[A:1:1496481792:52516], handle #3481704360 (1002 NETWORK_DISCONNECT_DISCONNECT_BY_USER)`;
  assert.equal(lastLobbyFromLog(left).ended, true);
});
