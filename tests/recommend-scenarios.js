// Deterministic recommend() inputs shared by the golden test and the benchmark.
// Everything is generated from the real hero list and a seeded PRNG, so the
// captured output in tests/fixtures/recommend-golden.json stays reproducible.
import {readFileSync} from 'node:fs';
import {nextTurn} from '../web/draft-engine.js';

export const NOW = 1764200000; // seconds; fixed so history ages never drift
const heroesFile = JSON.parse(readFileSync(new URL('../web/heroes.json', import.meta.url), 'utf8'));

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pickOne = (r, list) => list[Math.floor(r() * list.length)];

// Hero pool keyed by id (as the app keeps it) with OpenDota bracket and pro stats.
export function buildHeroes(seed = 1) {
  const r = rng(seed), out = {};
  for (const h of Object.values(heroesFile)) {
    const p7 = int(r, 0, 9000), p8 = int(r, 0, 4000), pro = int(r, 0, 60);
    out[h.id] = {...h, '7_pick': p7, '7_win': Math.round(p7 * (0.42 + r() * 0.16)), '8_pick': p8, '8_win': Math.round(p8 * (0.42 + r() * 0.16)),
      pro_pick: pro, pro_win: Math.round(pro * r()), pro_ban: int(r, 0, 80)};
  }
  return out;
}
const ids = heroes => Object.values(heroes).map(h => +h.id);

// OpenDota /heroes/{id}/matchups for every hero, with a few unusable rows mixed in.
export function buildMatchups(heroes, seed = 2, {dirty = false} = {}) {
  const r = rng(seed), all = ids(heroes), out = {};
  for (const id of all) {
    const rows = [];
    for (const other of all) {
      if (other === id || r() < 0.08) continue;
      const games = int(r, 0, 400);
      rows.push({hero_id: other, games_played: games, wins: Math.round(games * (0.35 + r() * 0.3))});
    }
    if (dirty) {
      // Duplicates: the first row for a hero decides, even when unusable.
      const a = pickOne(r, all), b = pickOne(r, all);
      rows.unshift({hero_id: a, games_played: 10, wins: 20}, {hero_id: String(b), games_played: 200, wins: null});
      rows.push({hero_id: a, games_played: 300, wins: 200}, {hero_id: 'x', games_played: 50, wins: 25}, {hero_id: pickOne(r, all), games_played: 0, wins: 0});
    }
    out[id] = rows;
  }
  if (dirty) out.NaN = [{hero_id: 1, games_played: 100, wins: 60}];
  return out;
}

// STRATZ compact rows {h,m,w,s} per hero (vs and with), for a subset of heroes.
export function buildStratz(heroes, seed = 3, {dirty = false, coverage = 0.85} = {}) {
  const r = rng(seed), all = ids(heroes), out = {};
  for (const id of all) {
    if (r() > coverage) continue;
    const list = () => all.filter(o => o !== id && r() < 0.9).map(o => {
      const m = int(r, 0, 2000);
      return {h: o, m, w: +(0.38 + r() * 0.24).toFixed(3), s: +((r() - 0.5) * 16).toFixed(3)};
    });
    const entry = {vs: list(), with: list()};
    if (dirty) {
      const a = pickOne(r, all);
      // Low-sample row first, then a usable one for the same hero; then a later duplicate.
      entry.vs.unshift({h: a, m: 10, w: 0.9, s: 9}, {h: String(pickOne(r, all)), m: '120', w: '0.6', s: '3.5'});
      entry.vs.push({h: a, m: 900, w: 0.3, s: -7}, {h: 'bad', m: 500, w: 0.5, s: 1});
      entry.with.unshift({h: pickOne(r, all), m: 49, w: 0.7, s: 6});
    }
    out[id] = entry;
  }
  return out;
}

