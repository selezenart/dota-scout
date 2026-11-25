import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const mod = await import('../api/stratz-refresh.js').catch(() => ({}));
const heroMap = JSON.parse(await readFile('web/heroes.json','utf8'));
const allIds = Object.keys(heroMap).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
const ENV = {STRATZ_API_TOKEN:'sekret-token',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'svc-key'};
const entry = id => ({advantage:[{heroId:id,vs:[{heroId2:id+1,matchCount:100,winsAverage:0.5123,synergy:1.26}],with:[{heroId2:id+2,matchCount:50,winsAverage:0.4,synergy:-2.26}]}]});
const idsIn = body => [...JSON.parse(body).query.matchAll(/h(\d+):\s*heroVsHeroMatchup/g)].map(m=>+m[1]);
const okBody = body => ({data:{heroStats:Object.fromEntries(idsIn(body).map(id=>['h'+id,entry(id)]))}});
const setup = ({respond=async(u,init)=>({ok:true,status:200,json:async()=>okBody(init.body)}),upsertError=null,heroIds=[1,2,3,4,5,6,7,8,9,10,11,12],env=ENV}={}) => {
  const fetches = [], upserts = [], events = [], clients = [];
  const fetcher = async (u,init) => { fetches.push({u,init}); events.push('fetch'); return respond(u,init,fetches.length); };
  const sleep = async ms => { events.push('sleep:'+ms); };
  const createClient = (url,key,opts) => { clients.push({url,key,opts}); return {from:table => ({upsert:async(rows,o) => { upserts.push({table,rows,o}); events.push('upsert'); return {error:typeof upsertError==='function'?upsertError(rows):upsertError}; }})}; };
  const run = () => mod.refreshStratz({fetcher,createClient,env,sleep,...(heroIds===null?{}:{heroIds})});
  return {run,fetches,upserts,events,clients};
};
const fakeRes = () => ({statusCode:200,headers:{},body:undefined,status(c){this.statusCode=c;return this;},setHeader(k,v){this.headers[k.toLowerCase()]=v;},json(b){this.body=b;return this;}});
const hit = async ({refresh=async()=>({stored:3,failed:[]}),env={CRON_SECRET:'x'.repeat(20),VERCEL_ENV:'production'},headers={authorization:'Bearer '+'x'.repeat(20)},url='/api/stratz-refresh?slot=prod'}={}) => {
  let calls = 0; const res = fakeRes();
  await mod.createRefreshHandler({refresh:async(...a)=>{calls++;return refresh(...a);},env})({url,query:Object.fromEntries(new URL(url,'https://x.invalid').searchParams),headers,method:'GET'},res);
  return {res,calls:()=>calls};
};

