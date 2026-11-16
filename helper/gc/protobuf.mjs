// Minimal protobuf encode/decode for the few Dota GC messages the prototype uses.
// Field numbers come from SteamDatabase/GameTracking-Dota2 Protobufs:
// gcsdk_gcmessages.proto (CMsgClientHello) and dota_gcmessages_client_watch.proto.

export const MSG = {
  CLIENT_HELLO: 4006, // k_EMsgGCClientHello
  CLIENT_WELCOME: 4004, // k_EMsgGCClientWelcome
  CLIENT_CONNECTION_STATUS: 4009, // k_EMsgGCClientConnectionStatus (sent when the GC session drops)
  FIND_SOURCETV_GAMES: 8009, // k_EMsgClientToGCFindTopSourceTVGames
  FIND_SOURCETV_GAMES_RESPONSE: 8010, // k_EMsgGCToClientFindTopSourceTVGamesResponse
};

function varint(value) {
  let n = BigInt.asUintN(64, BigInt(value));
  const bytes = [];
  while (n > 0x7fn) {
    bytes.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

const key = (field, wire) => varint((field << 3) | wire);
const varintField = (field, value) => Buffer.concat([key(field, 0), varint(value)]);

// CMsgClientHello { engine (7) = k_ESE_Source2 (1) }
export function encodeClientHello() {
  return varintField(7, 1);
}

// CMsgClientToGCFindTopSourceTVGames { lobby_ids (6, repeated uint64) }
export function encodeFindLobbies(lobbyIds) {
  return Buffer.concat(lobbyIds.map(id => varintField(6, id)));
}

function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (offset >= buffer.length) throw new RangeError('Truncated varint');
    const byte = buffer[offset++];
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [result, offset];
    shift += 7n;
    if (shift > 63n) throw new RangeError('Varint too long');
  }
}

// Generic decoder: Map<fieldNumber, Array<bigint | Buffer>>.
export function decodeFields(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    let tag;
    [tag, offset] = readVarint(buffer, offset);
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    let value;
    if (wire === 0) [value, offset] = readVarint(buffer, offset);
    else if (wire === 1) { if (offset + 8 > buffer.length) throw new RangeError('Truncated fixed64'); value = buffer.readBigUInt64LE(offset); offset += 8; }
    else if (wire === 5) { if (offset + 4 > buffer.length) throw new RangeError('Truncated fixed32'); value = BigInt(buffer.readUInt32LE(offset)); offset += 4; }
    else if (wire === 2) {
      let length;
      [length, offset] = readVarint(buffer, offset);
      const end = offset + Number(length);
      if (end > buffer.length) throw new RangeError('Truncated bytes');
      value = buffer.subarray(offset, end);
      offset = end;
    } else throw new RangeError(`Unsupported wire type ${wire}`);
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

const first = (fields, field) => fields.get(field)?.[0];
const uint = (fields, field) => first(fields, field) ?? 0n;
const int32 = (fields, field) => Number(BigInt.asIntN(32, uint(fields, field)));

// CSourceTVGameSmall: server_steam_id 3, lobby_id 4, game_time 7, delay 8, game_mode 10, average_mmr 11,
// match_id 12, players 22 { account_id 1, hero_id 2, team_slot 3, team 4 }
export function decodeGame(buffer) {
  const fields = decodeFields(buffer);
  return {
    serverSteamId: String(uint(fields, 3)),
    lobbyId: String(uint(fields, 4)),
    gameTime: int32(fields, 7),
    delay: Number(uint(fields, 8)),
    gameMode: Number(uint(fields, 10)),
    averageMmr: Number(uint(fields, 11)),
    matchId: String(uint(fields, 12)),
    players: (fields.get(22) || []).map(player => {
      const p = decodeFields(player);
      return {accountId: String(uint(p, 1)), heroId: int32(p, 2), teamSlot: Number(uint(p, 3)), team: Number(uint(p, 4)), fields: [...p.keys()].sort((a, b) => a - b)};
    }),
  };
}

// CMsgGCToClientFindTopSourceTVGamesResponse: num_games 5, game_list 7, specific_games 8
export function decodeFindResponse(buffer) {
  const fields = decodeFields(buffer);
  return {
    numGames: Number(uint(fields, 5)),
    specificGames: uint(fields, 8) === 1n,
    games: (fields.get(7) || []).map(decodeGame),
  };
}

// Test helpers: encode messages shaped like the GC's responses.
export function encodeGameForTest({lobbyId, matchId, gameTime = 0, delay = 0, players = []}) {
  const player = p => {
    const body = Buffer.concat([varintField(1, p.accountId), varintField(2, p.heroId ?? 0), varintField(3, p.teamSlot ?? 0), varintField(4, p.team ?? 0)]);
    return Buffer.concat([key(22, 2), varint(body.length), body]);
  };
  return Buffer.concat([varintField(4, lobbyId), varintField(7, gameTime), varintField(8, delay), varintField(12, matchId), ...players.map(player)]);
}

export function encodeFindResponseForTest(games) {
  const parts = [varintField(5, games.length), varintField(8, 1)];
  for (const game of games) {
    const body = encodeGameForTest(game);
    parts.push(Buffer.concat([key(7, 2), varint(body.length), body]));
  }
  return Buffer.concat(parts);
}
