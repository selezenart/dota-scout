// Divine/Immortal hero counters and synergy from STRATZ, for one hero at a time.
// The token stays server-side; responses are cached by the CDN and shared by every
// visitor, so the default STRATZ token limits are enough.
import heroes from '../web/heroes.json' with {type: 'json'};
const ENDPOINT = 'https://api.stratz.com/graphql';
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

export function compactMatchup(json, heroId) {
  const entry = json?.data?.heroStats?.heroVsHeroMatchup?.advantage?.[0];
  if (!entry || !Array.isArray(entry.vs) || !Array.isArray(entry.with)) return null;
  const rows = list => list
    .filter(r => Number.isInteger(+r?.heroId2) && +r.heroId2 > 0 && +r.matchCount >= 1)
    .map(r => ({h: +r.heroId2, m: +r.matchCount, w: round(+r.winsAverage || 0, 3), s: round(+r.synergy || 0, 1)}));
  return {heroId: +heroId, vs: rows(entry.vs), with: rows(entry.with)};
}

export function createHandler({fetcher = (...args) => globalThis.fetch(...args), env = process.env} = {}) {
  return async function handler(req, res) {
    const fail = (status, error) => { res.setHeader('Cache-Control', 'no-store'); res.status(status).json({error}); };
    // Failures the CDN may hold briefly, so retries from every board do not reach STRATZ.
    const failCached = (status, error, seconds) => {
      res.setHeader('Cache-Control', `public, s-maxage=${seconds}`); res.setHeader('Retry-After', String(seconds)); res.status(status).json({error});
    };
    // Exactly one canonical `hero` that is a real hero: anything else could bypass the CDN cache.
    const params = new URL(req.url || '', 'https://board.invalid').searchParams;
    const raw = String(req.query?.hero ?? params.get('hero') ?? '');
    const keys = [...params.keys()];
    const hero = /^[1-9]\d{0,2}$/.test(raw) ? Number(raw) : NaN;
    if ((keys.length && (keys.length !== 1 || keys[0] !== 'hero')) || !heroes[hero]) return fail(400, 'Invalid hero');
    const token = env.STRATZ_API_TOKEN;
    if (!token) return failCached(503, 'STRATZ is not configured', 300);
    const query = `{ heroStats { heroVsHeroMatchup(heroId: ${hero}, bracketBasicIds: [DIVINE_IMMORTAL], take: 200) {
      advantage { heroId vs { heroId2 matchCount winsAverage synergy } with { heroId2 matchCount winsAverage synergy } } } } }`;
    try {
      const response = await fetcher(ENDPOINT, {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + token, 'User-Agent': 'STRATZ_API', 'Content-Type': 'application/json'},
        body: JSON.stringify({query}),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return response.status === 429 ? failCached(502, 'STRATZ rate limit reached', 120) : fail(502, 'STRATZ request failed (' + response.status + ')');
      const json = await response.json();
      if (json?.errors) return fail(502, 'STRATZ returned an error');
      const body = compactMatchup(json, hero);
      if (!body) return failCached(502, 'STRATZ returned no matchup data', 3600);
      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json(body);
    } catch {
      return fail(502, 'STRATZ is unavailable');
    }
  };
}

export default createHandler();
