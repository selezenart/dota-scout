import {parseAccountIds} from './draft-engine.js';

export function liveLineup(payload) {
  if (!/^\d+$/.test(payload?.matchId || '') || !Array.isArray(payload.teams) || payload.teams.length !== 2) return null;
  const local = parseAccountIds(payload.accountId);
  const teams = payload.teams.map(team => ({
    side: Number(team?.side),
    ids: Array.isArray(team?.ids) ? team.ids.map(id => /^\d+$/.test(String(id)) ? parseAccountIds(id)[0] : undefined) : [],
  }));
  if (local.length !== 1 || ![2,3].every(side => teams.some(team => team.side === side))) return null;
  if (teams.some(team => team.ids.length !== 5 || team.ids.some(id => !id))) return null;
  if (new Set(teams.flatMap(team => team.ids)).size !== 10) return null;
  const ours = teams.find(team => team.ids.includes(local[0]));
  if (!ours) return null;
  return {ours: ours.ids.map(String), enemies: teams.find(team => team !== ours).ids.map(String)};
}
