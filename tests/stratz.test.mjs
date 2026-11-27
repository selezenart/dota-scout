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
const rowsOf = (data,error=null) => { const log = {}; const createClient = (url,key) => { log.url = url; log.key = key; log.created = (log.created||0)+1; return {from:table => { log.table = table; return {select:cols => { log.cols = cols; return {eq:(col,val) => { log.col = col; log.val = val; return {maybeSingle:async()=>{ if (error === 'throw') throw new Error('boom'); return {data,error}; }}; }}; }}; }}; }; return {log,createClient}; };
const ENV = {SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'svc',STRATZ_API_TOKEN:'sekret'};
const call = async (url,{env=ENV,data={hero_id:1,vs:[row(94,451,0.574,11.4)],with:[row(7,80,0.5,-2.3)]},error=null}={}) => {
  const res = fakeRes(), {log,createClient} = rowsOf(data,error); let fetched = 0;
  const prev = globalThis.fetch; globalThis.fetch = async()=>{fetched++;throw new Error('no fetch');};
  try { await api.createHandler({createClient,env})({url,query:Object.fromEntries(new URL(url,'https://x.invalid').searchParams)},res); } finally { globalThis.fetch = prev; }
  return {res,log,fetched};
};

test('compactMatchup compacts rows and drops invalid ones', () => {
  const c = api.compactMatchup(upstream,1);
  assert.deepEqual(c,{heroId:1,vs:[{h:94,m:451,w:0.574,s:11.4}],with:[{h:7,m:80,w:0.5,s:-2.3}]});
});
test('compactMatchup returns null for missing/invalid json', () => {
  for (const j of [null,undefined,{},{data:null},'x',{data:{heroStats:{}}}]) assert.equal(api.compactMatchup(j,1),null);
});
test('handler rejects bad hero ids with 400', async () => {
  for (const hero of [undefined,'abc','0','301','1.5','-2','01','1&x=1','250','24']) {
    const {res,log} = await call(hero===undefined?'/api/stratz':'/api/stratz?hero='+hero);
    assert.equal(res.statusCode,400); assert.deepEqual(res.body,{error:'Invalid hero'}); assert.equal(res.headers['Cache-Control'],'no-store'); assert.equal(log.created,undefined);
  }
  for (const url of ['/api/stratz?hero=1&','/api/stratz?&hero=1','/api/stratz?%68ero=1','/api/stratz?hero=%31','/api/stratz?hero=1&&&']) {
    const {res,log} = await call(url); assert.equal(res.statusCode,400,url); assert.equal(log.created,undefined);
  }
});
test('handler returns 503 cacheable when Supabase env is missing', async () => {
  for (const env of [{},{SUPABASE_URL:'https://db.example'},{SUPABASE_ANON_KEY:'anon'}]) {
    const {res,log} = await call('/api/stratz?hero=1',{env});
    assert.equal(res.statusCode,503); assert.equal(res.headers['Cache-Control'],'public, s-maxage=300'); assert.equal(res.headers['Retry-After'],'300'); assert.equal(log.created,undefined);
  }
});
test('handler reads stratz_matchups with the anon key only and never calls STRATZ', async () => {
  const {res,log,fetched} = await call('/api/stratz?hero=1');
  assert.equal(log.url,'https://db.example'); assert.equal(log.key,'anon'); assert.equal(log.table,'stratz_matchups');
  assert.equal(log.cols,'hero_id,vs,with'); assert.equal(log.col,'hero_id'); assert.equal(log.val,1); assert.equal(fetched,0);
  assert.equal(res.statusCode,200); assert.deepEqual(res.body,{heroId:1,vs:[row(94,451,0.574,11.4)],with:[row(7,80,0.5,-2.3)]});
  assert.equal(res.headers['Cache-Control'],'public, s-maxage=21600, stale-while-revalidate=86400');
  assert.ok(!JSON.stringify([res.body,res.headers,log]).includes('sekret')); assert.notEqual(log.key,'svc');
});
test('handler answers 404 cacheable when there is no row', async () => {
  for (const data of [null]) {
    const {res} = await call('/api/stratz?hero=1',{data});
    assert.equal(res.statusCode,404); assert.deepEqual(res.body,{error:'No STRATZ data yet'}); assert.equal(res.headers['Cache-Control'],'public, s-maxage=600'); assert.equal(res.headers['Retry-After'],'600');
  }
});
test('handler maps Supabase errors and thrown errors to 502 no-store', async () => {
  for (const o of [{data:null,error:{message:'rls sekret'}},{data:null,error:'throw'}]) {
    const {res} = await call('/api/stratz?hero=1',o);
    assert.equal(res.statusCode,502); assert.equal(res.headers['Cache-Control'],'no-store'); assert.ok(!JSON.stringify(res.body).includes('sekret'));
  }
});
test('.vercelignore allows the reader and the refresh job', async () => {
  const lines = (await readFile('.vercelignore','utf8')).split('\n').map(l=>l.trim());
  assert.ok(lines.includes('!api/stratz.js')); assert.ok(lines.includes('!api/stratz-refresh.js'));
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
test('loadStratz rejects a hung request after its timeout so the retry backoff can run', async () => {
  let signal;
  // Never answers unless aborted, like a stalled proxy.
  const fetcher = (u,init) => new Promise((_,reject) => {signal = init?.signal; signal?.addEventListener('abort',()=>reject(signal.reason));});
  const started = Date.now();
  await assert.rejects(data.loadStratz(5,{fetcher,storage:null,timeout:20}));
  assert.ok(signal,'fetch receives an abort signal');
  assert.ok(signal.aborted);
  assert.ok(Date.now()-started < 2000);
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
import {boardCode as compile} from './build-board.js';
import {BACKEND_STUB,dataStub,ticks,boardWindow,prepareWindow} from './board-harness.js';
import * as engine2 from '../web/draft-engine.js';
import * as data2 from '../web/data.js';
import * as api2 from '../api/stratz.js';
const resOf=()=>({statusCode:0,headers:{},body:null,status(c){this.statusCode=c;return this;},setHeader(k,v){this.headers[k.toLowerCase()]=v;},json(b){this.body=b;return this;}});
const okFetch=async()=>({ok:true,status:200,json:async()=>({data:{heroStats:{heroVsHeroMatchup:{advantage:[{heroId:1,vs:[{heroId2:2,matchCount:100,winsAverage:0.5,synergy:1}],with:[]}]}}}})});

test('review: OpenDota matchup still counts for enemy picks without STRATZ rows',()=>{
 const draft=[act('enemyPick',2),act('enemyPick',3)];
 const matchups={1:[{hero_id:3,games_played:200,wins:140}]};
 const only2={2:{heroId:2,vs:[row(1,100,0.4,-4)],with:[]}};
 const r=engine2.recommend({heroes,draft,matchups,stratz:only2,mode:'ourPick'}).find(x=>x.heroId===1);
 assert.ok(r.components.stratzCounter>0,'STRATZ edge vs hero 2');assert.ok(r.components.matchup>0,'OpenDota edge vs hero 3 kept');
});
const rl = o => engine2.reviewLineup({heroes,...o});
const notesOf = (r,side,id) => r[side].heroes.find(x=>x.heroId===id).notes;
test('reviewLineup: hard and strong matchup notes with exact text and tone',()=>{
 const draft=[act('ourPick',1),act('enemyPick',2),act('enemyPick',3),act('ourBan',9)];
 const stratz={1:{heroId:1,vs:[row(2,120,0.43,-5),row(3,60,0.56,4.5)],with:[]}};
 const n=notesOf(rl({draft,stratz}),'our',1);
 assert.deepEqual(n.slice(0,2),[{text:'Hard time vs Hero2: wins 43% (120 games)',tone:'warn'},{text:'Strong vs Hero3: wins 56% (60 games)',tone:'good'}]);
});
test('reviewLineup: weak and good pair notes with signed one-decimal points',()=>{
 const draft=[act('ourPick',1),act('ourPick',2),act('ourPick',3)];
 const stratz={1:{heroId:1,vs:[],with:[row(2,80,0.5,-2.54),row(3,80,0.5,3.26)]}};
 assert.deepEqual(notesOf(rl({draft,stratz}),'our',1),[{text:'Weak pair with Hero2: -2.5',tone:'warn'},{text:'Pairs well with Hero3: +3.3',tone:'good'}]);
});
test('reviewLineup: notes come in order hard, strong, weak pair, good pair',()=>{
 const draft=[act('ourPick',1),act('ourPick',2),act('ourPick',3),act('enemyPick',4),act('enemyPick',5)];
 const stratz={1:{heroId:1,vs:[row(4,90,0.4,-6),row(5,90,0.6,6)],with:[row(2,90,0.5,-3),row(3,90,0.5,3)]}};
 assert.deepEqual(notesOf(rl({draft,stratz}),'our',1).map(x=>x.tone),['warn','good','warn','good']);
 assert.match(notesOf(rl({draft,stratz}),'our',1)[0].text,/^Hard time vs Hero4/);
});
test('reviewLineup: picks the lowest and highest rows only',()=>{
 const draft=[act('ourPick',1),act('enemyPick',2),act('enemyPick',3),act('enemyPick',4)];
 const stratz={1:{heroId:1,vs:[row(2,100,0.45,-3),row(3,100,0.4,-7),row(4,100,0.5,0)],with:[]}};
 const n=notesOf(rl({draft,stratz}),'our',1);assert.equal(n.length,1);assert.match(n[0].text,/Hero3/);
});
test('reviewLineup: thresholds are inclusive at exactly 2 and silent just inside',()=>{
 const draft=[act('ourPick',1),act('ourPick',2),act('enemyPick',3),act('enemyPick',4)];
 const at={1:{heroId:1,vs:[row(3,100,0.48,-2),row(4,100,0.52,2)],with:[row(2,100,0.5,-2)]}};
 assert.deepEqual(notesOf(rl({draft,stratz:at}),'our',1).map(x=>x.text.split(' ').slice(0,2).join(' ')),['Hard time','Strong vs','Weak pair']);
 const inside={1:{heroId:1,vs:[row(3,100,0.49,-1.9),row(4,100,0.51,1.9)],with:[row(2,100,0.5,1.9)]}};
 assert.deepEqual(notesOf(rl({draft,stratz:inside}),'our',1),[{text:'No strong matchups or pairs (Divine+)',tone:'info'}]);
 const goodAt={1:{heroId:1,vs:[],with:[row(2,100,0.5,2)]}};
 assert.deepEqual(notesOf(rl({draft,stratz:goodAt}),'our',1),[{text:'Pairs well with Hero2: +2.0',tone:'good'}]);
});
test('reviewLineup: rows with fewer than 50 games are ignored',()=>{
 const draft=[act('ourPick',1),act('ourPick',2),act('enemyPick',3)];
 const stratz={1:{heroId:1,vs:[row(3,49,0.2,-9)],with:[row(2,49,0.5,9)]}};
 const r=rl({draft,stratz});
 assert.deepEqual(notesOf(r,'our',1),[{text:'No STRATZ data for this hero',tone:'info'}]);assert.equal(r.our.edge,null);assert.equal(r.our.pairs,0);
 const edge=rl({draft,stratz:{1:{heroId:1,vs:[row(3,50,0.4,-3)],with:[]}}});assert.match(notesOf(edge,'our',1)[0].text,/Hard time vs Hero3: wins 40% \(50 games\)/);
});
test('reviewLineup: falls back to the opponent list, converting s and w',()=>{
 const draft=[act('ourPick',1),act('enemyPick',2)];
 const stratz={2:{heroId:2,vs:[row(1,200,0.7,6)],with:[]}};
 const r=rl({draft,stratz});
 assert.deepEqual(notesOf(r,'our',1),[{text:'Hard time vs Hero2: wins 30% (200 games)',tone:'warn'}]);
 assert.deepEqual(notesOf(r,'enemy',2),[{text:'Strong vs Hero1: wins 70% (200 games)',tone:'good'}]);
 assert.equal(r.our.edge,-6);assert.equal(r.enemy.edge,6);
});
test('reviewLineup: own row wins over the opponent fallback, and a thin own row falls back',()=>{
 const draft=[act('ourPick',1),act('enemyPick',2)];
 const own={1:{heroId:1,vs:[row(2,100,0.55,3)],with:[]},2:{heroId:2,vs:[row(1,100,0.55,3)],with:[]}};
 assert.match(notesOf(rl({draft,stratz:own}),'our',1)[0].text,/^Strong vs Hero2: wins 55%/);
 const thin={1:{heroId:1,vs:[row(2,10,0.9,9)],with:[]},2:{heroId:2,vs:[row(1,100,0.6,4)],with:[]}};
 assert.match(notesOf(rl({draft,stratz:thin}),'our',1)[0].text,/^Hard time vs Hero2: wins 40% \(100 games\)/);
});
test('reviewLineup: synergy falls back to the teammate list unchanged',()=>{
 const draft=[act('ourPick',1),act('ourPick',2)];
 const stratz={2:{heroId:2,vs:[],with:[row(1,90,0.5,-4)]}};
 const r=rl({draft,stratz});
 assert.deepEqual(notesOf(r,'our',1),[{text:'Weak pair with Hero2: -4.0',tone:'warn'}]);
 assert.deepEqual(notesOf(r,'our',2),[{text:'Weak pair with Hero1: -4.0',tone:'warn'}]);
});
test('reviewLineup: info notes for heroes with and without data',()=>{
 const draft=[act('ourPick',1),act('ourPick',2),act('enemyPick',3)];
 const stratz={1:{heroId:1,vs:[row(3,100,0.5,0.5)],with:[]}};
 const r=rl({draft,stratz});
 assert.deepEqual(notesOf(r,'our',1),[{text:'No strong matchups or pairs (Divine+)',tone:'info'}]);
 assert.deepEqual(notesOf(r,'our',2),[{text:'No STRATZ data for this hero',tone:'info'}]);
});
test('reviewLineup: edge is the rounded mean of s over counted rows and pairs counts them',()=>{
 const draft=[act('ourPick',1),act('ourPick',2),act('enemyPick',3),act('enemyPick',4)];
 const stratz={1:{heroId:1,vs:[row(3,100,0.5,1),row(4,100,0.5,2)],with:[]},2:{heroId:2,vs:[row(3,100,0.5,2)],with:[]}};
 const r=rl({draft,stratz});
 assert.equal(r.our.pairs,3);assert.equal(r.our.edge,1.7);
 assert.equal(r.enemy.pairs,3);assert.equal(r.enemy.edge,-1.7);
 assert.deepEqual(r.our.heroes.map(x=>x.heroId),[1,2]);
});
test('reviewLineup: heroes given as an object keyed by id use localized_name',()=>{
 const draft=[act('ourPick',1),act('enemyPick',2)];
 const stratz={1:{heroId:1,vs:[row(2,100,0.4,-4)],with:[]}};
 const byId={1:{id:1,localized_name:'Anti-Mage'},2:{id:2,localized_name:'Axe'}};
 const r=engine2.reviewLineup({draft,stratz,heroes:byId});
 assert.equal(notesOf(r,'our',1)[0].text,'Hard time vs Axe: wins 40% (100 games)');
});
test('reviewLineup: rows with missing or non-numeric s or w are ignored, never NaN',()=>{
 const draft=[act('ourPick',1),act('ourPick',2),act('enemyPick',3),act('enemyPick',4),act('enemyPick',5)];
 const stratz={1:{heroId:1,vs:[{h:3,m:100,w:0.5},row(4,100,0.5,'x'),row(5,100,'y',3),row(5,100,0.5,2)],with:[{h:2,m:100,w:0.5}]},
  3:{heroId:3,vs:[{h:1,m:100,w:0.5}],with:[]}};
 const r=rl({draft,stratz});
 assert.equal(r.our.pairs,1);assert.equal(r.our.edge,2);
 const all=JSON.stringify(r);assert.doesNotMatch(all,/NaN/);
 for(const side of ['our','enemy'])for(const h of r[side].heroes)for(const n of h.notes)assert.doesNotMatch(n.text,/NaN/);
 const none=rl({draft:[act('ourPick',1),act('enemyPick',3)],stratz:{1:{heroId:1,vs:[{h:3,m:100,w:0.5}],with:[]},3:{heroId:3,vs:[row(1,100,0.5,'x')],with:[]}}});
 assert.equal(none.our.edge,null);assert.equal(none.our.pairs,0);assert.equal(none.enemy.edge,null);
 assert.deepEqual(notesOf(none,'our',1),[{text:'No STRATZ data for this hero',tone:'info'}]);
});
test('reviewLineup: empty input, bans ignored, names fall back to ids, roles unused',()=>{
 const e=engine2.reviewLineup();assert.deepEqual(e,{our:{edge:null,pairs:0,heroes:[]},enemy:{edge:null,pairs:0,heroes:[]}});
 const draft=[act('ourPick',1),act('enemyPick',77),act('enemyBan',3),act('ourBan',4)];
 const stratz={1:{heroId:1,vs:[row(77,100,0.4,-4),row(3,100,0.4,-9)],with:[]}};
 const r=engine2.reviewLineup({draft,stratz,heroes:[{id:1,localized_name:'Hero1',roles:['Carry']}]});
 assert.equal(notesOf(r,'our',1)[0].text,'Hard time vs 77: wins 40% (100 games)');assert.equal(r.our.pairs,1);
 assert.equal(JSON.stringify(rl({draft,stratz})),JSON.stringify(engine2.reviewLineup({draft,stratz,heroes:heroes.map(h=>({...h,roles:['Support']}))})));
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
const boardCode=await compile({'/web/backend.js':BACKEND_STUB,'/web/data.js':dataStub({loadPlayer:'async id=>({id:String(id),name:String(id),sources:{},heroes:[],recent:[],matches:[]})',extra:'export const loadStratz=async id=>globalThis.__stratzLoad?globalThis.__stratzLoad(id):globalThis.__stratz[id];'})});
const settle=()=>ticks(12);
test('review: the visible suggestion list uses STRATZ and credits it once',async()=>{
 const ids={ourPick:[1,4],enemyPick:[2,3],ban:20};const n=engine2.CM_ORDER.findIndex((t,i)=>i>8&&t.team==='A'&&t.action==='Pick');
 let our=0,en=0,ban=20;const actions=engine2.CM_ORDER.slice(0,n).map(({team,action})=>{const side=team==='A'?'our':'enemy';return {mode:side+action,heroId:action==='Pick'?(side==='our'?[1,4][our++]:[2,3][en++]):ban++};});
 const w=boardWindow().window;
 prepareWindow(w);
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{actions,firstPick:true,enemyIds:[]},profile:{}}));
 w.__heroes=JSON.parse(await readFile('web/heroes.json','utf8')); /* the real loadHeroes returns the full hero list */
 const strong={h:5,m:400,w:0.35,s:-9};w.__stratz={2:{heroId:2,vs:[strong],with:[]},3:{heroId:3,vs:[{...strong}],with:[]},1:{heroId:1,vs:[],with:[]},4:{heroId:4,vs:[],with:[]}};
 try{w.eval(boardCode);await settle();
  const text=w.document.getElementById('suggestions').textContent;
  assert.match(text,/Counters /,'a STRATZ counter reason is visible');
  assert.equal(w.document.querySelectorAll('.stratz-credit').length,1,'credit shown once');
 }finally{w.close();}
});

test('board: the draft review shows STRATZ notes and matchup edge instead of Traits',async()=>{
 const our=[1,4,5,6,7],enemy=[2,3,8,9,10];let o=0,e=0,ban=20;
 const actions=engine2.CM_ORDER.map(({team,action})=>{const side=team==='A'?'our':'enemy';return {mode:side+action,heroId:action==='Pick'?(side==='our'?our[o++]:enemy[e++]):ban++};});
 const w=boardWindow().window;
 prepareWindow(w);
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{actions,firstPick:true,enemyIds:[]},profile:{}}));
 w.__heroes=JSON.parse(await readFile('web/heroes.json','utf8'));
 w.__stratz={1:{heroId:1,vs:[row(2,200,0.4,-6),row(3,200,0.55,3)],with:[row(4,100,0.5,-4),row(5,100,0.5,4)]},4:{heroId:4,vs:[],with:[]},2:{heroId:2,vs:[],with:[]}};
 try{w.eval(boardCode);await settle();
  const btn=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Show draft review');assert.ok(btn,'review button');
  btn.click();await settle();
  const review=w.document.getElementById('analysis');
  assert.equal(review.hidden,false);assert.doesNotMatch(review.textContent,/Traits:/);
  const rows=[...review.querySelectorAll('.review-player')];assert.equal(rows.length,10);
  for(const r of rows){const n=r.nextElementSibling;assert.ok(n&&n.classList.contains('review-notes'),'notes follow each player row');assert.ok(n.querySelectorAll('li').length>=1);}
  const first=rows[0].nextElementSibling;
  assert.ok(first.querySelector('.review-note-warn'));assert.ok(first.querySelector('.review-note-good'));
  assert.match(first.textContent,/Hard time vs [A-Za-z]/);assert.doesNotMatch(first.textContent,/vs \d+:/);assert.doesNotMatch(first.textContent,/with \d+:/);assert.match(first.textContent,/Weak pair with /);
  assert.ok(review.querySelector('.review-note-info'),'heroes without data get an info note');
  const edges=[...review.querySelectorAll('p')].map(p=>p.textContent).filter(t=>t.startsWith('Matchup edge (Divine+): '));
  assert.equal(edges.length,2);
  for(const t of edges)assert.match(t,/^Matchup edge \(Divine\+\): ([+-]?\d+(\.\d)? per matchup across \d+ matchups|no data)$/);
  assert.equal(review.querySelectorAll('.stratz-credit').length,1);assert.match(review.querySelector('.stratz-credit').textContent,/Powered by STRATZ/);
 }finally{w.close();}
});
test('board: a failed STRATZ load is retried after the backoff without another draft action',async()=>{
 const n=engine2.CM_ORDER.findIndex((t,i)=>i>8&&t.team==='A'&&t.action==='Pick');
 let our=0,en=0,ban=20;const actions=engine2.CM_ORDER.slice(0,n).map(({team,action})=>{const side=team==='A'?'our':'enemy';return {mode:side+action,heroId:action==='Pick'?(side==='our'?[1,4][our++]:[2,3][en++]):ban++};});
 const w=boardWindow().window;
 const timers=[];w.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
 prepareWindow(w);
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{actions,firstPick:true,enemyIds:[]},profile:{}}));
 w.__heroes=JSON.parse(await readFile('web/heroes.json','utf8'));
 const strong={h:5,m:400,w:0.35,s:-9};const good={2:{heroId:2,vs:[strong],with:[]},3:{heroId:3,vs:[{...strong}],with:[]},1:{heroId:1,vs:[],with:[]},4:{heroId:4,vs:[],with:[]}};
 let down=true;w.__stratzLoad=async id=>{if(down)throw new Error('down');return good[id];};
 try{w.eval(boardCode);await settle();
  assert.doesNotMatch(w.document.getElementById('suggestions').textContent,/Counters /);
  down=false;for(const t of timers.filter(t=>t.ms>=60000))t.fn();await settle();
  assert.match(w.document.getElementById('suggestions').textContent,/Counters /,'retried and rendered without a new pick');
 }finally{w.close();}
});
