// Background loads: enemy profiles (OpenDota), hero matchups and STRATZ counters.
import {publicData,loadPlayer} from './data.js';
// Namespace import keeps optional scouting helpers off the strict named-import list.
import * as matchData from './data.js';
import {DAY_MS} from './constants.js';
import {demo} from './url-state.js';
import {store} from './store.js';
import {$,el,notice} from './dom.js';
import {scheduleRender} from './ui.js';
import {accountOf,stratz,stratzRequested,touch,observations,requestedMatchups,matchupErrors,allyCounterRequests,allyCounterFailures} from './draft-data.js';

// Timings (ms) and local storage caps of the board.
const SCOUT_RETRY_RATE_LIMITED_MS=20000;
const SCOUT_RETRY_MS=8000; // re-fetch a failed enemy profile
const STRATZ_RETRY_BASE_MS=60000;
const STRATZ_RETRY_MAX_MS=900000; // doubles per failure, capped

// Failed loads (often OpenDota's per-IP rate limit, shared by every open board) are
// retried a few times per draft; meanwhile the card says it is waiting.
const scoutRetries=new Map();
function scout(ids){
 const gen=store.generation;
 for(const id of ids.filter(Boolean)){
  const key=String(id);
  if(observations.has(key))continue;
  observations.set(key,{id:key,sources:{profile:{status:'fetching'}}});
  void loadPlayer(id,p=>{if(gen!==store.generation)return;observations.set(key,{...p,sources:{...p.sources}});scheduleRender();}).then(p=>{
 if(gen!==store.generation)return;
 const failed=Object.values(p.sources||{}).filter(s=>s?.status==='error');if(!failed.length)return;
 const tries=scoutRetries.get(gen+':'+key)||0;if(tries>=3)return;
 scoutRetries.set(gen+':'+key,tries+1);
 const sources=Object.fromEntries(Object.entries(p.sources).map(([k,s])=>[k,s?.status==='error'?{...s,retrying:true}:s]));
 observations.set(key,{...p,sources});scheduleRender();
 // Re-scout through refreshScouting so a player removed meanwhile is not fetched again.
 setTimeout(()=>{
  if(gen!==store.generation||observations.get(key)?.sources!==sources)return;
  observations.delete(key);
  refreshScouting();
 },failed.some(s=>s.rateLimited)?SCOUT_RETRY_RATE_LIMITED_MS:SCOUT_RETRY_MS);
}).catch(e=>{if(gen===store.generation)notice(e.message);});
 }
}

// Credit for STRATZ counter and synergy data, shown once whenever it is in use.
export function stratzCredit(){
 const credit=el('a','Powered by STRATZ','stratz-credit');
 credit.href='https://stratz.com';
 credit.target='_blank';
 credit.rel='noopener noreferrer';
 return credit;
}
export function appendStratzCredit(){
 const root=$('suggestions');if(!root||root.querySelector('.stratz-credit')||!store.state.actions.some(a=>stratz[a.heroId]))return;
 root.append(stratzCredit());
}
const stratzFailures=new Map();
function requestStratz(id){
 if(demo||stratzRequested.has(String(id)))return;
 stratzRequested.add(String(id));
 void Promise.resolve().then(()=>matchData.loadStratz(id)).then(data=>{
  if(Array.isArray(data?.vs)&&Array.isArray(data?.with)){stratz[id]=data;touch();scheduleRender();}
 })
  // Back off 1, 2, 4… minutes (at most 15), then retry on its own while the hero is still picked.
  .catch(()=>{
   const n=(stratzFailures.get(String(id))||0)+1;
   stratzFailures.set(String(id),n);
   setTimeout(()=>{
    stratzRequested.delete(String(id));
    if(store.state.actions.some(a=>a.mode.endsWith('Pick')&&String(a.heroId)===String(id)))requestStratz(id);
   },Math.min(STRATZ_RETRY_MAX_MS,STRATZ_RETRY_BASE_MS*2**(n-1)));
  });
}
// One loader for both matchup caches. `matchups` feeds recommend() (a load bumps
// the ranking caches; a failure shows the draft-wide retry); `allyCounterMatchups`
// is optional seat data, kept apart so the ranking never reads it.
function loadMatchups(id,cache,requested,failed,{ranking}){
 if(demo||requested.has(id)||failed.has(id))return;
 requested.add(id);
 const gen=store.generation;
 void publicData.request('/heroes/'+id+'/matchups',{priority:5,ttl:DAY_MS}).then(rows=>{
  if(gen!==store.generation)return;
  if(!Array.isArray(rows))throw Error('Invalid matchup response');
  cache()[id]=rows;if(ranking)touch();
  scheduleRender();
 }).catch(()=>{
  if(gen!==store.generation)return;
  requested.delete(id);
  failed.add(id);
  if(ranking)scheduleRender();
 });
}
function requestMatchup(id){loadMatchups(id,()=>store.matchups,requestedMatchups,matchupErrors,{ranking:true});}
export function requestAllyCounters(id){loadMatchups(id,()=>store.allyCounterMatchups,allyCounterRequests,allyCounterFailures,{ranking:false});}
export function refreshScouting(){
 if(demo)return;
 const members=(Array.isArray(store.state.roster)?store.state.roster:[]).filter(p=>p&&typeof p==='object');
 scout([...(store.state.enemyIds||[]),...members.map(accountOf)]);
 for(const action of store.state.actions.filter(a=>a.mode.endsWith('Pick'))){requestMatchup(action.heroId);requestStratz(action.heroId);}
}
