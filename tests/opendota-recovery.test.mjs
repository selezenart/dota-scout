import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';
import * as engine from '../web/draft-engine.js';
import {PublicQueue,loadPlayer} from '../web/data.js';

const tick=async(n=30)=>{for(let i=0;i<n;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
const reply=(status,retry=null,body=[])=>({status,ok:status>=200&&status<300,headers:{get:name=>name==='Retry-After'?retry:null},json:async()=>body});
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>void m.set(k,String(v)),removeItem:k=>void m.delete(k)};};
const parked=()=>{const waiting=[],calls=[];return {calls,waiting,sleep:ms=>{calls.push(ms);return new Promise(r=>waiting.push(r));}};};
const instant=()=>{const calls=[];return {calls,sleep:async ms=>{calls.push(ms);}};};

// A. PublicQueue
test('429 calls onWait once per 429 and pauses the whole queue for 15 s without Retry-After',async()=>{
 const fetched=[],sleeper=parked();let first=true,waits=0;
 const fetcher=async url=>{fetched.push(url);if(first){first=false;return reply(429);}return reply(200);};
 const q=new PublicQueue({fetcher,now:()=>1000,sleep:sleeper.sleep,storage:memory()});
 const a=q.request('/players/1/heroes',{onWait:()=>waits++});await tick();
 assert.equal(waits,1);assert.deepEqual(sleeper.calls,[15000]);
 const b=q.request('/players/2/heroes');await tick();
 assert.equal(fetched.length,1,'second job must not fetch while the queue is paused');
 sleeper.waiting.shift()();await tick();
 assert.equal(fetched.length,3);assert.deepEqual(await Promise.all([a,b]),[[],[]]);
});
test('numeric Retry-After sets the pause, with a one second minimum',async()=>{
 for(const [header,expected] of [['7',7000],['0',1000]]){
  const sleeper=instant();let first=true;
  const q=new PublicQueue({fetcher:async()=>first?(first=false,reply(429,header)):reply(200),now:()=>1000,sleep:sleeper.sleep,storage:memory()});
  await q.request('/players/1/heroes');
  assert.equal(sleeper.calls[0],expected);
 }
});
test('exhausted 429 retries reject with rateLimited, other HTTP errors do not',async()=>{
 const limited=new PublicQueue({fetcher:async()=>reply(429),now:()=>1000,sleep:instant().sleep,storage:memory()});
 await assert.rejects(limited.request('/players/1/heroes'),e=>e instanceof Error&&e.rateLimited===true);
 const broken=new PublicQueue({fetcher:async()=>reply(500),now:()=>1000,sleep:instant().sleep,storage:memory()});
 await assert.rejects(broken.request('/players/2/heroes'),e=>e instanceof Error&&!e.rateLimited&&/500/.test(e.message));
});
test('queues in the same origin share the per-minute budget through storage',async()=>{
 const storage=memory(),sleeper=parked();let clock=1000,fetches=0;
 const make=()=>new PublicQueue({fetcher:async()=>{fetches++;return reply(200);},now:()=>clock,sleep:sleeper.sleep,storage:memory(),limit:3,windowMs:60000});
 const [a,b]=[make(),make()];a.storage=b.storage=storage;
 const jobs=[a.request('/players/1/heroes'),a.request('/players/2/heroes'),b.request('/players/3/heroes'),b.request('/players/4/heroes')];
 await tick();
 assert.equal(fetches,3);
 assert.equal(JSON.parse(storage.getItem('od-public-starts-v1')).length,3);
 clock+=60001;sleeper.waiting.splice(0).forEach(r=>r());await tick();
 assert.equal(fetches,4);await Promise.all(jobs);
});
test('loadPlayer marks a source waiting when the queue waits and records rate-limited failures',async()=>{
 const seen=[];
 const queue={getSourceInfo:()=>null,request:async(path,{onWait}={})=>{
  if(path.endsWith('/recentMatches')){onWait?.();await tick(3);throw Object.assign(new Error('OpenDota HTTP 429'),{rateLimited:true});}
  return path.includes('/heroes')||path.includes('/matches')?[]:{profile:{personaname:'P'}};}};
 const p=await loadPlayer('5',pl=>seen.push(pl.sources.recent?.status),queue);
 assert.ok(seen.includes('waiting'));
 assert.deepEqual(p.sources.recent,{status:'error',rateLimited:true,message:'OpenDota HTTP 429'});
 assert.equal(p.sources.profile.status,'updated');
});

// B. enemySummary
test('enemySummary reports waiting for waiting or rate-limited sources without data',()=>{
 const ok={status:'updated'},sources=over=>({profile:ok,recent:ok,heroes:ok,matches:ok,...over});
 const state=(s,extra={})=>engine.enemySummary(engine.normalizeProfile({id:'1',name:'F',heroes:[],recent:[],matches:[],sources:s,...extra}),{now:1,heroes:[]}).state;
 assert.equal(state(sources({recent:{status:'waiting'}})),'waiting');
 assert.equal(state(sources({heroes:{status:'error',rateLimited:true,message:'x'}})),'waiting');
 assert.equal(state(sources({heroes:{status:'error',message:'x'}})),'error');
 assert.equal(state(sources({recent:{status:'fetching'}})),'loading');
 assert.equal(state(sources({recent:{status:'waiting'}}),{heroes:[{hero_id:1,games:3,win:1}]}),'ready');
});