function playerRows(r, heroPool, {cup = false, withHistory = true} = {}) {
  if (!withHistory) return {heroes: [], recent: [], matches: []};
  const own = Array.from({length: int(r, 6, 25)}, () => pickOne(r, heroPool));
  const heroes = [...new Set(own)].map(hero_id => ({hero_id, games: int(r, 1, 300), win: null, last_played: NOW - int(r, 1, 400) * 86400}));
  heroes.push({hero_id: pickOne(r, heroPool), games: 50, last_played: NOW + 3600}); // future row: ignored
  const match = lobby => ({match_id: 7000000000 + int(r, 0, 1e8), hero_id: pickOne(r, own), start_time: NOW - int(r, 0, 200 * 86400),
    lane_role: int(r, 0, 4), is_roaming: r() < 0.05, lobby_type: lobby, radiant_win: r() < 0.5, player_slot: r() < 0.5 ? 1 : 129});
  const recent = Array.from({length: int(r, 5, 20)}, () => match(r() < 0.15 ? 9 : 7));
  const matches = Array.from({length: int(r, 20, 100)}, () => match(r() < 0.1 ? 9 : 0));
  if (cup) for (let i = 0; i < 4; i++) recent.push({...match(9), start_time: NOW - int(r, 600, 50000)});
  matches.push({...recent[0]}); // the same match in both lists counts once
  matches.push({hero_id: pickOne(r, own), start_time: NOW - 86400}); // no match_id: keyed by time/hero
  return {heroes, recent, matches};
}

export function buildPlayers(heroes, seed, {count = 5, prefix = 'p', selfReports = false, cup = false, withHistory = true} = {}) {
  const r = rng(seed), pool = ids(heroes);
  return Array.from({length: count}, (_, i) => {
    const p = {id: prefix + (i + 1), name: (prefix === 'a' ? 'Ally ' : 'Enemy ') + (i + 1), ...playerRows(r, pool, {cup, withHistory})};
    if (selfReports) p.selfReport = {
      signatureHeroes: [pickOne(r, pool), pickOne(r, pool)], desiredHeroes: [pickOne(r, pool), pickOne(r, pool), pickOne(r, pool)],
      avoidHeroes: [pickOne(r, pool)], preferredRoles: i === 4 ? [] : [i + 1, ...(r() < 0.5 ? [((i + 1) % 5) + 1] : [])],
      roleComfort: {[i + 1]: int(r, 2, 5), [((i + 2) % 5) + 1]: int(r, 0, 3)}};
    return p;
  });
}

// A full Captains Mode draft: 24 actions, deterministic hero choice; some of our
// picks carry a seat and position as the app records when a player is chosen.
export function buildDraft(heroes, seed = 4, firstPick = true, allies = []) {
  const r = rng(seed), pool = ids(heroes), draft = [], used = new Set();
  let ourPicks = 0;
  while (nextTurn(draft, firstPick)) {
    const turn = nextTurn(draft, firstPick);
    let heroId; do heroId = pickOne(r, pool); while (used.has(heroId));
    used.add(heroId);
    const action = {mode: turn.mode, heroId};
    if (turn.mode === 'ourPick' && allies.length) {
      if (ourPicks === 1) action.playerId = allies[1].id;
      if (ourPicks === 2) { action.playerId = allies[2].id; action.position = 3; }
      ourPicks++;
    }
    draft.push(action);
  }
  return draft;
}

