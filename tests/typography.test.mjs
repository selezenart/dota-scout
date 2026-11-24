import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const files = ['web/styles.css', 'web/war-room.css', 'web/onboarding-demo.css'];
const sheets = await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')]));
const css = sheets.map(([, text]) => text).join('\n');
const root = css.match(/:root\s*\{[^}]*\}/)[0];
const values = (text, property) => [...text.matchAll(new RegExp(`(?<![-\\w])${property}:\\s*([^;}]+)`, 'g'))].map(match => match[1].replace('!important', '').trim());
const tokens = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];

test('the site bundles one font family with system fallbacks', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')), main = await readFile('web/main.js', 'utf8');
  assert.equal(pkg.dependencies['@fontsource-variable/inter'], '5.3.0');
  assert.match(main, /^import '@fontsource-variable\/inter';/m);
  assert.match(root, /--font-sans:\s*"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto/);
  assert.match(root, /--heading:\s*var\(--font-sans\)/);
  assert.match(root, /--body:\s*var\(--font-sans\)/);
  assert.doesNotMatch(css, /Barlow|Arial Narrow|Roboto Condensed|font-stretch|font-variation-settings/);
});

test('type sizes come from one fluid rem scale', () => {
  for (const name of tokens) assert.match(root, new RegExp(`--text-${name}:\\s*clamp\\([\\d.]+rem, [^)]*vw[^)]*, [\\d.]+rem\\)`), name);
  assert.match(root, /--text-badge:\s*0\.625rem/);
  assert.match(css, /text-size-adjust:\s*100%/);
  const outsideRoot = css.replace(root, '');
  for (const size of values(outsideRoot, 'font-size')) assert.match(size, /^(var\(--text-(xs|sm|md|lg|xl|2xl|3xl|badge)\)|inherit|1em|0)$/, `font-size ${size}`);
  for (const font of values(outsideRoot, 'font')) assert.doesNotMatch(font, /\d(px|rem)\b/, `font ${font}`);
});

test('type uses a small consistent set of weights and tracking', () => {
  for (const [file, text] of sheets) {
    for (const weight of values(text, 'font-weight')) assert.ok(['400', '500', '600', '700', 'inherit', 'normal'].includes(weight), `${file}: weight ${weight}`);
    for (const spacing of values(text, 'letter-spacing')) assert.ok(['0', '.05em', '-.02em'].includes(spacing), `${file}: tracking ${spacing}`);
  }
});

test('hero search has no slash hint and keeps text away from its border', async () => {
  const html = await readFile('web/index.html', 'utf8'), room = sheets.find(([file]) => file === 'web/war-room.css')[1];
  assert.doesNotMatch(html.match(/<div class="search-bar">[\s\S]*?<\/div>/)[0], /<kbd/);
  assert.match(room, /#draft-view \.search-bar\{[^}]*padding:0 12px[^}]*gap:8px/);
  assert.match(room, /#draft-view \.search-bar input\{[^}]*padding:0 4px/);
});