test('refresh requires STRATZ token, Supabase url and service key, without any fetch', async () => {
  for (const k of Object.keys(ENV)) {
    const env = {...ENV}; delete env[k]; const s = setup({env});
    await assert.rejects(s.run(),{message:'STRATZ refresh is not configured'}); assert.equal(s.fetches.length,0);
  }
});
test('refresh defaults to every hero id from heroes.json ascending, 5 per request', async () => {
  const s = setup({heroIds:null}); await s.run();
  assert.deepEqual(s.fetches.flatMap(f=>idsIn(f.init.body)),allIds);
  for (const f of s.fetches) assert.ok(idsIn(f.init.body).length<=5);
  assert.equal(s.fetches.length,Math.ceil(allIds.length/5));
});
test('refresh posts aliased GraphQL with the token headers', async () => {
  const s = setup(); await s.run();
  const {u,init} = s.fetches[0];
  assert.equal(u,'https://api.stratz.com/graphql'); assert.equal(init.method,'POST');
  assert.equal(init.headers.Authorization,'Bearer sekret-token'); assert.equal(init.headers['User-Agent'],'STRATZ_API'); assert.equal(init.headers['Content-Type'],'application/json');
  const q = JSON.parse(init.body).query;
  for (const id of [1,2,3,4,5]) assert.ok(q.includes(`h${id}: heroVsHeroMatchup(heroId: ${id}, bracketBasicIds: [DIVINE_IMMORTAL], take: 200)`),String(id));
  assert.ok(!q.includes('h6:')); assert.match(q,/heroStats\s*\{/); assert.match(q,/advantage\s*\{\s*heroId\s+vs\s*\{\s*heroId2 matchCount winsAverage synergy\s*\}\s*with\s*\{\s*heroId2 matchCount winsAverage synergy\s*\}/);
});
test('refresh sleeps 1500 ms between batches only, and stores compacted rows with the service key', async () => {
  const s = setup(); const out = await s.run();
  assert.deepEqual(s.events,['fetch','upsert','sleep:1500','fetch','upsert','sleep:1500','fetch','upsert']);
  assert.deepEqual(out,{stored:12,failed:[]});
  assert.equal(s.clients[0].url,'https://db.example'); assert.equal(s.clients[0].key,'svc-key');
  const u = s.upserts[0]; assert.equal(u.table,'stratz_matchups'); assert.deepEqual(u.o,{onConflict:'hero_id'}); assert.equal(u.rows.length,5);
  const r = u.rows[0]; assert.deepEqual(Object.keys(r).sort(),['hero_id','updated_at','vs','with']);
  assert.equal(r.hero_id,1); assert.deepEqual(r.vs,[{h:2,m:100,w:0.512,s:1.3}]); assert.deepEqual(r.with,[{h:3,m:50,w:0.4,s:-2.3}]);
  assert.ok(!Number.isNaN(Date.parse(r.updated_at))); assert.equal(new Date(r.updated_at).toISOString(),r.updated_at);
});
test('refresh counts a failed, errored or incomplete batch as failed and continues', async () => {
  const s = setup({respond:async(u,init,n)=>{
    if (n===1) return {ok:false,status:500,json:async()=>({})};
    if (n===2) return {ok:true,status:200,json:async()=>{const b=okBody(init.body); delete b.data.heroStats.h8; return b;}};
    return {ok:true,status:200,json:async()=>okBody(init.body)};
  }});
  assert.deepEqual(await s.run(),{stored:6,failed:[1,2,3,4,5,8]}); assert.equal(s.fetches.length,3);
  const e = setup({respond:async(u,init,n)=>({ok:true,status:200,json:async()=>n===1?{errors:[{message:'sekret-token boom'}]}:okBody(init.body)})});
  assert.deepEqual(await e.run(),{stored:7,failed:[1,2,3,4,5]});
});
test('refresh stops the whole run on STRATZ 403 or 429', async () => {
  for (const status of [403,429]) {
    const s = setup({respond:async(u,init,n)=>n===2?{ok:false,status,json:async()=>({})}:{ok:true,status:200,json:async()=>okBody(init.body)}});
    assert.deepEqual(await s.run(),{stored:5,failed:[6,7,8,9,10,11,12]}); assert.equal(s.fetches.length,2,String(status));
  }
});
test('refresh throws when nothing was stored and never leaks the token', async () => {
  const s = setup({respond:async()=>({ok:false,status:403,json:async()=>({})})});
  await assert.rejects(s.run(),e=>e instanceof Error&&!e.message.includes('sekret-token')&&!String(e.stack||'').includes('sekret-token'));
  const u = setup({upsertError:{message:'denied sekret-token'}});
  await assert.rejects(u.run(),e=>!e.message.includes('sekret-token'));
});
test('refresh counts heroes of a failed upsert as failed and result has no token', async () => {
  let n = 0; const s = setup({upsertError:()=>++n===2?{message:'db down'}:null});
  const out = await s.run(); assert.deepEqual(out,{stored:7,failed:[6,7,8,9,10]}); assert.ok(!JSON.stringify(out).includes('sekret-token'));
});

test('refresh handler needs a CRON_SECRET of 16+ chars: 503 otherwise', async () => {
  for (const env of [{VERCEL_ENV:'production'},{CRON_SECRET:'short',VERCEL_ENV:'production'}]) {
    const {res,calls} = await hit({env}); assert.equal(res.statusCode,503); assert.equal(calls(),0);
  }
});
test('refresh handler rejects wrong or missing authorization with 401', async () => {
  const good = 'x'.repeat(20);
  for (const headers of [{},{authorization:'Bearer nope'},{authorization:good},{authorization:'Bearer '+good+'y'},{authorization:'Bearer '+'y'.repeat(20)}]) {
    const {res,calls} = await hit({headers}); assert.equal(res.statusCode,401,JSON.stringify(headers)); assert.equal(calls(),0);
  }
});
test('refresh handler runs only in the matching slot', async () => {
  const cases = [['prod','production',true],['prod','preview',false],['prod',undefined,false],['preview','production',false],['preview','preview',true],['preview',undefined,true]];
  for (const [slot,vercelEnv,runs] of cases) {
    const {res,calls} = await hit({url:'/api/stratz-refresh?slot='+slot,env:{CRON_SECRET:'x'.repeat(20),VERCEL_ENV:vercelEnv}});
    assert.equal(res.statusCode,200,slot+vercelEnv); assert.equal(calls(),runs?1:0,slot+vercelEnv);
    if (!runs) assert.deepEqual(res.body,{skipped:true});
  }
  for (const url of ['/api/stratz-refresh','/api/stratz-refresh?slot=other']) { const {res,calls} = await hit({url}); assert.equal(res.statusCode,400,url); assert.equal(calls(),0); }
});
test('refresh handler returns stored/failed no-store, and a bare 500 on failure', async () => {
  let {res} = await hit({refresh:async()=>({stored:4,failed:[9,10]})});
  assert.equal(res.statusCode,200); assert.deepEqual(res.body,{stored:4,failed:[9,10]}); assert.equal(res.headers['cache-control'],'no-store');
  ({res} = await hit({refresh:async()=>{throw new Error('sekret-token leaked');}}));
  assert.equal(res.statusCode,500); assert.deepEqual(res.body,{error:'STRATZ refresh failed'});
});
test('refresh module has a default handler export', () => { assert.equal(typeof mod.default,'function'); });

test('vercel.json schedules the two refresh slots and allows 300 s', async () => {
  const v = JSON.parse(await readFile('vercel.json','utf8'));
  assert.deepEqual(v.schedules?.['stratz-refresh-prod'],{schedule:'0 4 * * *',path:'/api/stratz-refresh?slot=prod',requestMethod:'GET'});
  assert.deepEqual(v.schedules?.['stratz-refresh-preview'],{schedule:'0 16 * * *',path:'/api/stratz-refresh?slot=preview',requestMethod:'GET'});
  assert.equal(v.functions?.['api/stratz-refresh.js']?.maxDuration,300);
});
test('migration 012 creates a read-only public.stratz_matchups', async () => {
  const sql = await readFile('supabase/migrations/012_stratz_matchups.sql','utf8').catch(()=>'');
  assert.match(sql,/create table[^;]*public\.stratz_matchups/i); assert.match(sql,/hero_id[^,;]*primary key/i);
  assert.match(sql,/alter table\s+public\.stratz_matchups\s+enable row level security/i);
  assert.match(sql,/grant\s+select\s+on\s+(table\s+)?public\.stratz_matchups\s+to\s+[^;]*anon[^;]*authenticated|grant\s+select\s+on\s+(table\s+)?public\.stratz_matchups\s+to\s+[^;]*authenticated[^;]*anon/i);
  assert.doesNotMatch(sql,/grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*to\s+[^;]*\b(anon|authenticated)\b/i);
  assert.doesNotMatch(sql,/create policy[^;]*for\s+(insert|update|delete|all)/i);
});
