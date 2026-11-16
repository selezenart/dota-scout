// Asks the Dota game coordinator for one lobby and remembers the answer.
// The coordinator's reply carries no request id, so only one request is in flight at a time
// and replies are matched by lobby id.
import {decodeFindResponse, encodeFindLobbies} from './protobuf.mjs';

const isFullLineup = game => game.players.length === 10 && game.players.every(player => /^[1-9]\d*$/.test(player.accountId));

export function createLobbyLookup({send, isReady, now = Date.now, timeoutMs = 8000, retryMs = 10000}) {
  let known = null; // {lobbyId, game} once the coordinator listed all ten players
  let inFlight = null; // {lobbyId, promise, resolve, timer}
  let lastAsked = {lobbyId: null, at: -Infinity};

  function finish(game) {
    if (!inFlight) return;
    const {resolve, timer} = inFlight;
    clearTimeout(timer);
    inFlight = null;
    resolve(game);
  }

  function handleResponse(payload) {
    if (!inFlight) return;
    let games;
    try {
      games = decodeFindResponse(payload).games;
    } catch {
      return finish(null);
    }
    const game = games.find(entry => entry.lobbyId === inFlight.lobbyId) || null;
    // A listing of other games is a late or unrelated reply; keep waiting for ours (or the timeout).
    if (!game && games.length > 0) return;
    if (game && isFullLineup(game)) known = {lobbyId: inFlight.lobbyId, game};
    finish(game);
  }

  // Resolves to the coordinator's game for this lobby, or null when it is not available yet.
  async function lookup(lobbyId) {
    if (!/^[1-9]\d{0,19}$/.test(String(lobbyId)) || BigInt(lobbyId) >= 2n ** 64n) return null;
    if (known?.lobbyId === lobbyId) return known.game;
    if (inFlight) return inFlight.lobbyId === lobbyId ? inFlight.promise : null;
    if (!isReady()) return null;
    if (lastAsked.lobbyId === lobbyId && now() - lastAsked.at < retryMs) return null;
    lastAsked = {lobbyId, at: now()};
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    inFlight = {lobbyId, promise, resolve, timer: setTimeout(() => finish(null), timeoutMs)};
    try {
      send(encodeFindLobbies([lobbyId]));
    } catch {
      finish(null);
    }
    return promise;
  }

  // Drop an unanswered request when the connection to the coordinator goes away.
  const reset = () => finish(null);

  return {lookup, handleResponse, reset};
}
