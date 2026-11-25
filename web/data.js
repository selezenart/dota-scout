import snapshot from './heroes.json' with {type:'json'};
const BASE='https://api.opendota.com/api';
export const PRIORITY={constants:0,profile:1,recent:2,heroes:3,history:4,matchups:5};
export class PublicQueue {
 constructor({fetcher=(...args)=>globalThis.fetch(...args),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),storage=globalThis.localStorage,limit=45,windowMs=60000,timeout=12000}={}){Object.assign(this,{fetcher,now,sleep,storage,limit,windowMs,timeout});this.jobs=[];this.running=0;this.starts=[];this.inflight=new Map();this.cache=new Map();this.sourceInfo=new Map();this.waking=false;this.pause=null;this.localOnly=false;this.sharedPauseSeen=0;}
 getSourceInfo(path){return this.sourceInfo.get(path);}
 request(path,{priority=3,ttl=300000,transform,onWait}={}){
  if(!/^\/(?:constants\/heroes|heroStats|matches\/\d+|players\/\d+(?:\/(?:heroes|recentMatches|matches))?|heroes\/\d+\/matchups)(?:\?|$)/.test(path)||/[#]/.test(path))return Promise.reject(new Error('Unsupported public endpoint'));
  if(this.inflight.has(path))return this.inflight.get(path);
  let cached=this.cache.get(path);try{cached ||= JSON.parse(this.storage?.getItem('od-public-v1:'+path)||'null');}catch{}
  if(cached&&Number.isFinite(cached.at)&&this.now()>=cached.at&&this.now()-cached.at<Math.min(ttl,86400000)){
   this.sourceInfo.set(path,{at:cached.at,cached:true});
   return Promise.resolve(cached.value);
  }
  const promise=new Promise((resolve,reject)=>{this.jobs.push({path,priority,transform,onWait,resolve,reject});this.jobs.sort((a,b)=>a.priority-b.priority);});this.inflight.set(path,promise);this.pump();return promise;
 }
 async execute(job){
  try{let value;for(let attempt=0;attempt<3;attempt++){
   await this.reserve();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeout);let response;
   try{response=await this.fetcher(BASE+job.path,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});}finally{clearTimeout(timer);}
   // OpenDota's limit is per IP, shared by every open board: pause the whole queue
   // instead of firing more requests, and report the wait.
   if(response.status===429){
    job.onWait?.();
    const retry=response.headers.get('Retry-After');
    const asked=retry!==null&&retry!==''&&Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-this.now();
    // Capped: a far-off Retry-After must not freeze every request for long.
    const delay=Math.min(60000,Math.max(1000,Number.isFinite(asked)?asked:15000));
    // One shared pause: every waiting job resumes when it ends.
    this.pause=this.sleep(delay).then(()=>{});
    // Other same-origin tabs read this and wait too.
    const until=this.now()+delay;this.sharedPauseSeen=until;
    try{this.storage?.setItem('od-public-pause-v1',String(until));}catch{}
    if(attempt<2)continue;
    const error=new Error('OpenDota rate limit reached');error.rateLimited=true;throw error;
   }
   if(!response.ok)throw new Error('OpenDota HTTP '+response.status);value=await response.json();if(job.transform)value=job.transform(value);break;
  }
  const entry={at:this.now(),value};this.cache.set(job.path,entry);this.sourceInfo.set(job.path,{at:entry.at,cached:false});while(this.cache.size>80)this.cache.delete(this.cache.keys().next().value);
  try{this.storage?.setItem('od-public-v1:'+job.path,JSON.stringify(entry));const keys=Object.keys(this.storage||{}).filter(k=>k.startsWith('od-public-v1:'));while(keys.length>80)this.storage.removeItem(keys.shift());}catch{}
  job.resolve(value);
  }catch(error){job.reject(error);}finally{this.inflight.delete(job.path);this.running--;this.pump();}
 }
 // Same-origin tabs share the per-minute budget through storage.
 async reserve(){
  const key='od-public-starts-v1';
  while(true){
   if(this.pause){const pause=this.pause;await pause;if(this.pause===pause)this.pause=null;continue;}
   const now=this.now();
   let until=0;try{until=Number(this.storage?.getItem('od-public-pause-v1'))||0;}catch{}
   // Adopt the other tab's pause as this tab's shared pause, so every running job waits.
   if(until>now&&until!==this.sharedPauseSeen){this.sharedPauseSeen=until;this.pause=this.sleep(Math.min(until-now,60000)).then(()=>{});continue;}
   let list=this.starts,shared=false;
   // A storage that cannot be written (full, private mode) falls back to this tab's own budget.
   if(!this.localOnly)try{if(this.storage){const saved=JSON.parse(this.storage.getItem(key)||'[]');list=Array.isArray(saved)?saved:[];shared=true;}}catch{list=this.starts;shared=false;}
   list=list.filter(t=>Number.isFinite(t)&&now-t<this.windowMs);
   if(list.length<this.limit){
    list.push(now);this.starts=list;
    if(shared)try{this.storage.setItem(key,JSON.stringify(list));}catch{this.localOnly=true;}
    return;
   }
   await this.sleep(Math.max(1,this.windowMs-(now-Math.min(...list))));
  }
 }
 pump(){while(this.running<2&&this.jobs.length){this.running++;void this.execute(this.jobs.shift());}}
}
export const publicData=new PublicQueue();
export async function loadPlayer(id,onUpdate=()=>{},queue=publicData){
 const player={id:String(id),name:String(id),sources:{},heroes:[],recent:[],matches:[],cupMatches:[]};
 const sources=[['profile','',1],['recent','/recentMatches',2],['heroes','/heroes?date=180',3],['matches','/matches?date=180&significant=0&limit=100&project=lane_role&project=is_roaming&project=lobby_type&project=hero_id&project=start_time',4]];
 await Promise.all(sources.map(async([key,suffix,priority])=>{
  player.sources[key]={status:'fetching'};
  onUpdate(player);
  try{
   const path='/players/'+id+suffix;
   const value=await queue.request(path,{priority,onWait:()=>{player.sources[key]={status:'waiting'};onUpdate(player);}});
   const source=queue.getSourceInfo?.(path);
   player[key]=value;
   // start_time stays out of `matches`: scoring and summaries must see the same rows as before.
   if(key==='matches'&&Array.isArray(value)){player.matches=value.map(({start_time,...row})=>row);player.cupMatches=value.filter(row=>+row.lobby_type===9);}
   if(key==='profile')player.name=value.profile?.personaname||String(id);
   player.sources[key]={
    status:key==='profile'&&!value.profile?'private':Array.isArray(value)&&!value.length?'empty':'updated',
    at:source?.at??Date.now(),
    cached:source?.cached??false
   };
  }catch(error){
   player.sources[key]={status:'error',message:error.message,...(error.rateLimited?{rateLimited:true}:{})};
  }
  onUpdate(player);
 }));
 return player;
}
export async function loadHeroes(queue=publicData){try{return await queue.request('/constants/heroes',{priority:0,ttl:86400000});}catch{return snapshot;}}
// Battle Cup scouting by match ID. Only a compact summary is cached: full match
// responses are hundreds of KB. Closed players stay anonymous (accountId null).
export function parseMatchIds(text){
 const ids=[],invalid=[];
 for(const token of String(text||'').trim().split(/[\s,;]+/).filter(Boolean)){
  const m=token.match(/^(?:https?:\/\/(?:www\.)?(?:dotabuff\.com|opendota\.com|stratz\.com)\/matches\/)?([1-9]\d{0,10})(?:[/?#].*)?$/i);
  if(m)ids.includes(m[1])||ids.push(m[1]);else invalid.push(token);
 }
 if(invalid.length)throw new Error('Not a match ID or match link: '+invalid.join(', '));
 return ids;
}
export function summarizeMatch(raw={}){
 const players=(Array.isArray(raw.players)?raw.players:[]).map(p=>({
  accountId:p.account_id==null||+p.account_id===4294967295?null:String(p.account_id),
  heroId:+p.hero_id,isRadiant:typeof p.isRadiant==='boolean'?p.isRadiant:+p.player_slot<128,name:p.personaname||null,
 }));
 const picksBans=(Array.isArray(raw.picks_bans)?raw.picks_bans:[]).map(b=>({heroId:+b.hero_id,isPick:!!b.is_pick,team:+b.team===1?1:0,order:+b.order||0}));
 return {matchId:String(raw.match_id),startTime:+raw.start_time||0,lobbyType:raw.lobby_type==null?null:+raw.lobby_type,
  radiantWin:typeof raw.radiant_win==='boolean'?raw.radiant_win:null,players,picksBans};
}
export function loadMatch(id,queue=publicData){return queue.request('/matches/'+id,{priority:6,ttl:30*86400000,transform:summarizeMatch});}
// Divine+ counters and synergy for one hero from our STRATZ proxy, cached for 12 h.
export async function loadStratz(heroId,{fetcher=(...args)=>globalThis.fetch(...args),storage=globalThis.localStorage,now=Date.now}={}){
 const key='stratz-v1:'+heroId;
 try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved?.value&&Number.isFinite(saved.at)&&now()-saved.at<43200000)return saved.value;}catch{}
 const response=await fetcher('/api/stratz?hero='+encodeURIComponent(heroId),{credentials:'same-origin',headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error('STRATZ HTTP '+response.status);
 const value=await response.json();
 try{storage?.setItem(key,JSON.stringify({at:now(),value}));}catch{}
 return value;
}
