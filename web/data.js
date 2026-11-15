import snapshot from './heroes.json' with {type:'json'};
const BASE='https://api.opendota.com/api';
export const PRIORITY={constants:0,profile:1,recent:2,heroes:3,history:4,matchups:5};
export class PublicQueue {
 constructor({fetcher=(...args)=>globalThis.fetch(...args),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),storage=globalThis.localStorage,limit=45,windowMs=60000,timeout=12000}={}){Object.assign(this,{fetcher,now,sleep,storage,limit,windowMs,timeout});this.jobs=[];this.running=0;this.starts=[];this.inflight=new Map();this.cache=new Map();this.sourceInfo=new Map();this.waking=false;}
 getSourceInfo(path){return this.sourceInfo.get(path);}
 request(path,{priority=3,ttl=300000}={}){
  if(!/^\/(?:constants\/heroes|heroStats|players\/\d+(?:\/(?:heroes|recentMatches|matches))?|heroes\/\d+\/matchups)(?:\?|$)/.test(path)||/[#]/.test(path))return Promise.reject(new Error('Unsupported public endpoint'));
  if(this.inflight.has(path))return this.inflight.get(path);
  let cached=this.cache.get(path);try{cached ||= JSON.parse(this.storage?.getItem('od-public-v1:'+path)||'null');}catch{}
  if(cached&&Number.isFinite(cached.at)&&this.now()>=cached.at&&this.now()-cached.at<Math.min(ttl,86400000)){
   this.sourceInfo.set(path,{at:cached.at,cached:true});
   return Promise.resolve(cached.value);
  }
  const promise=new Promise((resolve,reject)=>{this.jobs.push({path,priority,resolve,reject});this.jobs.sort((a,b)=>a.priority-b.priority);});this.inflight.set(path,promise);this.pump();return promise;
 }
 async execute(job){
  try{let value;for(let attempt=0;attempt<3;attempt++){
   await this.reserve();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeout);let response;
   try{response=await this.fetcher(BASE+job.path,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});}finally{clearTimeout(timer);}
   if(response.status===429&&attempt<2){const retry=response.headers.get('Retry-After');const delay=Number.isFinite(Number(retry))&&retry!==null?Number(retry)*1000:Date.parse(retry)-this.now();await this.sleep(Math.max(1000,delay||2000*(attempt+1)));continue;}
   if(!response.ok)throw new Error('OpenDota HTTP '+response.status);value=await response.json();break;
  }
  const entry={at:this.now(),value};this.cache.set(job.path,entry);this.sourceInfo.set(job.path,{at:entry.at,cached:false});while(this.cache.size>80)this.cache.delete(this.cache.keys().next().value);
  try{this.storage?.setItem('od-public-v1:'+job.path,JSON.stringify(entry));const keys=Object.keys(this.storage||{}).filter(k=>k.startsWith('od-public-v1:'));while(keys.length>80)this.storage.removeItem(keys.shift());}catch{}
  job.resolve(value);
  }catch(error){job.reject(error);}finally{this.inflight.delete(job.path);this.running--;this.pump();}
 }
 async reserve(){while(true){const now=this.now();this.starts=this.starts.filter(t=>now-t<this.windowMs);if(this.starts.length<this.limit){this.starts.push(now);return;}await this.sleep(Math.max(1,this.windowMs-(now-this.starts[0])));}}
 pump(){while(this.running<2&&this.jobs.length){this.running++;void this.execute(this.jobs.shift());}}
}
export const publicData=new PublicQueue();
export async function loadPlayer(id,onUpdate=()=>{},queue=publicData){
 const player={id:String(id),name:String(id),sources:{},heroes:[],recent:[],matches:[]};
 const sources=[['profile','',1],['recent','/recentMatches',2],['heroes','/heroes?date=180',3],['matches','/matches?date=180&significant=0&limit=100&project=lane_role&project=is_roaming&project=lobby_type&project=hero_id',4]];
 await Promise.all(sources.map(async([key,suffix,priority])=>{
  player.sources[key]={status:'fetching'};
  onUpdate(player);
  try{
   const path='/players/'+id+suffix;
   const value=await queue.request(path,{priority});
   const source=queue.getSourceInfo?.(path);
   player[key]=value;
   if(key==='profile')player.name=value.profile?.personaname||String(id);
   player.sources[key]={
    status:key==='profile'&&!value.profile?'private':Array.isArray(value)&&!value.length?'empty':'updated',
    at:source?.at??Date.now(),
    cached:source?.cached??false
   };
  }catch(error){
   player.sources[key]={status:'error',message:error.message};
  }
  onUpdate(player);
 }));
 return player;
}
export async function loadHeroes(queue=publicData){try{return await queue.request('/constants/heroes',{priority:0,ttl:86400000});}catch{return snapshot;}}

