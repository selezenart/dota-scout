// Divine/Immortal hero counters and synergy from STRATZ, for one hero at a time.
// Served from public.stratz_matchups, which api/stratz-refresh.js fills once a day:
// STRATZ allows a token from only two IP addresses per 15 minutes, so board
// requests never reach STRATZ. Responses are cached by the CDN.
import heroes from '../web/heroes.json' with {type: 'json'};
import {createClient as supabaseClient} from '@supabase/supabase-js';
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

export function compactMatchup(json, heroId) {
  const entry = json?.data?.heroStats?.heroVsHeroMatchup?.advantage?.[0];
  if (!entry || !Array.isArray(entry.vs) || !Array.isArray(entry.with)) return null;
  const rows = list => list
    .filter(r => Number.isInteger(+r?.heroId2) && +r.heroId2 > 0 && +r.matchCount >= 1)
    .map(r => ({h: +r.heroId2, m: +r.matchCount, w: round(+r.winsAverage || 0, 3), s: round(+r.synergy || 0, 1)}));
  return {heroId: +heroId, vs: rows(entry.vs), with: rows(entry.with)};
}

export function createHandler({createClient = supabaseClient, env = process.env} = {}) {
  return async function handler(req, res) {
    const fail = (status, error) => { res.setHeader('Cache-Control', 'no-store'); res.status(status).json({error}); };
    // Answers the CDN may hold briefly, so retries from every board stay cheap.
    const failCached = (status, error, seconds) => {
      res.setHeader('Cache-Control', `public, s-maxage=${seconds}`); res.setHeader('Retry-After', String(seconds)); res.status(status).json({error});
    };
    // Exactly one canonical `hero` that is a real hero: anything else could bypass the CDN cache.
    const params = new URL(req.url || '', 'https://board.invalid').searchParams;
    const raw = String(req.query?.hero ?? params.get('hero') ?? '');
    const keys = [...params.keys()];
    const hero = /^[1-9]\d{0,2}$/.test(raw) ? Number(raw) : NaN;
    // The exact canonical query only: `?hero=1&`, `?%68ero=1` or `?hero=%31` would be new cache keys.
    const search = new URL(req.url || '', 'https://board.invalid').search;
    if ((keys.length && (keys.length !== 1 || keys[0] !== 'hero')) || !heroes[hero] || (search && search !== '?hero=' + hero)) return fail(400, 'Invalid hero');
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return failCached(503, 'STRATZ data is not configured', 300);
    try {
      // Read-only public table filled once a day by api/stratz-refresh.js; this never calls STRATZ.
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {auth: {persistSession: false, autoRefreshToken: false}});
      const {data, error} = await db.from('stratz_matchups').select('hero_id,vs,with').eq('hero_id', hero).maybeSingle();
      if (error) return fail(502, 'STRATZ data is unavailable');
      if (!data || !Array.isArray(data.vs) || !Array.isArray(data.with)) return failCached(404, 'No STRATZ data yet', 600);
      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json({heroId: hero, vs: data.vs, with: data.with});
    } catch {
      return fail(502, 'STRATZ data is unavailable');
    }
  };
}

export default createHandler();
