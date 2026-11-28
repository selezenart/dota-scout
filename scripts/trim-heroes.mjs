// Writes web/heroes.json, the bundled offline hero snapshot, with only the fields the app reads.
// Usage: node scripts/trim-heroes.mjs [input.json]
// Refresh from a saved https://api.opendota.com/api/heroStats response: it has every field
// below (/constants/heroes has no pub_pick). Without an input, the current snapshot is re-trimmed.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const HERO_FIELDS = ['id', 'name', 'localized_name', 'primary_attr', 'roles', 'pub_pick'];

export function trimHeroes(input) {
  const heroes = Object.values(input);
  if (!heroes.length) throw new Error('No heroes in input');
  return Object.fromEntries(heroes.map(hero => {
    const missing = HERO_FIELDS.filter(field => hero?.[field] == null);
    if (missing.length) throw new Error(`Hero ${hero?.id} is missing ${missing.join(', ')}`);
    return [hero.id, Object.fromEntries(HERO_FIELDS.map(field => [field, hero[field]]))];
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = new URL('../web/heroes.json', import.meta.url);
  const input = JSON.parse(await readFile(process.argv[2] || output, 'utf8'));
  await writeFile(output, JSON.stringify(trimHeroes(input), null, 2) + '\n');
}
