// Golden test: recommend() output must stay byte-identical to the output captured
// from the engine before the hot-path refactor (tests/fixtures/recommend-golden.json).
// Each case stores a SHA-256 of the full serialised output (every hero, score,
// reason, evidence line, component and detail row) plus a readable summary that
// gives a useful diff when the hash changes.
// Regenerate only for an approved behaviour change: UPDATE_GOLDEN=1 node --test tests/recommend-golden.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {recommend} from '../web/draft-engine.js';
import {scenarios, serialize} from './recommend-scenarios.js';

const file = new URL('./fixtures/recommend-golden.json', import.meta.url);
const summary = out => ({
  count: out.length,
  ranking: out.map(r => `${r.heroId}:${r.score}:${r.playerId ?? '-'}:${r.position ?? '-'}:${r.tags.join('+')}`).join(' '),
  top: out.slice(0, 3).map(r => ({heroId: r.heroId, score: r.score, reasons: r.reasons, evidence: r.evidence})),
});
const capture = () => scenarios().map(({name, input}) => {
  const text = serialize(recommend(input));
  return {name, sha256: createHash('sha256').update(text).digest('hex'), bytes: text.length, ...summary(JSON.parse(text))};
});

if (process.env.UPDATE_GOLDEN) writeFileSync(file, JSON.stringify({cases: capture()}, null, 1) + '\n');
const golden = JSON.parse(readFileSync(file, 'utf8')).cases;

test('golden recommend() fixtures cover every scenario', () => {
  assert.deepEqual(scenarios().map(s => s.name), golden.map(c => c.name));
  assert.ok(golden.length >= 100);
  assert.ok(golden.filter(c => c.count > 0).length >= 80, 'most cases produce suggestions');
  assert.ok(golden.some(c => c.count === 0), 'rejected inputs are covered');
});

test('recommend() output is identical to the captured golden output', () => {
  const now = capture();
  for (const [i, c] of now.entries()) {
    if (c.sha256 === golden[i].sha256) continue;
    assert.deepEqual(c, golden[i], `case "${c.name}" changed`);
    assert.fail(`case "${c.name}" changed outside the summary (components, details or later rows)`);
  }
});
