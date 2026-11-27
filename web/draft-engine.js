const phases = [['Ban','AABBABB'],['Pick','AB'],['Ban','AAB'],['Pick','BAABBA'],['Ban','ABAB'],['Pick','AB']];
export const CM_ORDER = phases.flatMap(([action, teams]) => [...teams].map(team => ({team, action})));
export function nextTurn(draft = [], firstPick = true) {
  const index = draft.length, step = CM_ORDER[index];
  if (!step) return null;
  const side = step.team === (firstPick ? 'A' : 'B') ? 'our' : 'enemy';
  return {index, side, action: step.action.toLowerCase(), mode: side + step.action};
}
export function parseAccountIds(text) {
  const ids = new Set();
  for (const token of String(text).split(/[\s,;]+/)) {
    const match = token.match(/^(?:https?:\/\/(?:www\.)?(?:opendota\.com\/players|dotabuff\.com\/players|steamcommunity\.com\/profiles)\/)?(\d{1,17})\/?$/i);
    if (!match) continue;
    let id = BigInt(match[1]);
    if (id > 76561197960265728n) id -= 76561197960265728n;
    if (id > 0n && id < 4294967295n) ids.add(Number(id));
  }
  return [...ids];
}
const array = value => Array.isArray(value) ? value : [];
const ids = value => array(value).map(Number);
export function normalizeProfile(raw = {}, selfReport = raw.selfReport || {}) {
  const profile = raw.profile?.profile || raw.profile || {};
  return {...raw, id: String(raw.id ?? raw.account_id ?? profile.account_id ?? ''),
    name: raw.name || profile.personaname || String(raw.id || 'Unknown player'),
    heroes: array(raw.heroes), recent: array(raw.recent), matches: array(raw.matches),
    selfReport: {...selfReport, signatureHeroes: ids(selfReport.signatureHeroes), desiredHeroes: ids(selfReport.desiredHeroes),
      avoidHeroes: ids(selfReport.avoidHeroes), preferredRoles: ids(selfReport.preferredRoles), roleComfort: selfReport.roleComfort || {}}};
}
// Position 1-5 inferred from a match's lane and the hero's roles; 0 when unknown.
function lanePosition(m, byId) {
  const roles = array(byId.get(+m.hero_id)?.roles);
  const lane = Number(m.lane_role);
  return m.is_roaming || lane === 4 ? 4 : lane === 2 ? 2 :
    lane === 1 ? (roles.includes('Carry') ? 1 : 5) :
    lane === 3 ? (roles.includes('Support') && !roles.includes('Carry') ? 4 : 3) : 0;
}
/** What an enemy's public OpenDota history says: top heroes, recent form, Battle Cup heroes, positions. */
export function enemySummary(player = {}, {now = Date.now() / 1000, heroes = []} = {}) {
  const byId = new Map(array(heroes).map(h => [+h.id, h]));
  const heroRows = array(player.heroes), recentRows = array(player.recent), matchRows = array(player.matches);
  const sources = player.sources || {}, statuses = Object.values(sources).map(s => s?.status);
  const hasData = heroRows.some(h => +h.games > 0) || recentRows.length > 0 || matchRows.length > 0;
  // A closed account still returns its profile and a hero list of zero-game rows; a failed
  // request must not look like one.
  const state = statuses.includes('fetching') || !statuses.length && !hasData ? 'loading'
    : sources.profile?.status === 'private' ? 'closed'
    : hasData ? 'ready'
    // Rate-limited or about to be retried: not a final failure.
    : Object.values(sources).some(s => s?.status === 'waiting' || s?.status === 'error' && (s.rateLimited || s.retrying)) ? 'waiting'
    : statuses.includes('error') ? 'error' : 'closed';
  const topHeroes = heroRows.filter(h => +h.games > 0)
    .map(h => ({heroId: +h.hero_id, games: +h.games, wins: h.win == null ? null : Math.max(0, +h.win || 0)}))
    .sort((a, b) => b.games - a.games || (b.wins ?? 0) - (a.wins ?? 0)).slice(0, 5)
    .map(h => ({...h, winRate: h.wins == null ? null : Math.round(100 * h.wins / h.games)}));
  const won = m => Boolean(m.radiant_win) === (+m.player_slot < 128);
  const recent = {wins: 0, losses: 0};
  for (const m of recentRows) if (m.radiant_win != null) won(m) ? recent.wins++ : recent.losses++;
  // Recent rows always carry hero_id, so they win the dedupe over older cached match rows.
  const seen = new Set(), cup = new Map(), counts = [0, 0, 0, 0, 0, 0];
  for (const m of [...recentRows, ...matchRows]) {
    const age = (now - Number(m.start_time)) / 86400, key = String(m.match_id);
    if (m.match_id == null || !(age >= 0 && age <= 180) || seen.has(key)) continue;
    seen.add(key);
    const position = lanePosition(m, byId);
    if (position) counts[position]++;
    if (+m.lobby_type === 9 && m.hero_id != null) {
      const row = cup.get(+m.hero_id) || {heroId: +m.hero_id, games: 0, wins: 0};
      row.games++; if (m.radiant_win != null && won(m)) row.wins++;
      cup.set(row.heroId, row);
    }
  }
  return {state, topHeroes, recent,
    cup: [...cup.values()].sort((a, b) => b.games - a.games || b.wins - a.wins),
    positions: [1, 2, 3, 4, 5].map(position => ({position, games: counts[position]})).filter(r => r.games > 0)
      .sort((a, b) => b.games - a.games || a.position - b.position)};
}
/** Heroes one enemy account played against this team, from the team's own records. */
export function enemySightings(rows = [], accountId) {
  const id = String(accountId), byHero = new Map();
  for (const r of array(rows)) {
    if (String(r.accountId) !== id) continue;
    const h = byHero.get(+r.heroId) || {heroId: +r.heroId, games: 0, wins: 0};
    h.games++; if (r.enemyWon === true) h.wins++;
    byHero.set(h.heroId, h);
  }
  return [...byHero.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || a.heroId - b.heroId);
}
const overlaps = (ids, wanted) => array(ids).some(id => wanted.includes(String(id)));
/** Earlier Battle Cup matches pasted for scouting, worth showing for the current enemies. */
export function relevantEnemyMatches(rows = [], enemyIds = [], now = Date.now()) {
  const wanted = array(enemyIds).map(String);
  return array(rows).filter(r => overlaps(r.contextIds, wanted)
    || overlaps(array(r.summary?.players).map(p => p.accountId).filter(Boolean), wanted)
    // Recent rows count only if they were not saved for a different opponent.
    || !array(r.contextIds).length && now - Number(r.addedAt) <= 86400000);
}
/** Team-level picks and bans of the enemy across pasted matches; closed players stay anonymous. */
export function enemyMatchReport(rows = [], enemyIds = []) {
  const wanted = array(enemyIds).map(String), picks = new Map(), bans = new Map();
  const report = {matches: [], unresolved: [], picks: [], bans: [], players: [], anonymous: 0};
  for (const row of array(rows)) {
    const players = array(row.summary?.players);
    const onSide = radiant => players.some(p => p.isRadiant === radiant && p.accountId && wanted.includes(p.accountId));
    const side = row.enemySide === 'radiant' || row.enemySide === 'dire' ? row.enemySide
      : onSide(true) !== onSide(false) ? (onSide(true) ? 'radiant' : 'dire') : null;
    const radiantWin = row.summary?.radiantWin;
    report.matches.push({matchId: row.matchId, side, won: side && typeof radiantWin === 'boolean' ? radiantWin === (side === 'radiant') : null});
    if (!side) { report.unresolved.push(row.matchId); continue; }
    const won = typeof radiantWin === 'boolean' && radiantWin === (side === 'radiant');
    for (const p of players.filter(p => p.isRadiant === (side === 'radiant'))) {
      const h = picks.get(p.heroId) || {heroId: p.heroId, games: 0, wins: 0};
      h.games++; if (won) h.wins++; picks.set(p.heroId, h);
      if (p.accountId) report.players.push({accountId: p.accountId, name: p.name, heroId: p.heroId, matchId: row.matchId});
      else report.anonymous++;
    }
    for (const b of array(row.summary?.picksBans).filter(b => !b.isPick && b.team === (side === 'radiant' ? 0 : 1)))
      bans.set(b.heroId, {heroId: b.heroId, count: (bans.get(b.heroId)?.count || 0) + 1});
  }
  report.picks = [...picks.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || a.heroId - b.heroId);
  report.bans = [...bans.values()].sort((a, b) => b.count - a.count || a.heroId - b.heroId);
  return report;
}
function history(player, now, byId) {
  const result = new Map(), seen = new Set();
  const row = id => {
    if (!result.has(id)) result.set(id, {games:0, recent:0, cup:0, currentCup:0, roleCounts:[0,0,0,0,0,0]});
    return result.get(id);
  };
  for (const h of player.heroes) {
    if (+h.last_played > now) continue;
    row(+h.hero_id).games = Math.max(0, +h.games || 0);
  }
  for (const m of [...player.matches,...player.recent].sort((a,b) => Number(+b.lobby_type === 9) - Number(+a.lobby_type === 9))) {
    const age = (now - Number(m.start_time)) / 86400;
    const key = String(m.match_id ?? [m.start_time,m.hero_id].join('/'));
    if (!(age >= 0 && age <= 180) || seen.has(key)) continue;
    seen.add(key);
    const h = row(+m.hero_id);
    const position = lanePosition(m, byId);
    if (position) h.roleCounts[position]++;
    if (age <= 30) h.recent++;
    if (+m.lobby_type === 9) {
      h.cup++;
      if (age <= 16/24) h.currentCup++;
    }
  }
  return result;
}
const positions = [1,2,3,4,5];
const tags = [['Carry'],['Nuker','Escape'],['Initiator','Durable'],['Disabler','Support'],['Support']];
function roleFit(hero,pos) {
  const roles = array(hero?.roles);
  return tags[pos-1].some(tag => roles.includes(tag)) ? 4 : 0;
}
function bestSlot(player,hero,open,penalties = {}) {
  const s = player?.selfReport;
  const eligible = open.filter(pos => !s?.preferredRoles.length || s.preferredRoles.includes(pos));
  return eligible.map(position => {
    const comfort = Math.min(5, Math.max(0, Number(s?.roleComfort[position]) || 0));
    const penalty = penalties[position] || 0;
    return {position,penalty,score:roleFit(hero,position) + (s?.preferredRoles.includes(position) ? 10 : 0) + comfort*2 - penalty};
  }).sort((a,b) => b.score-a.score)[0];
}
// Score the best position assignment still possible for the remaining players.
// `memo` caches each (player index, open positions) subproblem of one top-level call.
function futureRoleFit(players, open, index = 0, memo = new Map()) {
  if (index >= players.length) return 0;
  const key = index + ':' + open.join(',');
  if (memo.has(key)) return memo.get(key);
  let best = -Infinity;
  for (const pos of open) {
    const fit = bestSlot(players[index], null, [pos])?.score;
    if (fit == null) continue;
    best = Math.max(best, fit + futureRoleFit(players,open.filter(p => p !== pos),index+1,memo));
  }
  memo.set(key, best);
  return best;
}
function reservationPenalties(player, roster, open) {
  const remaining = roster.filter(p => p !== player);
  const scores = open.map(pos => futureRoleFit(remaining,open.filter(p => p !== pos)));
  const max = Math.max(...scores);
  return Object.fromEntries(open.map((pos,i) => [pos,Number.isFinite(scores[i]) ? max-scores[i] : Infinity]));
}
function experience(h = {}) {
  return Math.min(12,3*Math.log2(1+(h.games || 0))) + Math.min(12,3*(h.recent || 0)) + Math.min(18,6*(h.cup || 0)) + Math.min(36,18*(h.currentCup || 0));
}
function experienceText(h) {
  return h ? [h.games && h.games+' historical games',h.recent && h.recent+' games in 30 days',h.cup && h.cup+' Battle Cup games in 180 days',h.currentCup && h.currentCup+' Battle Cup games in the last 16 hours'].filter(Boolean).join(', ') : '';
}
// Lookup of the first row whose key(row) === id and that is usable, as
// `rows.find` would return it. Built once per list; a list holding null or
// undefined rows keeps the linear find, so it fails exactly where the find would.
// With `only`, rows for other ids are left out: the lookup must then be asked for those ids only.
function firstRowIndex(rows, key, usable = () => true, only = null) {
  if (rows.some(r => r == null)) return id => rows.find(r => key(r) === id && usable(r));
  const index = new Map();
  for (const r of rows) {
    const id = key(r);
    // NaN never equals an id, so it must not match (a Map would match NaN to NaN).
    if (id === id && !index.has(id) && (!only || only.has(id)) && usable(r)) index.set(id, r);
  }
  return id => index.get(id);
}
// OpenDota matchup rows per base hero, indexed on first use. observed() asks a
// candidate's list only for opposing picks, and an opposing pick's list for any
// candidate, so a candidate's list keeps just the opposing picks' rows.
function matchupIndex(matchups, opposingIds) {
  const lists = new Map();
  return base => {
    if (!lists.has(base)) lists.set(base, firstRowIndex(array(matchups?.[base]), m => +m.hero_id, undefined, opposingIds.has(base) ? null : opposingIds));
    return lists.get(base);
  };
}
function observed(hero, enemy, rowsOf) {
  for (const [base,other,sign] of [[hero,enemy,1],[enemy,hero,-1]]) {
    const row = rowsOf(base)(other);
    if (!row || !(row.games_played > 0 && Number.isFinite(+row.wins) && row.wins != null && +row.wins >= 0 && +row.wins <= +row.games_played)) continue;
    return {score:sign * 20*(row.wins-row.games_played/2)/(Number(row.games_played)+50),games:+row.games_played};
  }
}
const round1 = x => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** Pool-wide totals for meta rates: Divine+ (brackets 7-8) picks and pro picks. */
export function metaTotals(pool = []) {
  let high = 0, pro = 0, heroes = 0;
  for (const h of array(pool)) {
    const picks = (+h?.['7_pick'] || 0) + (+h?.['8_pick'] || 0);
    high += picks; pro += +h?.pro_pick || 0; if (picks > 0) heroes++;
  }
  return {high, pro, heroes};
}
/** Current meta for one hero from OpenDota hero stats: Divine+ public games and pro games. */
export function heroMeta(hero = {}, totals = {}) {
  const highPicks = (+hero['7_pick'] || 0) + (+hero['8_pick'] || 0), highWins = (+hero['7_win'] || 0) + (+hero['8_win'] || 0);
  const proPicks = +hero.pro_pick || 0, proBans = +hero.pro_ban || 0;
  if (highPicks < 200 && proPicks + proBans < 5) return null;
  const winRate = highPicks >= 200 ? round1(100 * highWins / highPicks) : null;
  const pickRate = totals.high > 0 && highPicks >= 200 ? round1(100 * highPicks * 10 / totals.high) : null;
  const proWinRate = proPicks >= 5 ? round1(100 * (+hero.pro_win || 0) / proPicks) : null;
  // A gentle tie-breaker: the whole range (-1.5..3) stays below "wants to play" (5),
  // so a player's own heroes win when everything else is equal.
  const avgPick = totals.heroes > 0 ? 1000 / totals.heroes : null;
  const winPart = winRate == null ? 0 : clamp((winRate - 50) * 0.5, -1.5, 1.5);
  const pickPart = pickRate == null || !avgPick ? 0 : pickRate <= 0 ? -0.75 : clamp(0.75 * Math.log2(pickRate / avgPick), -0.75, 1);
  const proGames = (totals.pro || 0) / 10;
  // Few pro games say little: damp until about 300 games.
  const proPart = proGames > 0 ? Math.min(1, 2 * (proPicks + proBans) / proGames) * Math.min(1, proGames / 300) : 0;
  return {winRate, pickRate, proPicks, proBans, proWinRate, score: +clamp(winPart + pickPart + proPart, -1.5, 3).toFixed(2)};
}
function metaText(m) {
  const parts = [];
  if (m.winRate != null) parts.push(`${m.winRate}% win in Divine+ (${m.pickRate}% of games)`);
  if (m.proPicks || m.proBans) parts.push(`pro ${m.proPicks} picks / ${m.proBans} bans`);
  return parts.length ? 'Meta: ' + parts.join(', ') : '';
}
/** Top suggestions that always include the best few of each category, in score order. */
export function diverseTop(ranked = [], limit = 8, perTag = 2) {
  if (ranked.length <= limit) return [...ranked];
  const must = new Set();
  for (const tag of ['team', 'counter', 'meta']) ranked.filter(r => r.tags?.includes(tag)).slice(0, perTag).forEach(r => must.add(r));
  const chosen = new Set(ranked.slice(0, limit));
  for (const r of must) {
    if (chosen.has(r)) continue;
    const victim = [...chosen].reverse().find(x => !must.has(x));
    if (!victim) break;
    chosen.delete(victim); chosen.add(r);
  }
  return ranked.filter(r => chosen.has(r));
}
// The matchup lists of already-picked heroes, indexed once per recommend() call.
function stratzLists(stratz, picks, list) {
  return picks.map(a => ({pick: +a.heroId, find: firstRowIndex(array(stratz?.[+a.heroId]?.[list]), r => +r.h, r => +r.m >= 50)}));
}
// STRATZ rows for `heroId` from those lists.
function stratzRows(lists, heroId) {
  return lists.map(({pick, find}) => ({pick, row: find(heroId)})).filter(x => x.row);
}
// One STRATZ row from H's point of view: H's own list first, else the other
// hero's list (for matchups the advantage and win rate are flipped).
function stratzPair(stratz, heroId, otherId, list) {
  const usable = r => +r?.h === otherId && +r.m >= 50 && Number.isFinite(+r.w) && Number.isFinite(+r.s);
  const own = array(stratz?.[heroId]?.[list]).find(usable);
  if (own) return {other: otherId, m: +own.m, w: +own.w, s: +own.s};
  const back = array(stratz?.[otherId]?.[list]).find(r => +r?.h === heroId && +r.m >= 50 && Number.isFinite(+r.w) && Number.isFinite(+r.s));
  if (!back) return null;
  return list === 'vs' ? {other: otherId, m: +back.m, w: 1 - +back.w, s: -back.s} : {other: otherId, m: +back.m, w: +back.w, s: +back.s};
}
// End-of-draft review: which picked hero plays into a counter or a weak pair,
// and which ones are strong, from STRATZ Divine+ data.
export function reviewLineup({draft = [], stratz = {}, heroes = []} = {}) {
  // The app keeps heroes as an object keyed by id; tests may pass a list.
  const pool = Array.isArray(heroes) ? heroes : Object.values(heroes || {});
  const names = new Map(pool.map(h => [+h.id, h.localized_name]));
  const nameOf = id => names.get(+id) || String(id);
  const signed = s => (s >= 0 ? '+' : '') + s.toFixed(1);
  const side = mode => {
    const picks = draft.filter(a => a.mode === mode + 'Pick').map(a => +a.heroId);
    const opponents = draft.filter(a => a.mode === (mode === 'our' ? 'enemy' : 'our') + 'Pick').map(a => +a.heroId);
    let total = 0, pairs = 0;
    const list = picks.map(heroId => {
      const vs = opponents.map(e => stratzPair(stratz, heroId, e, 'vs')).filter(Boolean);
      const mates = picks.filter(t => t !== heroId).map(t => stratzPair(stratz, heroId, t, 'with')).filter(Boolean);
      for (const row of vs) { total += row.s; pairs++; }
      const notes = [];
      const byS = rows => [...rows].sort((a, b) => a.s - b.s);
      const hard = byS(vs)[0], strong = byS(vs).at(-1), weak = byS(mates)[0], good = byS(mates).at(-1);
      const wins = row => `wins ${Math.round(100 * row.w)}% (${row.m} games)`;
      if (hard && hard.s <= -2) notes.push({text: `Hard time vs ${nameOf(hard.other)}: ${wins(hard)}`, tone: 'warn'});
      if (strong && strong.s >= 2) notes.push({text: `Strong vs ${nameOf(strong.other)}: ${wins(strong)}`, tone: 'good'});
      if (weak && weak.s <= -2) notes.push({text: `Weak pair with ${nameOf(weak.other)}: ${signed(weak.s)}`, tone: 'warn'});
      if (good && good.s >= 2) notes.push({text: `Pairs well with ${nameOf(good.other)}: ${signed(good.s)}`, tone: 'good'});
      if (!notes.length) notes.push(vs.length || mates.length
        ? {text: 'No strong matchups or pairs (Divine+)', tone: 'info'}
        : {text: 'No STRATZ data for this hero', tone: 'info'});
      return {heroId, notes};
    });
    return {edge: pairs ? Math.round(total / pairs * 10) / 10 : null, pairs, heroes: list};
  };
  return {our: side('our'), enemy: side('enemy')};
}
export function recommend({heroes = [],draft = [],allies = [],opponents = [],matchups = {},stratz = {},firstPick = true,now = Date.now(),mode} = {}) {
  if (!nextTurn(draft,firstPick)) return [];
  mode ||= nextTurn(draft,firstPick).mode;
  const picking = mode.endsWith('Pick');
  const own = mode === 'ourPick' || mode === 'enemyBan';
  const input = own ? allies : opponents;
  const roster = input.map(p => normalizeProfile(p, own ? p.selfReport : {})).filter(p => !own || (p.selfReport.availability ?? p.availability) !== 'unavailable');
  const team = own ? 'ourPick' : 'enemyPick', opposing = own ? 'enemyPick' : 'ourPick';
  const pool = Object.values(heroes), byId = new Map(pool.map(h => [+h.id,h]));
  const taken = new Set(draft.map(a => +a.heroId));
  const time = +now > 1e11 ? +now/1000 : +now;
  const histories = new Map(roster.map(p => [p.id,history(p,time,byId)]));
  const otherLocks = new Set(draft.filter(a => a.mode === opposing && a.playerId != null).map(a => String(a.playerId)));
  const otherHistories = picking ? (own ? opponents : allies)
    .map(p => normalizeProfile(p,{})).filter(p => !otherLocks.has(p.id))
    .map(p => ({id:p.id,name:p.name,rows:history(p,time,byId)})) : [];
  const picked = draft.filter(a => a.mode === team);
  if (picked.length >= 5 || input.length > 5 || new Set(roster.map(p=>p.id)).size !== roster.length) return [];
  const guests = Array.from({length:5-input.length},(_,i)=>({id:Symbol('unknown'+i),unknown:true}));
  const seats = [...roster,...guests];
  const locks = picked.filter(a=>a.playerId != null).map(a=>String(a.playerId));
  const roleLocks = picked.filter(a=>a.position != null).map(a=>+a.position);
  if (new Set(locks).size !== locks.length || new Set(roleLocks).size !== roleLocks.length) return [];
  // Resolve previous picks jointly, including manual locks and the feasibility of still-open positions.
  let bestAssignment;
  // Remaining seats and open positions are bitmasks over `seats` and `positions`
  // (at most 5 each), visited in array order. The search revisits the same leaves
  // and (pick, seat, position) terms many times; all are pure, so each is computed once.
  const ofMask = (list, mask) => list.filter((_, i) => mask & 1 << i);
  const knownSeats = seats.reduce((mask, p, i) => p.unknown ? mask : mask | 1 << i, 0);
  const leafFits = new Map(), seatTerms = picked.map(() => new Map());
  function assign(index,remaining,open,score) {
    if (index === picked.length) {
      const key = (remaining & knownSeats) * 32 + open;
      if (!leafFits.has(key)) leafFits.set(key, futureRoleFit(ofMask(seats, remaining & knownSeats),ofMask(positions, open)));
      const future = leafFits.get(key);
      if (Number.isFinite(future) && (!bestAssignment || score+future > bestAssignment.score))
        bestAssignment = {remaining:ofMask(seats, remaining),open:ofMask(positions, open),score:score+future};
      return;
    }
    const action = picked[index], heroId = +action.heroId, hero = byId.get(heroId);
    for (let s = 0; s < seats.length; s++) {
      if (!(remaining & 1 << s)) continue;
      const seat = seats[s];
      if (action.playerId != null && String(action.playerId) !== seat.id) continue;
      if (action.playerId == null && locks.includes(seat.id)) continue;
      const player = seat.unknown ? null : seat;
      if (!seatTerms[index].has(seat)) seatTerms[index].set(seat, {slots: new Map(), personal: undefined});
      const terms = seatTerms[index].get(seat);
      for (let p = 0; p < positions.length; p++) {
        if (!(open & 1 << p)) continue;
        const pos = positions[p];
        if (action.position != null ? pos !== +action.position : roleLocks.includes(pos)) continue;
        if (!terms.slots.has(pos)) terms.slots.set(pos, bestSlot(player,hero,[pos]));
        const slot = terms.slots.get(pos);
        if (!slot) continue;
        const personal = terms.personal ??= (player?.selfReport.signatureHeroes.includes(heroId) ? 20 : 0) +
          experience(histories.get(player?.id)?.get(heroId));
        // On a tie, an unattributed pick goes to an unknown seat, so a known teammate
        // stays available for their own heroes.
        const keepKnownFree = player && !personal && action.playerId == null ? 0.01 : 0;
        assign(index+1,remaining & ~(1 << s),open & ~(1 << p),score+slot.score+personal-keepKnownFree);
      }
      // Unknown seats have interchangeable evidence and constraints.
      if (seat.unknown) break;
    }
  }
  assign(0,(1 << seats.length) - 1,(1 << positions.length) - 1,0);
  if (!bestAssignment) return [];
  const {open,remaining} = bestAssignment;
  const available = remaining.filter(p=>!p.unknown);
  const slots = [...available];
  if (picking && remaining.some(p=>p.unknown)) slots.push(null);
  // Bans can rest on matchup evidence alone, even with no known players.
  if (!picking && !slots.length) slots.push(null);
  const penalties = new Map(slots.map(p => [p, picking ? reservationPenalties(p,available,open) : {}]));
  const covered = new Set(picked.flatMap(a => array(byId.get(+a.heroId)?.roles)));
  const totals = metaTotals(pool);
  const ranked = [];
  // Hero-independent lookups, built once per call instead of once per hero.
  const opposingPicks = draft.filter(a => a.mode === opposing);
  const vsLists = stratzLists(stratz, opposingPicks, 'vs'), withLists = stratzLists(stratz, picked, 'with');
  const matchupRows = matchupIndex(matchups, new Set(opposingPicks.map(a => +a.heroId)));
  const nameOf = id => byId.get(id)?.localized_name || String(id);
  for (const hero of pool) {
    const heroId = +hero.id;
    if (taken.has(heroId)) continue;
    // Meta shapes picks, and gives every ban turn suggestions: heroes strong in Divine+ and pro games.
    const meta = heroMeta(hero, totals), metaReason = meta ? metaText(meta) : '';
    // Divine+ counters (vs the opposing picks) and synergy (with this side's picks).
    const vsRows = stratzRows(vsLists, heroId);
    const withRows = stratzRows(withLists, heroId);
    const edge = vsRows.length ? vsRows.reduce((sum, x) => sum - x.row.s, 0) / vsRows.length : 0;
    const syn = withRows.length ? withRows.reduce((sum, x) => sum + x.row.s, 0) / withRows.length : 0;
    const stratzCounter = +clamp(edge * 0.5, -5, 5).toFixed(2), synergy = +clamp(syn * 0.35, -3.5, 3.5).toFixed(2);
    const stratzReasons = [];
    const byEdge = [...vsRows].sort((a, b) => a.row.s - b.row.s);
    const winsVs = x => Math.round(100 * (1 - x.row.w));
    if (byEdge.length && -byEdge[0].row.s >= 2) stratzReasons.push(`Counters ${nameOf(byEdge[0].pick)}: wins ${winsVs(byEdge[0])}% (${byEdge[0].row.m} games, Divine+)`);
    const worst = byEdge.at(-1);
    if (worst && -worst.row.s <= -2) stratzReasons.push(`Weak vs ${nameOf(worst.pick)}: wins ${winsVs(worst)}% (${worst.row.m} games)`);
    const partner = [...withRows].sort((a, b) => b.row.s - a.row.s)[0];
    if (partner && partner.row.s >= 2) stratzReasons.push(`Pairs with ${nameOf(partner.pick)}: +${partner.row.s} (Divine+)`);
    // Terms that depend on the hero only, not on the player slot.
    const metaBan = !picking && (meta?.score ?? 0) >= 1;
    const missing = picking ? ['Initiator','Disabler','Support','Carry','Pusher'].filter(r=>array(hero.roles).includes(r)&&!covered.has(r)) : [];
    const denyTarget = picking ? otherHistories.map(p => ({p,h:p.rows.get(heroId)})).filter(x=>x.h)
      .sort((a,b)=>experience(b.h)-experience(a.h))[0] : undefined;
    const deny = denyTarget ? Math.min(5,experience(denyTarget.h)/8) : 0;
    const denyReason = deny ? 'Denies '+denyTarget.p.name+' a played hero ('+experienceText(denyTarget.h)+')' : '';
    // Observed OpenDota matchups, worked out by the first slot that gets that far.
    let heroMatchups;
    const matchupsOf = () => heroMatchups ??= (() => {
      // STRATZ Divine+ data replaces the small OpenDota pro sample where it exists.
      const stratzCovered = new Set(vsRows.map(x => x.pick));
      const matches = opposingPicks.filter(a=>!stratzCovered.has(+a.heroId)).map(a=>observed(heroId,+a.heroId,matchupRows)).filter(Boolean);
      if (!matches.length) return {count: 0, games: 0, score: 0};
      return {count: matches.length, games: matches.reduce((sum,m)=>sum+m.games,0), score: matches.reduce((sum,m)=>sum+m.score,0)/matches.length};
    })();
    let best, bestDetails;
    for (const player of slots) {
      const s = player?.selfReport, h = histories.get(player?.id)?.get(heroId);
      if (s?.avoidHeroes.includes(heroId)) continue;
      const components = {history:experience(h),signature:s?.signatureHeroes.includes(heroId)?20:0,
        desired:s?.desiredHeroes.includes(heroId) && !s.signatureHeroes.includes(heroId)?5:0,role:0,composition:0,matchup:0,deny:0,meta:meta?.score ?? 0,stratzCounter,synergy};
      const evidence = [], reasons = [], historyText = experienceText(h);
      if (historyText) evidence.push(historyText);
      if (components.signature) reasons.push('Reported signature hero');
      if (s?.desiredHeroes.includes(heroId)) reasons.push(components.desired ? 'Wants to play' : 'Also wants to play (signature already counted)');
      if (!picking && !components.history && !components.signature && !components.desired && stratzCounter + synergy < 2 && !metaBan) continue;
      reasons.push(...stratzReasons);
      if (metaBan) reasons.push(metaReason);
      const slot = bestSlot(player,hero,open,penalties.get(player));
      let likelyPosition = null;
      let roleSample = 0;
      if (!picking && h) {
        likelyPosition = [...open].sort((a,b)=>h.roleCounts[b]-h.roleCounts[a])[0];
        roleSample = h.roleCounts[likelyPosition] || 0;
        components.role = Math.min(4,roleSample);
        if (roleSample) evidence.push(roleSample+' lane observations suggest position '+likelyPosition+' (180 days)');
        else likelyPosition = null;
      }
      if (picking) {
        if (!slot || !Number.isFinite(slot.score)) continue;
        components.role = slot.score;
        components.composition = missing.length*2;
        if (missing.length) reasons.push('Adds '+missing.join(', '));
        if (denyTarget) {
          components.deny = deny;
          if (components.deny) reasons.push(denyReason);
        }
        if (slot.score > 0) reasons.push('Position '+slot.position+' fit');
        if (metaReason) meta.score >= 2 ? reasons.unshift(metaReason) : reasons.push(metaReason);
        if (!totals.high && !totals.pro) evidence.push('Meta data unavailable');
      }
      const {count: matchupCount, games: matchupGames, score: matchupScore} = matchupsOf();
      if (matchupCount) {
        components.matchup = matchupScore;
        evidence.push('Observed matchup data for '+matchupCount+' opposing picks ('+matchupGames+' games)');
      }
      if (!matchupGames && !vsRows.length && opposingPicks.length) evidence.push('Observed matchup data unavailable');
      if (picking && !array(hero.roles).length) evidence.push('Composition tags unavailable');
      const score = +Object.values(components).reduce((sum,x)=>sum+x,0).toFixed(2);
      // Category tags for our picks: the team's own heroes, counters to their picks, current meta.
      const tags = mode !== 'ourPick' ? [] : [
        (components.signature > 0 || components.desired > 0 || components.history > 0) && 'team',
        // Counter needs a clear edge on enough games: small pro samples are noisy.
        (components.matchup >= 1 && matchupGames >= 30 || components.stratzCounter >= 1.5) && 'counter', components.meta >= 1.5 && 'meta'].filter(Boolean);
      // A ban resting only on STRATZ matchups belongs to no particular enemy player.
      const anonymous = !picking && !components.history && !components.signature && !components.desired;
      const rec = {heroId,score,reasons,tags,playerId:anonymous ? null : player?.id ?? null,position:picking?slot.position:likelyPosition,playerName:anonymous ? null : player?.name ?? null,evidence,components,details:null};
      // A ban kept only by the meta must still come out positive (e.g. not when it is weak vs our picks).
      if (metaBan && !components.history && !components.signature && !components.desired && stratzCounter + synergy < 2 && score <= 0) continue;
      if (best && !(score>best.score)) continue;
      best = rec;
      // Only the hero's best slot is kept, so its detail rows are built once, after the slot loop.
      bestDetails = () => Object.entries(components).map(([category,contribution]) => ({
        category,contribution,heroId,playerId:rec.playerId,position:rec.position,
        source:({history:historyText,signature:'Teammate profile',desired:'Teammate profile',
          role:picking?'Declared role and OpenDota hero roles':'Inferred from observed lane',
          composition:'OpenDota hero roles',matchup:matchupGames?'OpenDota hero matchups':null,
          deny:reasons.find(r=>r.startsWith('Denies ')),meta:meta?'OpenDota hero stats (Divine+ and pro)':null,stratzCounter:stratzCounter?'STRATZ Divine+ matchups':null,synergy:synergy?'STRATZ Divine+ matchups':null})[category] || null,
        sample:category==='history' && h ? {games:h.games,recent30d:h.recent,cup180d:h.cup,cup16h:h.currentCup} :
          category==='matchup'?matchupGames:category==='role' && !picking?roleSample:null
      }));
    }
    if (best) { best.details = bestDetails(); ranked.push(best); }
  }
  return ranked.sort((a,b)=>b.score-a.score || a.heroId-b.heroId);
}
