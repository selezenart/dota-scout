import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import * as C from '../web/constants.js';
import {WEIGHTS} from '../web/engine-weights.js';
import {CM_ORDER, CM_PHASE_STARTS} from '../web/draft-engine.js';
import {mountBattleCup} from '../web/bcup.js';
import {loadPlayer} from '../web/data.js';

const markup = await readFile('web/index.html', 'utf8');

test('shared constants keep their values', () => {
  assert.equal(C.DAY_MS, 86400000);
  assert.equal(C.HISTORY_WINDOW_DAYS, 180);
  assert.equal(C.RECENT_WINDOW_DAYS, 30);
  assert.equal(C.CURRENT_CUP_HOURS, 16);
  assert.equal(C.BATTLE_CUP_LOBBY, 9);
  assert.equal(C.ROSTER_SIZE, 5);
  assert.deepEqual([...C.ROLE_NAMES], ['Carry', 'Mid', 'Offlane', 'Soft support', 'Hard support']);
  assert.ok(Object.isFrozen(C.ROLE_NAMES));
  assert.equal(C.STEAM_ID64_BASE, 76561197960265728n);
  assert.equal(C.DISPLAY_NAME_MAX, 80);
  assert.equal(C.HERO_LIST_MAX, 12);
  assert.equal(C.TOP_RECOMMENDATIONS, 8);
  assert.equal(C.LOCAL_HELPER_ORIGIN, 'http://localhost:8765');
});

test('draft order phases start where Captains Mode phases start', () => {
  assert.equal(CM_ORDER.length, 24);
  assert.deepEqual(CM_PHASE_STARTS, [0, 7, 9, 12, 18, 22]);
});

test('engine weights are frozen and unchanged', () => {
  assert.ok(Object.isFrozen(WEIGHTS) && Object.values(WEIGHTS).every(Object.isFrozen));
  assert.deepEqual(JSON.parse(JSON.stringify(WEIGHTS)), {
    role: {tagFit: 4, preferred: 10, comfortMax: 5, perComfort: 2, compositionPerRole: 2, observedLaneCap: 4},
    profile: {signature: 20, desired: 5},
    experience: {perLog2Games: 3, gamesCap: 12, perRecent: 3, recentCap: 12, perCup: 6, cupCap: 18, perCurrentCup: 18, currentCupCap: 36},
    deny: {divisor: 8, cap: 5},
    matchups: {scale: 20, priorGames: 50},
    stratz: {minGames: 50, counterMultiplier: 0.5, counterCap: 5, synergyMultiplier: 0.35, synergyCap: 3.5, noteThreshold: 2, banMinimum: 2},
    meta: {minHighPicks: 200, minProGames: 5, proDampGames: 300, banMinimum: 1, leadReason: 2},
    tags: {counterMatchup: 1, counterMatchupGames: 30, counterStratz: 1.5, meta: 1.5},
  });
});

test('static copies in index.html match the shared constants', () => {
  assert.equal(C.BATTLE_CUP_LABEL, 'Saturday 20:00 Kyiv');
  assert.ok(markup.includes('Battle Cup signup · ' + C.BATTLE_CUP_LABEL));
  // The head script runs before modules load, so it keeps the key as a literal.
  assert.ok(markup.includes(`sessionStorage.getItem('${C.OAUTH_PROVIDER_KEY}')`));
  assert.equal(C.OAUTH_PROVIDER_KEY, 'captain-oauth-provider');
  for (const src of markup.match(/src="https:\/\/cdn\.[^"]+"/g)) assert.ok(src.slice(5).startsWith(C.HERO_PORTRAIT_BASE), src);
});

test('OpenDota history requests use the shared window', async () => {
  const paths = [];
  const queue = {request: async path => { paths.push(path); return []; }};
  await loadPlayer(7, () => {}, queue);
  assert.ok(paths.includes('/players/7/heroes?date=180'));
  assert.ok(paths.some(p => p.startsWith('/players/7/matches?date=180&significant=0&limit=100&')));
});

test('Battle Cup screen shows the schedule texts', async () => {
  const dom = new JSDOM('<main></main>');
  globalThis.document = dom.window.document;
  try {
    const root = document.querySelector('main');
    const page = mountBattleCup({root, getContext: () => ({demo: true})});
    await page.refresh();
    assert.match(root.querySelector('.cup-date').textContent, /^Saturday, \d+ \w+ \d{4} · 20:00 Kyiv$/);
    root.querySelector('[data-slot="6"]').click();
    root.querySelector('input[name="cup-position"][value="4"]').click();
    [...root.querySelectorAll('button')].find(b => b.textContent === 'Save my spot').click();
    const next = root.querySelector('.cup-next');
    assert.equal(next.querySelector('h2').textContent, 'Get ready for Saturday.');
    assert.equal(next.querySelector('p').textContent, 'Your spot is saved. Here are a few things to do before Saturday.');
  } finally { delete globalThis.document; dom.window.close(); }
});
