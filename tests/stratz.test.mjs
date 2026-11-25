import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recommend} from '../web/draft-engine.js';

const api = await import('../api/stratz.js').catch(() => ({}));
const data = await import('../web/data.js');
const heroes = Array.from({length:10},(_,i)=>({id:i+1,localized_name:'Hero'+(i+1),roles:['Carry']}));
const row = (h,m,w,s) => ({h,m,w,s});
const act = (mode,heroId) => ({mode,heroId});
const rec = (o={}) => recommend({heroes,mode:'ourPick',...o});
const of = (list,id) => list.find(r=>r.heroId===id);
const upstream = {data:{heroStats:{heroVsHeroMatchup:{advantage:[{heroId:1,matchCountVs:9,matchCountWith:9,
  vs:[{heroId1:1,heroId2:94,matchCount:451,winCount:259,synergy:11.353,winRateHeroId1:0.57,winRateHeroId2:0.43,winsAverage:0.5743},{heroId1:1,heroId2:0,matchCount:30,synergy:1},{heroId1:1,heroId2:5,matchCount:0,synergy:1}],
  with:[{heroId1:1,heroId2:7,matchCount:80,winCount:44,synergy:-2.26,winsAverage:0.5}]}]}}}};
const fakeRes = () => ({statusCode:200,headers:{},body:undefined,status(c){this.statusCode=c;return this;},setHeader(k,v){this.headers[k]=v;},json(b){this.body=b;return this;}});
const call = async (query,{env={STRATZ_API_TOKEN:'sekret'},fetcher}={}) => {
  const res = fakeRes(), calls = [];
  const f = fetcher || (async(...a)=>{calls.push(a);return {ok:true,status:200,json:async()=>upstream};});
  await api.createHandler({fetcher:async(...a)=>{calls.push(a);return f(...a);},env})({query},res);
  return {res,calls};
};

test('compactMatchup compacts rows and drops invalid ones', () => {
  const c = api.compactMatchup(upstream,1);
  assert.deepEqual(c,{heroId:1,vs:[{h:94,m:451,w:0.574,s:11.4}],with:[{h:7,m:80,w:0.5,s:-2.3}]});
});
test('compactMatchup returns null for missing/invalid json', () => {
  for (const j of [null,undefined,{},{data:null},'x',{data:{heroStats:{}}}]) assert.equal(api.compactMatchup(j,1),null);
});
test('handler rejects bad hero ids with 400', async () => {
  for (const hero of [undefined,'abc','0','301','1.5','-2']) {
    const {res,calls} = await call({hero});
    assert.equal(res.statusCode,400); assert.ok(res.body.error); assert.equal(calls.length,0);
  }
});
test('handler returns 503 without token', async () => {
  const {res,calls} = await call({hero:'1'},{env:{}});
  assert.equal(res.statusCode,503); assert.equal(res.body.error,'STRATZ is not configured'); assert.equal(calls.length,0);
});
test('handler posts the expected GraphQL request and caches success', async () => {
  const {res,calls} = await call({hero:'1'});
  const [url,init] = calls[0];
  assert.equal(url,'https://api.stratz.com/graphql'); assert.equal(init.method,'POST');
  assert.equal(init.headers.Authorization,'Bearer sekret'); assert.equal(init.headers['User-Agent'],'STRATZ_API');
  assert.equal(init.headers['Content-Type'],'application/json');
  assert.ok(JSON.parse(init.body).query.includes('heroVsHeroMatchup(heroId: 1, bracketBasicIds: [DIVINE_IMMORTAL], take: 200)'));
  assert.equal(res.statusCode,200); assert.equal(res.body.heroId,1);
  assert.equal(res.headers['Cache-Control'],'public, s-maxage=21600, stale-while-revalidate=86400');
  assert.ok(!JSON.stringify(res.body).includes('sekret'));
});
test('handler maps STRATZ HTTP errors and GraphQL errors to 502 no-store without leaking token', async () => {
  for (const f of [async()=>({ok:false,status:403,json:async()=>({})}),async()=>({ok:true,status:200,json:async()=>({errors:[{message:'sekret boom'}]})})]) {
    const {res} = await call({hero:'1'},{fetcher:f});
    assert.equal(res.statusCode,502); assert.ok(res.body.error); assert.equal(res.headers['Cache-Control'],'no-store');
    assert.ok(!JSON.stringify(res.body).includes('sekret'));
  }
});
test('.vercelignore allows api/stratz.js', async () => {
  assert.ok((await readFile('.vercelignore','utf8')).split('\n').map(l=>l.trim()).includes('!api/stratz.js'));
});

