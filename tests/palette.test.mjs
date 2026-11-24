import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const files = ['web/styles.css', 'web/war-room.css', 'web/onboarding-demo.css'];
const sheets = await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')]));
const styles = sheets[0][1];
const root = styles.match(/:root\s*\{[^}]*\}/)[0];
const graphite = {
  bg: '#0f1115', surface: '#171a20', raised: '#21252d', line: '#323844', text: '#eef1f5', muted: '#a6afbd', accent: '#4cc9f0',
  'on-accent': '#06161d', ally: '#6ff0b4', enemy: '#ff5c79', pick: '#5b93ff', ban: '#ff9233', both: '#ffe066', 'on-badge': '#101216',
};

test('the site defines the Graphite Signal palette once', () => {
  for (const [name, hex] of Object.entries(graphite)) assert.match(root, new RegExp(`--${name}:\\s*${hex};`), name);
  assert.equal((styles.match(/:root\s*\{/g) || []).length, 1);
});

test('stylesheets use palette roles instead of raw colors', () => {
  for (const [file, css] of sheets) {
    const body = file === 'web/styles.css' ? css.replace(root, '') : css;
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `${file} has a raw hex color`);
    assert.doesNotMatch(body, /\brgba?\(|\bhsla?\(/i, `${file} has a raw rgb or hsl color`);
  }
});

test('the browser theme color matches the page background', async () => {
  const html = await readFile('web/index.html', 'utf8');
  assert.match(html, /<meta name="theme-color" content="#0f1115"/);
});