// C and D. UI
const built=await build({logLevel:'silent',plugins:[{name:'flow-boundaries',enforce:'pre',load(id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(path.endsWith('/web/data.js'))return `export const publicData={request:async()=>[]};export const loadHeroes=async()=>({});export const loadPlayer=(id,progress)=>globalThis.__load(id,progress);`;
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const markup=await readFile('web/index.html','utf8');
const boot=async(load,{timers=false}={})=>{
 const w=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}).window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 if(timers)w.setTimeout=(fn,ms,...args)=>setTimeout(fn,0,...args);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.__load=load;w.eval(code);await tick(5);
 w.document.getElementById('setup-button').click();await tick(5);
 w.document.getElementById('enemy-account-input').value='333';
 [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();
 for(let i=0;i<10;i++)await tick(5);
 return w;
};
const failing=status=>({id:'333',name:'Foe',sources:{profile:{status:'updated'},recent:status,heroes:status,matches:status},heroes:[],recent:[],matches:[]});

test('waiting source shows Waiting for OpenDota… instead of Stats unavailable',async()=>{
 const w=await boot(async(id,progress)=>{const p=failing({status:'waiting'});progress(p);return p;}),doc=w.document;
 try{
  assert.equal(doc.querySelector('#team-roster p.enemy-status').textContent,'Waiting for OpenDota…');
  assert.equal(doc.querySelector('.draft-enemy-meta').textContent,'Waiting for OpenDota…');
  assert.doesNotMatch(doc.body.textContent,/Stats unavailable/);
  for(const s of doc.querySelectorAll('.seat-state'))assert.equal(s.textContent,'Waiting for OpenDota…');
 }finally{w.close();}
});
test('a failed scouting load is retried and recovers',async()=>{
 const calls=[];
 const w=await boot(async(id,progress)=>{calls.push(id);const p=calls.length===1?failing({status:'error',message:'x'}):{...failing({status:'updated'}),heroes:[{hero_id:1,games:5,win:3}]};progress(p);return p;},{timers:true});
 try{assert.ok(calls.length>=2,'loadPlayer called again');assert.match(w.document.querySelector('.draft-enemy-meta').textContent,/Pos|%|games/i);}finally{w.close();}
});
test('retries stop after three attempts and the card shows Stats unavailable',async()=>{
 const calls=[];
 const w=await boot(async(id,progress)=>{calls.push(id);const p=failing({status:'error',message:'x'});progress(p);return p;},{timers:true});
 // Retries chain through timers: wait (bounded) for the fourth attempt before asserting.
 try{for(let i=0;i<60&&calls.length<4;i++)await tick(5);for(let i=0;i<5;i++)await tick(5);
  assert.equal(calls.length,4);assert.equal(w.document.querySelector('.draft-enemy-meta').textContent,'Stats unavailable');
  const seats=[...w.document.querySelectorAll('.seat-state')].map(n=>n.textContent);assert.ok(seats.length,'seat cards render');assert.ok(seats.includes('Stats unavailable'),'seat card ends at Stats unavailable');}finally{w.close();}
});

// Review follow-ups
test('a storage that cannot be written still enforces the per-tab budget',async()=>{
 const fetched=[],sleeper=parked(),m=memory();m.setItem=()=>{throw Error('QuotaExceededError');};
 const q=new PublicQueue({fetcher:async u=>{fetched.push(u);return reply(200);},now:()=>1000,sleep:sleeper.sleep,storage:m,limit:3,windowMs:60000});
 for(let i=1;i<=6;i++)void q.request('/players/'+i+'/heroes');
 for(let i=0;i<5;i++)await tick();
 assert.equal(fetched.length,3);
});
test('a huge Retry-After is capped at one minute',async()=>{
 const sleeper=instant();let first=true;
 const q=new PublicQueue({fetcher:async()=>first?(first=false,reply(429,'3600')):reply(200),now:()=>1000,sleep:sleeper.sleep,storage:memory()});
 await q.request('/players/1/heroes');
 assert.deepEqual(sleeper.calls,[60000]);
});
test('a 429 in one tab pauses the other same-origin tabs too',async()=>{
 const shared=memory(),fetchedB=[],sleepA=instant(),sleepB=parked();let first=true;
 const a=new PublicQueue({fetcher:async()=>first?(first=false,reply(429)):reply(200),now:()=>1000,sleep:sleepA.sleep,storage:shared});
 await a.request('/players/1/heroes');
 const b=new PublicQueue({fetcher:async u=>{fetchedB.push(u);return reply(200);},now:()=>2000,sleep:sleepB.sleep,storage:shared});
 void b.request('/players/2/heroes');await tick();
 assert.equal(fetchedB.length,0,'tab B waits out tab A\'s pause');
 assert.deepEqual(sleepB.calls,[14000]);
});
test('both running jobs wait out another tab\'s pause, capped at a minute',async()=>{
 const shared=memory();shared.setItem('od-public-pause-v1',String(1000+600000));
 const fetched=[],sleeper=parked();
 const q=new PublicQueue({fetcher:async u=>{fetched.push(u);return reply(200);},now:()=>1000,sleep:sleeper.sleep,storage:shared});
 void q.request('/players/1/heroes');void q.request('/players/2/heroes');await tick();
 assert.equal(fetched.length,0,'neither job fetches during the pause');
 assert.deepEqual(sleeper.calls,[60000]);
});
