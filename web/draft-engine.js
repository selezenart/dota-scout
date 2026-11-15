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
  const sources = player.sources || {};
  const state = Object.values(sources).some(s => s?.status === 'fetching') ? 'loading'
    // A closed account still returns its profile and a hero list of zero-game rows.
    : sources.profile?.status === 'private' || !heroRows.some(h => +h.games > 0) && !recentRows.length && !matchRows.length ? 'closed' : 'ready';
  const topHeroes = heroRows.filter(h => +h.games > 0)
    .map(h => ({heroId: +h.hero_id, games: +h.games, wins: Math.max(0, +h.win || 0)}))
    .sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 5)
    .map(h => ({...h, winRate: Math.round(100 * h.wins / h.games)}));
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
      row.games++; if (won(m)) row.wins++;
      cup.set(row.heroId, row);
    }
  }
  return {state, topHeroes, recent,
    cup: [...cup.values()].sort((a, b) => b.games - a.games || b.wins - a.wins),
    positions: [1, 2, 3, 4, 5].map(position => ({position, games: counts[position]})).filter(r => r.games > 0)
      .sort((a, b) => b.games - a.games || a.position - b.position)};
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
  const ranked = [];
  for (const hero of pool) {
    const heroId = +hero.id;
    if (taken.has(heroId)) continue;
    let best;
    for (const player of slots) {
      const s = player?.selfReport, h = histories.get(player?.id)?.get(heroId);
      if (s?.avoidHeroes.includes(heroId)) continue;
      const components = {history:experience(h),signature:s?.signatureHeroes.includes(heroId)?20:0,
        desired:s?.desiredHeroes.includes(heroId) && !s.signatureHeroes.includes(heroId)?5:0,role:0,composition:0,matchup:0,deny:0};
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
            deny:reasons.find(r=>r.startsWith('Denies '))})[category] || null,
          sample:category==='history' && h ? {games:h.games,recent30d:h.recent,cup180d:h.cup,cup16h:h.currentCup} :
            category==='matchup'?matchupGames:category==='role' && !picking?roleSample:null
        }))};
      if (!best || score>best.score) best = rec;
    }
    if (best) ranked.push(best);
  }
  return ranked.sort((a,b)=>b.score-a.score || a.heroId-b.heroId);
}
