// Pure helpers for the Captain's Draft Board local helper.
// Nothing here touches the network, the game process or game memory.

const STEAM_ID64_BASE = 76561197960265728n;

export const DEFAULT_ALLOWED_ORIGINS = ['https://captains-draft.vercel.app', 'http://127.0.0.1:5173'];

// [A:1:account:instance] → SteamID64 (universe 1, account type 4 = anonymous game server).
export function anonServerSteamId64(accountId, instance) {
  return ((1n << 56n) | (4n << 52n) | (BigInt(instance) << 32n) | BigInt(accountId)).toString();
}

// Latest game server the client connected to, from Dota's console.log (-condebug).
export function serverSteamIdFromLog(text) {
  if (typeof text !== 'string' || !text) return null;
  const pattern = /\[A:1:(\d{1,10}):(\d{1,10})\]|steamid\s*:\s*(9\d{16})(?!\d)|\((9\d{16})\)/gi;
  let found = null;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) found = anonServerSteamId64(match[1], match[2]);
    else found = match[3] || match[4];
  }
  return found;
}

// Account id (32-bit) of the most recent Steam login, from Steam's config/loginusers.vdf.
export function localAccountFromLoginUsers(vdfText) {
  if (typeof vdfText !== 'string') return null;
  const users = [];
  const block = /"(7656119\d{10})"\s*\{([^{}]*)\}/g;
  for (const [, id64, body] of vdfText.matchAll(block)) {
    users.push({id64, recent: /"MostRecent"\s*"1"/i.test(body)});
  }
  const user = users.find(entry => entry.recent) || (users.length === 1 ? users[0] : null);
  if (!user) return null;
  const account = BigInt(user.id64) - STEAM_ID64_BASE;
  return account > 0n && account < 4294967296n ? account.toString() : null;
}

// Steam library roots from steamapps/libraryfolders.vdf.
export function libraryPathsFromVdf(vdfText) {
  if (typeof vdfText !== 'string') return [];
  return [...vdfText.matchAll(/"path"\s*"((?:[^"\\]|\\.)*)"/gi)].map(match => match[1].replace(/\\(.)/g, '$1'));
}

// Shape an IDOTA2MatchStats_570/GetRealtimeStats response for web/live-roster.js.
export function shapeLiveRoster(stats, localAccountId) {
  const waiting = message => ({status: 'waiting', message});
  try {
    const matchId = String(stats?.match?.matchid ?? '');
    if (!/^\d+$/.test(matchId) || /^0+$/.test(matchId)) return waiting('Waiting for Valve to publish the live match.');
    const local = String(localAccountId ?? '');
    if (!/^\d+$/.test(local) || /^0+$/.test(local)) return waiting('Could not identify your Dota account on this PC.');
    const sides = new Map([[2, []], [3, []]]);
    for (const team of Array.isArray(stats.teams) ? stats.teams : []) {
      for (const player of Array.isArray(team?.players) ? team.players : []) {
        const side = Number(team.team_number ?? player?.team);
        if (sides.has(side)) sides.get(side).push(String(player?.accountid ?? ''));
      }
    }
    const teams = [2, 3].map(side => ({side, ids: sides.get(side)}));
    const ids = teams.flatMap(team => team.ids);
    if (teams.some(team => team.ids.length !== 5)) return waiting('Waiting for both teams to have five players.');
    if (ids.some(id => !/^\d+$/.test(id) || /^0+$/.test(id))) return waiting('Some players are hidden or bots; enter the lineup manually.');
    if (new Set(ids).size !== 10) return waiting('Waiting for ten distinct players.');
    if (!ids.includes(local)) return waiting('Your account is not in this match yet.');
    return {status: 'ready', matchId, accountId: local, teams};
  } catch {
    return waiting('Waiting for a live match.');
  }
}

export function corsHeaders(origin, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  if (origin === undefined) return {};
  if (!allowedOrigins.includes(origin)) return null;
  return {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'};
}

// Reject other host names so a DNS-rebinding page cannot read the helper.
export function isLocalHost(hostHeader, port) {
  if (typeof hostHeader !== 'string') return false;
  const host = hostHeader.toLowerCase();
  return ['localhost', '127.0.0.1', '[::1]'].some(name => host === `${name}:${port}`);
}

export function steamKeyFrom(envValue, fileText) {
  const fromEnv = typeof envValue === 'string' ? envValue.trim() : '';
  if (fromEnv) return fromEnv;
  if (typeof fileText !== 'string') return null;
  const line = fileText.replace(/^﻿/, '').split(/\r?\n/).map(entry => entry.trim()).find(entry => entry && !entry.startsWith('#'));
  return line || null;
}

export function redact(text, secret) {
  const value = String(text);
  return secret ? value.split(secret).join('[redacted]') : value;
}
