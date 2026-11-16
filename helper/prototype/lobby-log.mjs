// Reads the lobby Dota connected to from console.log (Dota launched with -condebug).
// Observed line (Nov 2026, macOS client), written when the client joins the game server at the start of picks:
// 11/16 01:10:26 LOBBY STATE RUN: lobby 30108445531180688: Player AccountID 192188986 connecting to MatchID 9092239673 at ServerID [A:1:1240573965:52516] =[...]
const LOBBY_LINE = /^(\S+ \S+) LOBBY STATE RUN: lobby (\d{1,20}): Player AccountID (\d{1,10}) connecting to MatchID (\d{1,20})/gm;

export function lastLobbyFromLog(text) {
  if (typeof text !== 'string') return null;
  let found = null;
  for (const match of text.matchAll(LOBBY_LINE)) {
    found = {loggedAt: match[1], lobbyId: match[2], accountId: match[3], matchId: match[4], index: match.index};
  }
  if (!found) return null;
  // The client logs this when it leaves the game server. On joining it also closes its local
  // "to loopback:1" connection in the same second, which must not count as leaving.
  const ended = /Closing Steam Net Connection on socket 'client' to =\[/.test(text.slice(found.index));
  const {index, ...lobby} = found;
  return {...lobby, ended};
}
