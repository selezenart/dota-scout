// Daily STRATZ refresh: fetches Divine/Immortal counters and synergy for every
// hero in one run and stores them in Supabase (public.stratz_matchups).
// STRATZ allows a token from only two IP addresses per 15 minutes, so STRATZ is
// called only from this job, never per board request. Vercel Schedules call it
// with `Authorization: Bearer <CRON_SECRET>`; each environment runs its own slot
// at a different hour so their runs never share a 15-minute window.
import {timingSafeEqual} from 'node:crypto';
import {createClient as supabaseClient} from '@supabase/supabase-js';
import heroes from '../web/heroes.json' with {type: 'json'};
import {compactMatchup} from './stratz.js';

const ENDPOINT = 'https://api.stratz.com/graphql';
const BATCH = 5;
const FIELDS = 'advantage { heroId vs { heroId2 matchCount winsAverage synergy } with { heroId2 matchCount winsAverage synergy } }';
const allHeroIds = () => Object.keys(heroes).map(Number).filter(id => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function refreshStratz({
  fetcher = (...args) => globalThis.fetch(...args), createClient = supabaseClient,
  env = process.env, sleep = wait, heroIds = allHeroIds(), now = Date.now,
} = {}) {
  const token = env.STRATZ_API_TOKEN;
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('STRATZ refresh is not configured');
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false, autoRefreshToken: false}});
  let stored = 0;
  const failed = [];
  const start = now();
  for (let i = 0; i < heroIds.length; i += BATCH) {
    const ids = heroIds.slice(i, i + BATCH);
    if (i > 0) await sleep(1500);
    // Stay inside the 300 s function limit: stop starting batches after 250 s.
    if (now() - start >= 250000) { failed.push(...heroIds.slice(i)); break; }
    const query = `{ heroStats { ${ids.map(id => `h${id}: heroVsHeroMatchup(heroId: ${id}, bracketBasicIds: [DIVINE_IMMORTAL], take: 200) { ${FIELDS} }`).join(' ')} } }`;
    let json = null;
    try {
      const response = await fetcher(ENDPOINT, {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + token, 'User-Agent': 'STRATZ_API', 'Content-Type': 'application/json'},
        body: JSON.stringify({query}),
        signal: AbortSignal.timeout(15000),
      });
      // Blocked or rate limited: stop now so the run does not use up the token.
      if (response.status === 403 || response.status === 429) { failed.push(...heroIds.slice(i)); break; }
      if (response.ok) json = await response.json();
    } catch { json = null; }
    if (!json || json.errors) { failed.push(...ids); continue; }
    const updatedAt = new Date().toISOString();
    const rows = [];
    for (const id of ids) {
      const body = compactMatchup({data: {heroStats: {heroVsHeroMatchup: json.data?.heroStats?.['h' + id]}}}, id);
      if (body) rows.push({hero_id: id, vs: body.vs, with: body.with, updated_at: updatedAt});
      else failed.push(id);
    }
    if (!rows.length) continue;
    let error = null;
    try { ({error} = await db.from('stratz_matchups').upsert(rows, {onConflict: 'hero_id'})); } catch (thrown) { error = thrown || true; }
    if (error) failed.push(...rows.map(row => row.hero_id));
    else stored += rows.length;
  }
  failed.sort((a, b) => a - b);
  if (!stored) throw new Error('STRATZ refresh stored nothing (' + failed.length + ' heroes failed)');
  return {stored, failed};
}

const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createRefreshHandler({refresh = refreshStratz, env = process.env} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const secret = env.CRON_SECRET;
    if (!secret || secret.length < 16) return res.status(503).json({error: 'Refresh is not configured'});
    if (!sameSecret(req.headers?.authorization || '', 'Bearer ' + secret)) return res.status(401).json({error: 'Unauthorized'});
    const slot = String(req.query?.slot ?? new URL(req.url || '', 'https://board.invalid').searchParams.get('slot') ?? '');
    if (slot !== 'prod' && slot !== 'preview') return res.status(400).json({error: 'Invalid slot'});
    // Each environment runs only its own slot, at its own hour.
    if ((slot === 'prod') !== (env.VERCEL_ENV === 'production')) return res.status(200).json({skipped: true});
    try {
      const {stored, failed} = await refresh();
      return res.status(200).json({stored, failed});
    } catch {
      return res.status(500).json({error: 'STRATZ refresh failed'});
    }
  };
}

export default createRefreshHandler();
