// Scoring weights and thresholds of recommend() in draft-engine.js. A score is the
// sum of its components; tests/recommend-golden.test.mjs pins the results.
const freeze = groups => Object.freeze(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, Object.freeze(v)])));

export const WEIGHTS = freeze({
  // Fit of a player to a position.
  role: {
    tagFit: 4,             // hero has an OpenDota role tag typical of the position
    preferred: 10,         // position is one of the player's declared roles
    comfortMax: 5,         // declared comfort is clamped to 0..comfortMax
    perComfort: 2,         // points per comfort level
    compositionPerRole: 2, // per team role (Initiator, Disabler, ...) the hero adds
    observedLaneCap: 4,    // bans: cap on lane observations backing a likely position
  },
  // The player's own profile.
  profile: {
    signature: 20,         // reported signature hero (pick assignment and component)
    desired: 5,            // wants to play (not counted again for a signature hero)
  },
  // Played-hero history: per-unit points, each capped.
  experience: {
    perLog2Games: 3, gamesCap: 12,        // all-time games, 3*log2(1+games)
    perRecent: 3, recentCap: 12,          // games in RECENT_WINDOW_DAYS
    perCup: 6, cupCap: 18,                // Battle Cup games in HISTORY_WINDOW_DAYS
    perCurrentCup: 18, currentCupCap: 36, // Battle Cup games in CURRENT_CUP_HOURS
  },
  // Picking a hero an opposing player has played.
  deny: {
    divisor: 8,            // their experience / divisor
    cap: 5,
  },
  // Observed OpenDota matchups: scale*(wins-games/2)/(games+priorGames), within -scale/2..+scale/2.
  matchups: {
    scale: 20,
    priorGames: 50,        // shrinks small samples toward zero
  },
  // STRATZ Divine+ counters (vs) and synergy (with).
  stratz: {
    minGames: 50,              // rows with fewer games are ignored
    counterMultiplier: 0.5, counterCap: 5,
    synergyMultiplier: 0.35, synergyCap: 3.5,
    noteThreshold: 2,          // |advantage| that earns a reason or review note
    banMinimum: 2,             // counter + synergy that alone keeps a ban suggestion
  },
  // OpenDota hero stats (Divine+ public and pro games).
  meta: {
    minHighPicks: 200,     // Divine+ picks for a win and pick rate
    minProGames: 5,        // pro picks (+ bans) for a pro signal
    proDampGames: 300,     // pro presence is damped until about this many pro games
    banMinimum: 1,         // meta score that alone keeps a ban suggestion
    leadReason: 2,         // meta score that puts the meta reason first
  },
  // Category tags on our pick suggestions.
  tags: {
    counterMatchup: 1, counterMatchupGames: 30, // observed matchup edge on enough games
    counterStratz: 1.5,                         // or a STRATZ counter score
    meta: 1.5,
  },
});
