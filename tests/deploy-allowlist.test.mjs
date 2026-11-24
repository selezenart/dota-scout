import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';

test('every web runtime file is included in the Vercel upload allowlist', async () => {
  const allowed = new Set((await readFile('.vercelignore', 'utf8')).split('\n').map(line => line.trim()));
  const files = (await readdir('web', {withFileTypes: true}))
    .filter(entry => entry.isFile() && /\.(html|js|css|json)$/.test(entry.name))
    .map(entry => `web/${entry.name}`);
  assert.deepEqual(files.filter(file => !allowed.has(`!${file}`)), []);
});
