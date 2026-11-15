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
function futureRoleFit(players, open, index = 0) {
  if (index >= players.length) return 0;
  let best = -Infinity;
  for (const pos of open) {
    const fit = bestSlot(players[index], null, [pos])?.score;
    if (fit == null) continue;
    best = Math.max(best, fit + futureRoleFit(players,open.filter(p => p !== pos),index+1));
  }
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
function observed(hero, enemy, matchups) {
  for (const [base,other,sign] of [[hero,enemy,1],[enemy,hero,-1]]) {
    const row = array(matchups?.[base]).find(m => +m.hero_id === other);
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
export function recommend({heroes = [],draft = [],allies = [],opponents = [],matchups = {},firstPick = true,now = Date.now(),mode} = {}) {
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
  function assign(index,remaining,open,score) {
    if (index === picked.length) {
      const future = futureRoleFit(remaining.filter(p=>!p.unknown),open);
      if (Number.isFinite(future) && (!bestAssignment || score+future > bestAssignment.score))
        bestAssignment = {remaining,open,score:score+future};
      return;
    }
    const action = picked[index], heroId = +action.heroId, hero = byId.get(heroId);
    for (const seat of remaining) {
      if (action.playerId != null && String(action.playerId) !== seat.id) continue;
      if (action.playerId == null && locks.includes(seat.id)) continue;
      const player = seat.unknown ? null : seat;
      for (const pos of open) {
        if (action.position != null ? pos !== +action.position : roleLocks.includes(pos)) continue;
        const slot = bestSlot(player,hero,[pos]);
        if (!slot) continue;
        const personal = (player?.selfReport.signatureHeroes.includes(heroId) ? 20 : 0) +
          experience(histories.get(player?.id)?.get(heroId));
        assign(index+1,remaining.filter(p=>p!==seat),open.filter(i=>i!==pos),score+slot.score+personal);
      }
      // Unknown seats have interchangeable evidence and constraints.
      if (seat.unknown) break;
    }
  }
  assign(0,seats,positions,0);
  if (!bestAssignment) return [];
  const {open,remaining} = bestAssignment;
  const available = remaining.filter(p=>!p.unknown);
  const slots = [...available];
  if (picking && remaining.some(p=>p.unknown)) slots.push(null);
  const penalties = new Map(slots.map(p => [p, picking ? reservationPenalties(p,available,open) : {}]));
  const covered = new Set(picked.flatMap(a => array(byId.get(+a.heroId)?.roles)));
  const totals = metaTotals(pool);
  const ranked = [];
  for (const hero of pool) {
    const heroId = +hero.id;
    if (taken.has(heroId)) continue;
    // Meta only shapes picks; ban suggestions stay evidence-based.
    const meta = picking ? heroMeta(hero, totals) : null, metaReason = meta ? metaText(meta) : '';
    let best;
    for (const player of slots) {
      const s = player?.selfReport, h = histories.get(player?.id)?.get(heroId);
      if (s?.avoidHeroes.includes(heroId)) continue;
      const components = {history:experience(h),signature:s?.signatureHeroes.includes(heroId)?20:0,
        desired:s?.desiredHeroes.includes(heroId) && !s.signatureHeroes.includes(heroId)?5:0,role:0,composition:0,matchup:0,deny:0,meta:meta?.score ?? 0};
      const evidence = [], reasons = [];
      if (experienceText(h)) evidence.push(experienceText(h));
      if (components.signature) reasons.push('Reported signature hero');
      if (s?.desiredHeroes.includes(heroId)) reasons.push(components.desired ? 'Wants to play' : 'Also wants to play (signature already counted)');
      if (!picking && !components.history && !components.signature && !components.desired) continue;
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
        const missing = ['Initiator','Disabler','Support','Carry','Pusher'].filter(r=>array(hero.roles).includes(r)&&!covered.has(r));
        components.composition = missing.length*2;
        if (missing.length) reasons.push('Adds '+missing.join(', '));
        const target = otherHistories.map(p => ({p,h:p.rows.get(heroId)})).filter(x=>x.h)
          .sort((a,b)=>experience(b.h)-experience(a.h))[0];
        if (target) {
          components.deny = Math.min(5,experience(target.h)/8);
          if (components.deny) reasons.push('Denies '+target.p.name+' a played hero ('+experienceText(target.h)+')');
        }
        if (slot.score > 0) reasons.push('Position '+slot.position+' fit');
        if (metaReason) meta.score >= 2 ? reasons.unshift(metaReason) : reasons.push(metaReason);
        if (!totals.high && !totals.pro) evidence.push('Meta data unavailable');
      }
      let matchupGames = 0;
      {
        const matches = draft.filter(a=>a.mode===opposing).map(a=>observed(heroId,+a.heroId,matchups)).filter(Boolean);
        if (matches.length) {
          matchupGames = matches.reduce((sum,m)=>sum+m.games,0);
          components.matchup = matches.reduce((sum,m)=>sum+m.score,0)/matches.length;
          evidence.push('Observed matchup data for '+matches.length+' opposing picks ('+matchupGames+' games)');
        }
      }
      if (!matchupGames && draft.some(a=>a.mode===opposing)) evidence.push('Observed matchup data unavailable');
      if (picking && !array(hero.roles).length) evidence.push('Composition tags unavailable');
      const score = +Object.values(components).reduce((sum,x)=>sum+x,0).toFixed(2);
      const rec = {heroId,score,reasons,playerId:player?.id ?? null,position:picking?slot.position:likelyPosition,playerName:player?.name ?? null,evidence,components,
        details:Object.entries(components).map(([category,contribution]) => ({
          category,contribution,heroId,playerId:player?.id ?? null,position:picking?slot.position:likelyPosition,
          source:({history:experienceText(h),signature:'Teammate profile',desired:'Teammate profile',
            role:picking?'Declared role and OpenDota hero roles':'Inferred from observed lane',
            composition:'OpenDota hero roles',matchup:matchupGames?'OpenDota hero matchups':null,
            deny:reasons.find(r=>r.startsWith('Denies ')),meta:meta?'OpenDota hero stats (Divine+ and pro)':null})[category] || null,
          sample:category==='history' && h ? {games:h.games,recent30d:h.recent,cup180d:h.cup,cup16h:h.currentCup} :
            category==='matchup'?matchupGames:category==='role' && !picking?roleSample:null
        }))};
      if (!best || score>best.score) best = rec;
    }
    if (best) ranked.push(best);
  }
  return ranked.sort((a,b)=>b.score-a.score || a.heroId-b.heroId);
}
