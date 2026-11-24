import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const files = ['web/styles.css', 'web/war-room.css', 'web/onboarding-demo.css'];
const sheets = await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')]));
const values = (css, property) => [...css.matchAll(new RegExp(`${property}:\\s*([^;}]+)`, 'g'))].map(match => match[1].replace('!important', '').trim());

test('the whole site uses one installed font family', () => {
  const css = sheets.map(([, text]) => text).join('\n');
  assert.doesNotMatch(css, /Barlow|Arial Narrow|Roboto Condensed/);
  assert.equal(css.match(/--heading:\s*([^;]+)/)[1].trim(), 'var(--body)');
  assert.match(css.match(/--body:\s*([^;]+)/)[1], /^-apple-system,/);
});

test('type uses a small consistent set of weights and tracking', () => {
  for (const [file, css] of sheets) {
    for (const weight of values(css, 'font-weight')) assert.ok(['400', '500', '600', '700', 'inherit', 'normal'].includes(weight), `${file}: weight ${weight}`);
    for (const spacing of values(css, 'letter-spacing')) assert.ok(['0', '.05em', '-.02em'].includes(spacing), `${file}: tracking ${spacing}`);
  }
});

test('readable text is at least 11px, except compact hero tile badges', () => {
  for (const [file, css] of sheets) {
    const text = css.replace(/\.tile-mark,\.tile-win\{[^}]*\}/g, '');
    for (const size of values(text, 'font-size')) {
      const px = size.match(/^([\d.]+)px$/)?.[1];
      if (px) assert.ok(Number(px) >= 11, `${file}: font-size ${size}`);
    }
  }
});
