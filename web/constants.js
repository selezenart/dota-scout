// Shared domain constants for the browser code. Server code (api/, helper/) runs
// in its own runtime and keeps its own copies; each copy names the others.

// --- Time ---
export const DAY_SECONDS = 86400;
export const DAY_MS = DAY_SECONDS * 1000;
// Match history the board reads and scores: OpenDota `date=` filter, engine windows and texts.
export const HISTORY_WINDOW_DAYS = 180;
// "Recent" games in the engine's experience score.
export const RECENT_WINDOW_DAYS = 30;
// Battle Cup games this close count as the current cup (same evening).
export const CURRENT_CUP_HOURS = 16;

// --- Dota ---
// OpenDota lobby_type of Battle Cup matches.
export const BATTLE_CUP_LOBBY = 9;
// Players per team, positions 1-5.
export const ROSTER_SIZE = 5;
export const ROLE_NAMES = Object.freeze(['Carry', 'Mid', 'Offlane', 'Soft support', 'Hard support']);
// Hero portrait art; static markup in index.html (welcome hero images) uses the same base.
export const HERO_PORTRAIT_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/';
// SteamID64 = account id + this base. api/steam.js and helper/lib.mjs keep their own copies.
export const STEAM_ID64_BASE = 76561197960265728n;

// --- Board limits ---
// Profile display name; api/steam.js trims Steam persona names to the same length.
export const DISPLAY_NAME_MAX = 80;
export const TEAM_NAME_MAX = 80;
// Heroes per profile hero list (signature, desired, avoid, Today).
export const HERO_LIST_MAX = 12;
// Recommendations shown as the top suggestions and marked on the hero grid.
export const TOP_RECOMMENDATIONS = 8;

// --- Local services and storage ---
// Optional local live/replay helper (helper/server.mjs PORT).
export const LOCAL_HELPER_ORIGIN = 'http://localhost:8765';
// sessionStorage: which OAuth provider a sign-in redirect started from. The inline
// head script in index.html reads the same key as a literal before any module loads.
export const OAUTH_PROVIDER_KEY = 'captain-oauth-provider';
// sessionStorage: state and nonce of a direct Google sign-in (written by backend.js, read by app.js).
export const GOOGLE_ATTEMPT_KEY = 'captain-google-oauth';

// --- Battle Cup schedule ---
// Must match scout_next_battle_cup() in supabase/migrations/003_battle_cup_signups.sql
// (Saturday 20:00 Europe/Kyiv). index.html's welcome link repeats BATTLE_CUP_LABEL as static text.
export const BATTLE_CUP_TIME_ZONE = 'Europe/Kyiv';
// Date#getUTCDay() numbering: 6 = Saturday.
export const BATTLE_CUP_WEEKDAY = 6;
export const BATTLE_CUP_HOUR = 20;
export const BATTLE_CUP_DAY_NAME = 'Saturday';
// "20:00 Kyiv"
export const BATTLE_CUP_TIME_LABEL = String(BATTLE_CUP_HOUR).padStart(2, '0') + ':00 ' + BATTLE_CUP_TIME_ZONE.split('/').pop();
// "Saturday 20:00 Kyiv"
export const BATTLE_CUP_LABEL = BATTLE_CUP_DAY_NAME + ' ' + BATTLE_CUP_TIME_LABEL;
