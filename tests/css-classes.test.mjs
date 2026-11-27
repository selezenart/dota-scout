import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

// Classes the app builds from a prefix plus data, so they never appear whole in the source.
// Each entry names the source pattern that builds it; the test fails if that pattern disappears.
const dynamic = [
  {prefix: 'rec-badge-', built: /rec-badge-'\+/},
  {prefix: 'rec-tag-', built: /rec-tag-'\+/},
  {prefix: 'review-note-', built: /review-note-'\+/},
  {prefix: 'tier-', built: /tier-'\+/},
  {prefix: 'is-sug-', built: /'is-'\+mark\.kind/},
  {prefix: 'is-contested', built: /'is-'\+mark\.kind/},
];

const stylesheets = ['web/styles.css', 'web/war-room.css', 'web/onboarding-demo.css', 'web/legal.css'];
const sourceFiles = (await readdir('web')).filter(file => /\.(js|html)$/.test(file)).map(file => 'web/' + file);
const source = (await Promise.all(sourceFiles.map(file => readFile(file, 'utf8')))).join('\n');

// Class names used in selectors, including those inside @media/@supports: drop comments and the
// innermost (declaration) blocks once, then at-rule preludes, attribute selectors and strings.
function selectorClasses(css) {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, ';');
  text = text.replace(/@[^{;]*/g, '').replace(/[{}]/g, ';');
  text = text.replace(/\[[^\]]*\]/g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '');
  return new Set([...text.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(match => match[1]));
}

const referenced = name => new RegExp(`(?<![\\w-])${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(source);

test('class extraction sees selectors inside @media blocks and ignores values', () => {
  const found = selectorClasses('.top{color:red} @media (max-width: 1.5em){.inner > .deep:hover{margin:.5rem}} @keyframes k{12.5%{opacity:.4}}');
  assert.deepEqual([...found].sort(), ['deep', 'inner', 'top']);
});

// Matches the bare word, so classes named after common words (pick, primary) always count as used.
test('every class a stylesheet styles is set somewhere in web/', async () => {
  const unused = [];
  for (const file of stylesheets) {
    for (const name of selectorClasses(await readFile(file, 'utf8'))) {
      if (referenced(name) || dynamic.some(entry => name.startsWith(entry.prefix))) continue;
      unused.push(`${file}: .${name}`);
    }
  }
  assert.deepEqual(unused, [], 'remove the rules or add the class to the markup');
});

test('the dynamic class allowlist still matches how the app builds those classes', () => {
  for (const entry of dynamic) assert.match(source, entry.built, entry.prefix);
});