export function scenarios() {
  const heroes = buildHeroes(), heroList = Object.values(heroes);
  const matchups = buildMatchups(heroes), dirtyMatchups = buildMatchups(heroes, 12, {dirty: true});
  const stratz = buildStratz(heroes), dirtyStratz = buildStratz(heroes, 13, {dirty: true, coverage: 0.5});
  const allies = buildPlayers(heroes, 5, {prefix: 'a', selfReports: true});
  const enemies = buildPlayers(heroes, 6, {prefix: 'e', cup: true});
  const draftA = buildDraft(heroes, 4, true, allies), draftB = buildDraft(heroes, 8, false, allies);
  const full = {heroes, allies, opponents: enemies, matchups, stratz, now: NOW};
  const out = [];
  const add = (name, input) => out.push({name, input});
  // Every turn of two full drafts, both pick orders, with all data sources.
  for (let n = 0; n < 24; n++) add(`full first-pick step ${n}`, {...full, draft: draftA.slice(0, n), firstPick: true});
  for (let n = 0; n < 24; n++) add(`full second-pick step ${n}`, {...full, draft: draftB.slice(0, n), firstPick: false});
  // Explicit modes on a mid draft (the app asks for pick and ban lists separately).
  for (const mode of ['ourPick', 'enemyPick', 'ourBan', 'enemyBan']) for (const n of [0, 9, 15, 20])
    add(`mode ${mode} at ${n}`, {...full, draft: draftA.slice(0, n), mode});
  // Missing data: no matchups, no STRATZ, no meta, no players, roles missing.
  const bare = Object.fromEntries(heroList.map(h => [h.id, {id: h.id, localized_name: h.localized_name, roles: h.id % 7 ? h.roles : []}]));
  for (const n of [0, 7, 13, 22]) {
    add(`heroes only at ${n}`, {heroes: bare, draft: draftA.slice(0, n), now: NOW});
    add(`no matchups or stratz at ${n}`, {heroes, allies, opponents: enemies, draft: draftA.slice(0, n), now: NOW});
    add(`matchups only at ${n}`, {heroes, allies, opponents: enemies, matchups, draft: draftA.slice(0, n), now: NOW});
    add(`stratz only at ${n}`, {heroes, allies, opponents: enemies, stratz, draft: draftA.slice(0, n), now: NOW});
    add(`dirty data at ${n}`, {...full, matchups: dirtyMatchups, stratz: dirtyStratz, draft: draftA.slice(0, n)});
    add(`heroes as array at ${n}`, {...full, heroes: heroList, draft: draftA.slice(0, n)});
    add(`now in milliseconds at ${n}`, {...full, now: NOW * 1000, draft: draftA.slice(0, n)});
  }
  // Partial rosters (guest seats), unavailable players, enemies without history.
  const three = allies.slice(0, 3), unavailable = allies.map((p, i) => i === 3 ? {...p, selfReport: {...p.selfReport, availability: 'unavailable'}} : p);
  const blindEnemies = buildPlayers(heroes, 9, {prefix: 'e', withHistory: false});
  for (const n of [0, 8, 13, 17, 21]) {
    add(`three allies at ${n}`, {...full, allies: three, draft: draftA.slice(0, n).map(a => a.playerId && !three.some(p => p.id === a.playerId) ? {...a, playerId: undefined} : a)});
    add(`unavailable ally at ${n}`, {...full, allies: unavailable, draft: draftA.slice(0, n)});
    add(`enemies without history at ${n}`, {...full, opponents: blindEnemies, draft: draftA.slice(0, n)});
    add(`no allies at ${n}`, {...full, allies: [], draft: draftA.slice(0, n)});
  }
  // Enemy picks attributed to enemy players (their history no longer denied).
  const attributed = draftA.map((a, i) => a.mode === 'enemyPick' ? {...a, playerId: enemies[i % 5].id} : a);
  for (const n of [9, 16, 23]) add(`attributed enemy picks at ${n}`, {...full, draft: attributed.slice(0, n)});
  // Tight role preferences: the reserved positions of the other players change who gets which hero.
  const r = rng(21), pool = ids(heroes);
  const picky = allies.map((p, i) => ({...p, selfReport: {...p.selfReport, preferredRoles: [[1, 2], [1, 2, 3], [2, 3], [4, 5], [3, 4, 5]][i],
    roleComfort: Object.fromEntries([1, 2, 3, 4, 5].map(pos => [pos, int(r, 0, 5)]))}}));
  for (const n of [7, 8, 13, 15, 16, 17, 22]) for (const firstPick of [true, false])
    add(`tight roles ${firstPick ? 'first' : 'second'} at ${n}`, {...full, allies: picky, firstPick, draft: (firstPick ? draftA : draftB).slice(0, n)});
  // Malformed rows: null rows and holes after every usable row, ahead of them (the
  // engine throws there), and unusual ids (strings, NaN, duplicates) in the pool and draft.
  const late = id => [...pool.filter(o => o !== id).map(o => ({h: o, m: 500, w: 0.5, s: (o % 7) - 3})), null];
  const lateStratz = {...stratz}, lateMatchups = {...matchups};
  for (const a of draftA.slice(0, 16)) {
    lateStratz[a.heroId] = {vs: late(a.heroId), with: late(a.heroId)};
    const rows = pool.filter(o => o !== a.heroId).map(o => ({hero_id: o, games_played: 100, wins: 40 + (o % 20)}));
    rows[rows.length + 2] = {hero_id: 1, games_played: 100, wins: 90}; // a hole before it
    lateMatchups[a.heroId] = rows;
  }
  for (const n of [9, 13, 16]) add(`null rows after usable rows at ${n}`, {...full, stratz: lateStratz, matchups: lateMatchups, draft: draftA.slice(0, n)});
  const early = {...stratz, [draftA[8].heroId]: {vs: [null, ...late(draftA[8].heroId)], with: []}};
  add('null STRATZ row first', {...full, stratz: early, draft: draftA.slice(0, 13)});
  add('null matchup row first', {...full, stratz: {}, matchups: {...matchups, [draftA[8].heroId]: [undefined, ...matchups[draftA[8].heroId]]}, draft: draftA.slice(0, 13)});
  const oddHeroes = {...heroes, x: {id: 'x', localized_name: 'Odd', roles: ['Carry']}, dup: {...heroes[pool[3]], id: String(pool[3])}};
  const stringDraft = draftA.map((a, i) => i % 3 ? a : {...a, heroId: String(a.heroId)});
  for (const n of [0, 9, 16]) add(`odd ids at ${n}`, {...full, heroes: oddHeroes, draft: stringDraft.slice(0, n)});
  // A NaN hero id meeting rows with non-numeric ids must still match nothing.
  for (const n of [9, 16]) add(`odd ids with dirty data at ${n}`, {...full, heroes: oddHeroes, matchups: dirtyMatchups, stratz: dirtyStratz, draft: stringDraft.slice(0, n)});
  add('NaN hero in draft', {...full, draft: [...draftA.slice(0, 8), {mode: draftA[8].mode, heroId: 'nope'}, ...draftA.slice(9, 13)]});
  // Inputs the engine rejects (and the same inputs on the enemy's turn, where allies are not used).
  for (const mode of ['ourPick', undefined]) {
    add(`duplicate roster ids ${mode}`, {...full, mode, allies: [allies[0], {...allies[1], id: allies[0].id}], draft: draftA.slice(0, 8)});
    add(`six allies ${mode}`, {...full, mode, allies: [...allies, {...allies[0], id: 'a6'}], draft: draftA.slice(0, 8)});
    add(`duplicate player locks ${mode}`, {...full, mode, draft: draftA.slice(0, 17).map(a => a.mode === 'ourPick' ? {...a, playerId: allies[0].id} : a)});
    add(`duplicate position locks ${mode}`, {...full, mode, draft: draftA.slice(0, 17).map(a => a.mode === 'ourPick' ? {...a, position: 2} : a)});
    add(`lock to unknown player ${mode}`, {...full, mode, draft: draftA.slice(0, 17).map(a => a.mode === 'ourPick' ? {...a, playerId: 'nobody'} : a)});
  }
  add('draft complete', {...full, draft: draftA});
  add('empty input', {});
  return out;
}

// Exact serialisation: keeps -0, NaN, Infinity and undefined distinguishable.
export function serialize(value) {
  return JSON.stringify(value, (k, v) => {
    if (typeof v === 'number' && (Object.is(v, -0) || !Number.isFinite(v))) return `<num:${Object.is(v, -0) ? '-0' : String(v)}>`;
    if (v === undefined) return '<undefined>';
    if (typeof v === 'symbol') return `<symbol:${v.description}>`;
    return v;
  });
}
