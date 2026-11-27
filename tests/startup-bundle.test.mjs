import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {HERO_FIELDS, trimHeroes} from '../scripts/trim-heroes.mjs';
import {enemySummary, recommend, reviewLineup} from '../web/draft-engine.js';
import {createWelcome} from '../web/welcome.js';

const snapshot = JSON.parse(await readFile('web/heroes.json', 'utf8'));
const expected = ['id', 'localized_name', 'name', 'primary_attr', 'pub_pick', 'roles'];
// Only OpenDota's live /heroStats rows carry these; the offline snapshot never had them.
const liveOnly = ['7_pick', '7_win', '8_pick', '8_win', 'pro_ban', 'pro_pick', 'pro_win'];
// Upstream OpenDota hero fields that are deliberately left out of the snapshot.
const dropped = ['attack_type', 'img', 'icon', 'base_health', 'base_health_regen', 'base_mana', 'base_mana_regen',
  'base_armor', 'base_mr', 'base_attack_min', 'base_attack_max', 'base_str', 'base_agi', 'base_int', 'str_gain',
  'agi_gain', 'int_gain', 'attack_range', 'projectile_speed', 'attack_rate', 'base_attack_time', 'attack_point',
  'move_speed', 'turn_rate', 'cm_enabled', 'legs', 'day_vision', 'night_vision'];

test('heroes.json carries exactly the required fields for every hero', () => {
  assert.deepEqual([...HERO_FIELDS].sort(), expected);
  assert.ok(Object.keys(snapshot).length >= 127);
  for (const [key, hero] of Object.entries(snapshot)) {
    assert.deepEqual(Object.keys(hero).sort(), expected, 'hero ' + key);
    assert.equal(hero.id, Number(key));
    for (const field of ['name', 'localized_name', 'primary_attr']) assert.ok(typeof hero[field] === 'string' && hero[field], key + ' ' + field);
    assert.ok(Array.isArray(hero.roles) && hero.roles.length, key + ' roles');
    assert.ok(Number.isFinite(hero.pub_pick), key + ' pub_pick');
  }
});

test('no shipped code reads a hero field that the snapshot dropped', async () => {
  const sources = [];
  for (const dir of ['web', 'api']) for (const file of await readdir(dir)) if (file.endsWith('.js')) sources.push(dir + '/' + file);
  const read = new RegExp(`(?:\\?\\.|\\.)(?:${dropped.join('|')})(?![\\w$])|\\[\\s*['"\`](?:${dropped.join('|')})['"\`]\\s*\\]`);
  const texts = await Promise.all(sources.map(async file => [file, await readFile(file, 'utf8')]));
  for (const [file, text] of texts) assert.equal(text.match(read)?.[0], undefined, file);
  // Every kept field must still have a reader, so the list cannot rot.
  for (const field of HERO_FIELDS) assert.ok(texts.some(([, text]) => new RegExp(`\\.${field}(?![\\w$])`).test(text)), field + ' has no reader');
});

test('draft engine reads only snapshot or live meta fields from heroes', () => {
  const reads = new Set();
  const heroes = Object.fromEntries(Object.entries(snapshot).map(([id, hero]) => [id, new Proxy(hero, {
    get(target, key) { if (typeof key === 'string') reads.add(key); return target[key]; },
  })]));
  const player = {id: 'p1', name: 'Player', matches: [{match_id: 1, hero_id: 1, lane_role: 1, start_time: 1000, lobby_type: 9}],
    selfReport: {signatureHeroes: [1], desiredHeroes: [2]}};
  const stratz = {2: {vs: [{h: 1, m: 100, w: 0.4, s: -4}], with: []}};
  const draft = [{mode: 'ourPick', heroId: 3}, {mode: 'enemyPick', heroId: 2}];
  assert.ok(recommend({heroes, draft, allies: [player], stratz, now: 2000, mode: 'ourPick'}).length);
  reviewLineup({draft, stratz, heroes});
  enemySummary(player, {now: 2000, heroes: Object.values(heroes)});
  assert.ok(reads.has('roles'));
  assert.deepEqual([...reads].filter(key => !HERO_FIELDS.includes(key) && !liveOnly.includes(key)), []);
});

test('trim script keeps only the listed fields and rejects incomplete input', () => {
  const full = {...snapshot[1], base_health: 120, img: '/x.png', '7_pick': 5};
  const out = trimHeroes([full]);
  assert.deepEqual(Object.keys(out), ['1']);
  assert.deepEqual(Object.keys(out[1]).sort(), expected);
  assert.deepEqual(trimHeroes({1: full}), out);
  const {pub_pick, ...incomplete} = full;
  assert.throws(() => trimHeroes([incomplete]), /pub_pick/);
  assert.throws(() => trimHeroes([]), /No heroes/);
});

test('Google button icon is a small four-colour inline SVG', async () => {
  const dom = new JSDOM('<div id="welcome-auth"></div>', {url: 'https://board.example/'});
  for (const key of ['document', 'location', 'history']) globalThis[key] = dom.window[key];
  try {
    createWelcome({getBackend: () => null}).form('signin');
    const icon = document.querySelector('.google-auth-button img');
    assert.equal(icon.getAttribute('alt'), '');
    assert.ok(icon.src.startsWith('data:image/svg+xml,'));
    assert.ok(icon.src.length < 2000, 'icon is ' + icon.src.length + ' characters');
    const svg = decodeURIComponent(icon.src.slice(icon.src.indexOf(',') + 1));
    for (const colour of ['#4285F4', '#34A853', '#FBBC05', '#EA4335']) assert.ok(svg.includes(colour), colour);
    const parsed = new dom.window.DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(parsed.querySelector('parsererror'), null);
    assert.equal(parsed.querySelectorAll('path').length, 4);
    assert.ok(!(await readFile('web/welcome.js', 'utf8')).includes('base64'));
  } finally {
    dom.window.close();
    for (const key of ['document', 'location', 'history']) delete globalThis[key];
  }
});
