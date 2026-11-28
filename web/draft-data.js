// Draft data the views read: scouted players, matchups, cached rankings and hero helpers.
import snapshot from './heroes.json';
import {recommend,normalizeProfile,enemySummary} from './draft-engine.js';
import {initialState,demoState} from './demo.js';
import {HERO_PORTRAIT_BASE,ROLE_NAMES} from './constants.js';
import {demo,captainDemo,playerDemo} from './url-state.js';
import {store} from './store.js';
import {el} from './dom.js';
// A player's public account ID, under either field name a roster entry may use.
export const accountOf=p=>p.steamAccountId||p.accountId;
// A roster player's user ID, under either field name a roster entry may use.
export const memberId=p=>p.id||p.userId;
// Name an auth provider gave the account (email sign-up, Google, Steam), if any.
export const providerName=u=>u.user_metadata?.display_name||u.user_metadata?.full_name||u.user_metadata?.name;

// STRATZ Divine+ counters/synergy per picked hero; hero-level, so kept across drafts.
export let stratz={};
export let stratzRequested=new Set();
// Ranking inputs that change in place bump dataVersion; `state` and `heroes` are
// replaced or touched on change, so (state, heroes, dataVersion) keys every cache below.
let dataVersion=0;
export function touch(){dataVersion++;}
class VersionedMap extends Map{set(k,v){touch();return super.set(k,v);}delete(k){touch();return super.delete(k);}clear(){touch();super.clear();}}
export let observations=new VersionedMap();
export let requestedMatchups=new Set();
let suggestionCache={};
export const matchupErrors=new Set();
export const allyCounterRequests=new Set();
export const allyCounterFailures=new Set();
export function resetDraftData(){
 observations.clear();
 store.matchups={};
 requestedMatchups.clear();
 matchupErrors.clear();
 store.allyCounterMatchups={};
 allyCounterRequests.clear();
 allyCounterFailures.clear();
 touch();
 suggestionCache={};
 store.focusedPlayer=null;
}
export function matchupCoverage(){
 const ours=store.state.actions.filter(a=>a.mode==='ourPick'),enemies=store.state.actions.filter(a=>a.mode==='enemyPick');
 let observed=0;
 for(const ally of ours)for(const enemy of enemies){
  if((store.matchups[ally.heroId]||[]).some(row=>+row.hero_id===+enemy.heroId&&+row.games_played>0)||(store.matchups[enemy.heroId]||[]).some(row=>+row.hero_id===+ally.heroId&&+row.games_played>0))observed++;
 }
 return {observed,total:ours.length*enemies.length};
}

export const canWrite=()=>!playerDemo&&!store.pending&&store.healthy&&(store.shared?!!store.user&&store.shared.drafter_user_id===store.user.id:store.localControl);

export const roleNames=ROLE_NAMES;

export const heroName=id=>store.heroes[id]?.localized_name||'Unknown hero';

export function portrait(id){
 const h=store.heroes[id],img=el('img');
 img.alt=heroName(id);
 img.loading='lazy';
 img.src=HERO_PORTRAIT_BASE+String(h?.name||'').replace('npc_dota_hero_','')+'.png';
 return img;
}

// Derived draft data, rebuilt only when a ranking input changes.
export function derived(){
 const c=suggestionCache;
 if(c.state===store.state&&c.heroes===store.heroes&&c.version===dataVersion)return c;
 return suggestionCache={state:store.state,heroes:store.heroes,version:dataVersion,ranked:new Map(),summaries:new WeakMap()};
}
export function roster(){const c=derived();return [...(c.roster||=buildRoster())];}
export function opponents(){const c=derived();return [...(c.opponents||=buildOpponents())];}
function heroList(){const c=derived();return c.heroList||=Object.values(store.heroes);}
export function playerSummary(player,now){
 const c=derived(),hit=c.summaries.get(player);
 if(hit?.now===now)return hit.value;
 const value=enemySummary(player,{now,heroes:heroList()});
 c.summaries.set(player,{now,value});return value;
}
export function ranking(mode){
 const c=derived();
 if(!c.ranked.has(mode))c.ranked.set(mode,recommend({heroes:store.heroes,draft:store.state.actions,allies:roster(),opponents:opponents(),matchups:store.matchups,stratz,firstPick:store.state.firstPick,mode}));
 return c.ranked.get(mode);
}

function buildRoster(){
 return (Array.isArray(store.state.roster)?store.state.roster:[]).filter(p=>p&&typeof p==='object'&&!Array.isArray(p)).map(p=>normalizeProfile({...observations.get(String(accountOf(p)||'')),...p,name:p.displayName||p.name||observations.get(String(accountOf(p)||''))?.name,id:memberId(p),selfReport:p.selfReport||p}));
}

function buildOpponents(){
 return demo?(store.state.opponents||[]).map(p=>normalizeProfile(p)):(store.state.enemyIds||[]).map(id=>normalizeProfile(observations.get(String(id))||{id,name:String(id)}));
}