test('loadStratz fetches, caches for 12h, refetches after, throws on non-OK', async () => {
  const store = new Map(), storage = {getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const urls = []; let t = 1e12;
  const fetcher = async u => {urls.push(u);return {ok:true,status:200,json:async()=>({heroId:3,vs:[],with:[]})};};
  const opts = {fetcher,storage,now:()=>t};
  assert.deepEqual(await data.loadStratz(3,opts),{heroId:3,vs:[],with:[]});
  assert.ok(String(urls[0]).endsWith('/api/stratz?hero=3'));
  assert.ok([...store.keys()].includes('stratz-v1:3'));
  t += 11*3600e3; await data.loadStratz(3,opts); assert.equal(urls.length,1);
  t += 2*3600e3; await data.loadStratz(3,opts); assert.equal(urls.length,2);
  await assert.rejects(data.loadStratz(4,{...opts,fetcher:async()=>({ok:false,status:502,json:async()=>({})})}));
});

const enemy = [act('enemyPick',2),act('enemyPick',3)];
const counterData = {2:{heroId:2,vs:[row(1,100,0.4,-4),row(4,100,0.5,0)],with:[]},3:{heroId:3,vs:[row(1,200,0.45,-2),row(4,100,0.5,6)],with:[]}};

test('stratzCounter averages negated synergy x0.5 over opposing picks and explains', () => {
  const r = of(rec({draft:enemy,stratz:counterData}),1);
  assert.equal(r.components.stratzCounter,1.5);
  assert.ok(r.reasons.includes('Counters Hero2: wins 60% (100 games, Divine+)'));
  assert.ok(r.tags.includes('counter'));
  assert.ok(r.details.some(d=>d.category==='stratzCounter'&&d.contribution===1.5&&d.source==='STRATZ Divine+ matchups'));
});
test('stratzCounter ignores rows under 50 games, clamps and is 0 without rows', () => {
  const small = {2:{heroId:2,vs:[row(1,49,0.1,-30)],with:[]}};
  assert.equal(of(rec({draft:enemy,stratz:small}),1).components.stratzCounter,0);
  const big = {2:{heroId:2,vs:[row(1,100,0.1,-30),row(5,100,0.9,30)],with:[]}};
  const out = rec({draft:enemy,stratz:big});
  assert.equal(of(out,1).components.stratzCounter,5); assert.equal(of(out,5).components.stratzCounter,-5);
  assert.equal(of(out,6).components.stratzCounter,0); assert.equal(of(rec({draft:enemy}),1).components.stratzCounter,0);
});
test('weak-vs reason when edge <= -2', () => {
  const r = of(rec({draft:enemy,stratz:counterData}),4);
  assert.equal(r.components.stratzCounter,-1.5);
  assert.ok(r.reasons.includes('Weak vs Hero3: wins 50% (100 games)'));
});
test('stratz counter rows replace OpenDota matchup component', () => {
  const matchups = {1:{2:{games:100,wins:80},3:{games:100,wins:80}}};
  const base = of(rec({draft:enemy,matchups}),1), withS = of(rec({draft:enemy,matchups,stratz:counterData}),1);
  assert.equal(withS.components.matchup,0);
  assert.ok(withS.components.stratzCounter!==0);
  assert.ok(base.components.stratzCounter===0);
});
test('synergy averages team partners x0.35, clamps, 0 without rows, with Pairs reason', () => {
  const team = [act('ourPick',2),act('ourPick',3)];
  const st = {2:{heroId:2,vs:[],with:[row(1,100,0.55,4),row(5,100,0.5,40)]},3:{heroId:3,vs:[],with:[row(1,100,0.55,2),row(5,10,0.5,40)]}};
  const out = rec({draft:team,stratz:st});
  assert.equal(of(out,1).components.synergy,1.05);
  assert.ok(of(out,1).reasons.includes('Pairs with Hero2: +4 (Divine+)'));
  assert.equal(of(out,5).components.synergy,3.5);
  assert.equal(of(out,6).components.synergy,0);
  assert.ok(of(out,1).details.some(d=>d.category==='synergy'&&d.source==='STRATZ Divine+ matchups'));
});
test('ban turn recommends evidence-free hero that stratz shows countering our picks', () => {
  const ours = [act('ourPick',2),act('ourPick',3)];
  assert.deepEqual(recommend({heroes,draft:ours,mode:'ourBan'}),[]);
  const st = {2:{heroId:2,vs:[row(7,100,0.3,-8)],with:[]},3:{heroId:3,vs:[row(7,100,0.35,-6)],with:[]}};
  const out = recommend({heroes,draft:ours,mode:'ourBan',stratz:st});
  assert.deepEqual(out.map(r=>r.heroId),[7]);
  assert.ok(out[0].reasons.some(r=>r.startsWith('Counters Hero')));
});
test('recommend is deterministic and leaves other heroes unaffected', () => {
  const a = rec({draft:enemy,stratz:counterData}), b = rec({draft:enemy,stratz:counterData}), plain = rec({draft:enemy});
  assert.deepEqual(a,b);
  assert.deepEqual(of(a,8),of(plain,8));
});

// ---- Review follow-ups ----
import {buildBoard} from './build-board.js';
import {JSDOM} from 'jsdom';
import * as engine2 from '../web/draft-engine.js';
import * as data2 from '../web/data.js';
import * as api2 from '../api/stratz.js';
const resOf=()=>({statusCode:0,headers:{},body:null,status(c){this.statusCode=c;return this;},setHeader(k,v){this.headers[k.toLowerCase()]=v;},json(b){this.body=b;return this;}});
const okFetch=async()=>({ok:true,status:200,json:async()=>({data:{heroStats:{heroVsHeroMatchup:{advantage:[{heroId:1,vs:[{heroId2:2,matchCount:100,winsAverage:0.5,synergy:1}],with:[]}]}}}})});

test('review: only canonical, real hero ids reach STRATZ',async()=>{
 let calls=0;const h=api2.createHandler({fetcher:async(...a)=>{calls++;return okFetch(...a);},env:{STRATZ_API_TOKEN:'t'}});
 for(const url of ['/api/stratz?hero=01','/api/stratz?hero=1&x=1','/api/stratz?hero=250','/api/stratz?hero=24']){const r=resOf();await h({url},r);assert.equal(r.statusCode,400,url);}
 const r=resOf();await h({url:'/api/stratz?hero=1'},r);assert.equal(r.statusCode,200);assert.equal(calls,1);
});
test('review: STRATZ rate limits and missing config are cached briefly with Retry-After',async()=>{
 const limited=api2.createHandler({fetcher:async()=>({ok:false,status:429,json:async()=>({})}),env:{STRATZ_API_TOKEN:'t'}});
 let r=resOf();await limited({url:'/api/stratz?hero=1'},r);assert.equal(r.statusCode,502);assert.match(r.headers['cache-control'],/s-maxage=\d+/);assert.ok(r.headers['retry-after']);
 const none=api2.createHandler({env:{}});r=resOf();await none({url:'/api/stratz?hero=1'},r);assert.equal(r.statusCode,503);assert.match(r.headers['cache-control'],/s-maxage=\d+/);
});
test('review: OpenDota matchup still counts for enemy picks without STRATZ rows',()=>{
 const draft=[act('enemyPick',2),act('enemyPick',3)];
 const matchups={1:[{hero_id:3,games_played:200,wins:140}]};
 const only2={2:{heroId:2,vs:[row(1,100,0.4,-4)],with:[]}};
 const r=engine2.recommend({heroes,draft,matchups,stratz:only2,mode:'ourPick'}).find(x=>x.heroId===1);
 assert.ok(r.components.stratzCounter>0,'STRATZ edge vs hero 2');assert.ok(r.components.matchup>0,'OpenDota edge vs hero 3 kept');
});
test('review: a ban based only on STRATZ is not attributed to a known enemy player',()=>{
 const draft=[act('ourPick',2),act('ourPick',3)];
 const s={2:{heroId:2,vs:[row(7,100,0.3,-8)],with:[]},3:{heroId:3,vs:[row(7,100,0.3,-8)],with:[]}};
 const r=engine2.recommend({heroes,draft,stratz:s,mode:'ourBan',opponents:[{id:'99',name:'Alex',heroes:[],recent:[],matches:[]}]}).find(x=>x.heroId===7);
 assert.ok(r,'counter ban suggested');assert.equal(r.playerId,null);assert.equal(r.playerName,null);
});
test('review: loadStratz stores only valid bodies and keeps at most 40 heroes cached',async()=>{
 const store=new Map(),storage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>void store.set(k,String(v)),removeItem:k=>void store.delete(k),key:i=>[...store.keys()][i],get length(){return store.size;}};
 await assert.rejects(data2.loadStratz(1,{storage,fetcher:async()=>({ok:true,json:async()=>({oops:true})})}));
 assert.equal(store.has('stratz-v1:1'),false);
 for(let i=1;i<=45;i++)await data2.loadStratz(i,{storage,now:()=>i,fetcher:async()=>({ok:true,json:async()=>({heroId:i,vs:[],with:[]})})});
 assert.equal([...store.keys()].filter(k=>k.startsWith('stratz-v1:')).length,40);assert.equal(store.has('stratz-v1:1'),false);assert.ok(store.has('stratz-v1:45'));
});
const boardBuilt=await buildBoard({logLevel:'silent',plugins:[{name:'stratz-boundaries',enforce:'pre',load(id){
 const p=id.replaceAll('\\','/');
 if(p.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(p.endsWith('/web/data.js'))return 'export const publicData={request:async()=>[]};export const loadHeroes=async()=>globalThis.__heroes;export const loadPlayer=async id=>({id:String(id),name:String(id),sources:{},heroes:[],recent:[],matches:[]});export const loadStratz=async id=>globalThis.__stratz[id];';
}}],build:{write:false,minify:false}});
const boardCode=boardBuilt.output.find(o=>o.type==='chunk'&&o.isEntry).code,boardMarkup=await readFile('web/index.html','utf8');
const settle=async()=>{for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,0));await new Promise(r=>setImmediate(r));}};
test('review: the visible suggestion list uses STRATZ and credits it once',async()=>{
 const ids={ourPick:[1,4],enemyPick:[2,3],ban:20};const n=engine2.CM_ORDER.findIndex((t,i)=>i>8&&t.team==='A'&&t.action==='Pick');
 let our=0,en=0,ban=20;const actions=engine2.CM_ORDER.slice(0,n).map(({team,action})=>{const side=team==='A'?'our':'enemy';return {mode:side+action,heroId:action==='Pick'?(side==='our'?[1,4][our++]:[2,3][en++]):ban++};});
 const w=new JSDOM(boardMarkup,{url:'https://board.example/?practice',runScripts:'outside-only'}).window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{actions,firstPick:true,enemyIds:[]},profile:{}}));
 w.__heroes=JSON.parse(await readFile('web/heroes.json','utf8')); /* the real loadHeroes returns the full hero list */
 const strong={h:5,m:400,w:0.35,s:-9};w.__stratz={2:{heroId:2,vs:[strong],with:[]},3:{heroId:3,vs:[{...strong}],with:[]},1:{heroId:1,vs:[],with:[]},4:{heroId:4,vs:[],with:[]}};
 try{w.eval(boardCode);await settle();
  const text=w.document.getElementById('suggestions').textContent;
  assert.match(text,/Counters /,'a STRATZ counter reason is visible');
  assert.equal(w.document.querySelectorAll('.stratz-credit').length,1,'credit shown once');
 }finally{w.close();}
});
