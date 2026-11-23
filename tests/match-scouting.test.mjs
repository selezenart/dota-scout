import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';
import * as engine from '../web/draft-engine.js';
import * as data from '../web/data.js';

const fakeFetch=(body,log=[])=>async url=>{log.push(url);return {ok:true,status:200,json:async()=>body};};
const store=()=>{const m=new Map();return {m,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};

// data.js
test('PublicQueue accepts /matches/<id> and caches only the transformed value',async()=>{
 const storage=store(),log=[];
 const queue=new data.PublicQueue({storage,fetcher:fakeFetch({match_id:123,chat:[{key:'gg'}]},log),sleep:async()=>{}});
 const out=await queue.request('/matches/123',{transform:j=>({id:j.match_id})});
 assert.deepEqual(out,{id:123});
 const saved=storage.m.get('od-public-v1:/matches/123');
 assert.ok(saved,'stored');assert.deepEqual(JSON.parse(saved).value,{id:123});assert.doesNotMatch(saved,/chat/);
 assert.deepEqual(await queue.request('/matches/123'),{id:123});assert.equal(log.length,1);
});
test('PublicQueue still rejects non-numeric match paths',async()=>{
 const queue=new data.PublicQueue({storage:null,fetcher:fakeFetch({})});
 await assert.rejects(queue.request('/matches/abc'),/Unsupported/);
});
test('parseMatchIds accepts ids and match links, dedupes in order',()=>{
 const t='8001234567, 42\nhttps://www.dotabuff.com/matches/8001234567 https://www.opendota.com/matches/77/overview?x=1 https://stratz.com/matches/88';
 assert.deepEqual(data.parseMatchIds(t),['8001234567','42','77','88']);
});
test('parseMatchIds throws listing invalid tokens',()=>{
 assert.throws(()=>data.parseMatchIds('123 abc 0 123456789012'),e=>/abc/.test(e.message)&&/0/.test(e.message)&&/123456789012/.test(e.message));
});
test('summarizeMatch maps OpenDota match to compact summary',()=>{
 const s=data.summarizeMatch({match_id:8001,start_time:1700000000,lobby_type:9,radiant_win:true,chat:[1],
  players:[{account_id:111,hero_id:3,player_slot:128,personaname:'Foe'},{account_id:4294967295,hero_id:1,player_slot:0},{hero_id:2,isRadiant:true,account_id:null}],
  picks_bans:[{hero_id:2,is_pick:false,team:1,order:0,extra:1}]});
 assert.deepEqual(s,{matchId:'8001',startTime:1700000000,lobbyType:9,radiantWin:true,
  players:[{accountId:'111',heroId:3,isRadiant:false,name:'Foe'},{accountId:null,heroId:1,isRadiant:true,name:null},{accountId:null,heroId:2,isRadiant:true,name:null}],
  picksBans:[{heroId:2,isPick:false,team:1,order:0}]});
 const bare=data.summarizeMatch({match_id:5,start_time:1,players:[]});
 assert.deepEqual([bare.picksBans,bare.lobbyType,bare.radiantWin],[[],null,null]);
});
test('loadMatch requests the summarized match with long ttl',async()=>{
 const calls=[];const queue={request:async(...a)=>{calls.push(a);return {matchId:'9'};}};
 assert.deepEqual(await data.loadMatch('9',queue),{matchId:'9'});
 assert.equal(calls[0][0],'/matches/9');
 assert.deepEqual(calls[0][1],{priority:6,ttl:30*86400000,transform:data.summarizeMatch});
});

// engine
const P=(accountId,heroId,isRadiant,name=null)=>({accountId,heroId,isRadiant,name});
const sumA={matchId:'1',startTime:1,lobbyType:9,radiantWin:true,players:[P('5',1,true),P(null,2,true),P('111',3,false,'Foe'),P(null,53,false)],
 picksBans:[{heroId:1,isPick:false,team:0,order:0},{heroId:2,isPick:false,team:1,order:1},{heroId:3,isPick:true,team:1,order:2}]};
const sumB={matchId:'2',startTime:2,lobbyType:9,radiantWin:false,players:[P(null,1,true),P(null,53,true),P(null,2,false),P(null,3,false)],picksBans:[]};
test('enemyMatchReport resolves sides, aggregates picks, bans, players and anonymous',()=>{
 const rows=[{matchId:'1',summary:sumA,enemySide:null,contextIds:[]},{matchId:'2',summary:sumB,enemySide:'radiant',contextIds:[]},{matchId:'3',summary:{...sumB,matchId:'3'},enemySide:null,contextIds:[]}];
 const r=engine.enemyMatchReport(rows,['111']);
 assert.deepEqual(r.matches,[{matchId:'1',side:'dire',won:false},{matchId:'2',side:'radiant',won:false},{matchId:'3',side:null,won:null}]);
 assert.deepEqual(r.unresolved,['3']);
 assert.deepEqual(r.picks,[{heroId:53,games:2,wins:0},{heroId:1,games:1,wins:0},{heroId:3,games:1,wins:0}]);
 assert.deepEqual(r.bans,[{heroId:2,count:1}]);
 assert.deepEqual(r.players,[{accountId:'111',name:'Foe',heroId:3,matchId:'1'}]);
 assert.equal(r.anonymous,3);
});
test('enemyMatchReport leaves a match unresolved when both sides contain enemy ids',()=>{
 const s={...sumA,players:[P('111',1,true),P('222',2,false)]};
 const r=engine.enemyMatchReport([{matchId:'1',summary:s,enemySide:null,contextIds:[]}],['111','222']);
 assert.deepEqual(r.unresolved,['1']);assert.deepEqual(r.picks,[]);
});
test('enemyMatchReport won is null when radiantWin is unknown',()=>{
 const r=engine.enemyMatchReport([{matchId:'2',summary:{...sumB,radiantWin:null},enemySide:'dire',contextIds:[]}],[]);
 assert.deepEqual(r.matches,[{matchId:'2',side:'dire',won:null}]);
});
test('relevantEnemyMatches keeps overlapping or last-24h rows',()=>{
 const now=1_700_000_000_000,h=3600000;
 const rows=[{matchId:'a',summary:sumA,contextIds:[],addedAt:now-100*h},{matchId:'b',summary:sumB,contextIds:['111'],addedAt:now-100*h},{matchId:'c',summary:sumB,contextIds:[],addedAt:now-2*h},{matchId:'d',summary:sumB,contextIds:[],addedAt:now-100*h},{matchId:'e',summary:sumB,contextIds:['999'],addedAt:now-2*h}];
 assert.deepEqual(engine.relevantEnemyMatches(rows,['111'],now).map(r=>r.matchId),['a','b','c']);
 // A recent row saved for another opponent must not leak into this one.
 assert.deepEqual(engine.relevantEnemyMatches(rows,['555'],now).map(r=>r.matchId),['c']);
});

// UI
const heroes=[{id:1,localized_name:'Anti-Mage',roles:['Carry']},{id:2,localized_name:'Axe',roles:['Initiator']},{id:3,localized_name:'Crystal Maiden',roles:['Support']},{id:53,localized_name:"Nature's Prophet",roles:['Carry']}];
const built=await build({logLevel:'silent',plugins:[{name:'flow-boundaries',enforce:'pre',load(id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(path.endsWith('/web/data.js'))return `export const publicData={request:async()=>[]};export const loadHeroes=async()=>globalThis.__heroes;export const loadPlayer=async(id,progress)=>{const p=globalThis.__players[id];progress(p);return p;};export const loadMatch=async id=>globalThis.__matches[id];export const parseMatchIds=t=>[...new Set(String(t).split(/[\\s,]+/).filter(Boolean))];export const summarizeMatch=x=>x;`;
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const markup=await readFile('web/index.html','utf8');
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const now=1_700_000_000;
const sources={profile:{status:'updated'},recent:{status:'updated'},heroes:{status:'updated'},matches:{status:'updated'}};
const A={matchId:'8001',startTime:now-3600,lobbyType:9,radiantWin:true,players:[P(null,1,true),P(null,2,true),P('111',3,false,'Foe'),P(null,53,false)],picksBans:[{heroId:1,isPick:false,team:1,order:0}]};
const B={matchId:'8002',startTime:now-3600,lobbyType:9,radiantWin:false,players:[P(null,1,true),P(null,53,true),P(null,2,false),P(null,3,false)],picksBans:[]};
const boot=async(saved,setup)=>{
 const dom=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const [k,v] of Object.entries(saved||{}))w.localStorage.setItem(k,v);
 w.__heroes=Object.fromEntries(heroes.map(h=>[h.id,h]));w.__matches={8001:A,8002:B};
 w.__players={111:{id:'111',name:'Foe',sources,heroes:[{hero_id:1,games:3,win:1,last_played:now}],recent:[],matches:[]}};
 w.eval(code);await flush();w.eval(`Date.now=()=>${now*1000}`);
 if(setup){const d=w.document;d.getElementById('setup-button').click();await flush();d.getElementById('enemy-account-input').value='111';
  d.getElementById('enemy-match-input').value='8001 8002';
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Load matches').click();await flush();
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();await flush();}
 return w;
};
const items=(el,sel)=>[...el.querySelectorAll(sel)].map(x=>x.textContent);

test('saved matches with no enemy IDs keep the report and side controls reachable',async()=>{
 const w=await boot();
 try{
  const d=w.document;d.getElementById('setup-button').click();await flush();
  d.getElementById('enemy-match-input').value='8002';
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Load matches').click();await flush();
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();await flush();
  const section=d.getElementById('draft-enemy-scouting'),report=section.querySelector('.draft-enemy-matches');
  assert.ok(report);assert.equal(section.hidden,false);
  assert.equal(section.classList.contains('has-match-report'),true);assert.equal(section.classList.contains('is-detail-open'),false);
  assert.ok([...report.querySelectorAll('button')].some(b=>/Enemy was (Radiant|Dire)|Switch side/.test(b.textContent)));
  assert.equal(section.querySelectorAll('.draft-enemy').length,0);
 }finally{w.close();}
});
test('Setup has match input and draft panel shows Battle Cup matches with side resolution',async()=>{
 const w=await boot(null,true),d=w.document;
 try{
  const label=[...d.querySelectorAll('label')].find(l=>l.textContent.includes('Their earlier Battle Cup matches (IDs or links)'));
  assert.ok(label,'label');assert.ok(d.getElementById('enemy-match-input'));
  const m=d.querySelector('#draft-enemy-scouting .draft-enemy-matches');
  assert.ok(m,'.draft-enemy-matches');assert.equal(m.querySelector('h4').textContent,'Their Battle Cup matches');
  let picks=items(m,'.draft-enemy-match-pick').join('|');
  assert.match(picks,/Crystal Maiden.*×1/);assert.match(picks,/Nature's Prophet.*×1/);assert.doesNotMatch(picks,/Anti-Mage/);
  assert.match(items(m,'.draft-enemy-match-ban').join('|'),/Anti-Mage/);
  const btn=t=>[...m.querySelectorAll('button')].find(b=>b.textContent===t);
  assert.ok(btn('Enemy was Dire'));btn('Enemy was Radiant').click();await flush();
  const m2=d.querySelector('#draft-enemy-scouting .draft-enemy-matches');
  assert.equal([...m2.querySelectorAll('button')].filter(b=>/^Enemy was/.test(b.textContent)).length,0);
  picks=items(m2,'.draft-enemy-match-pick').join('|');
  assert.match(picks,/Anti-Mage.*×1/);assert.match(picks,/Nature's Prophet.*×2/);
  const sw=[...m2.querySelectorAll('button')].find(b=>b.textContent==='Switch side for match 8002');
  assert.ok(sw,'resolved side can be changed');sw.click();await flush();
  const m3=d.querySelector('#draft-enemy-scouting .draft-enemy-matches');
  picks=items(m3,'.draft-enemy-match-pick').join('|');
  assert.match(picks,/Crystal Maiden.*×2/);assert.match(picks,/Axe.*×1/);assert.doesNotMatch(picks,/Anti-Mage/);
 }finally{w.close();}
});

test('practice matches persist on this device across reload',async()=>{
 const w=await boot(null,true);
 const saved=Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));w.close();
 assert.ok(saved['captain-enemy-matches-v1:practice'],'device storage key per account');
 const w2=await boot(saved,false);
 try{
  const m=w2.document.querySelector('#draft-enemy-scouting .draft-enemy-matches');
  assert.ok(m,'matches still shown');assert.match(items(m,'.draft-enemy-match-pick').join('|'),/Crystal Maiden/);
 }finally{w2.close();}
});

test('a failing match in a batch keeps the others and names the failed ID',async()=>{
 const w=await boot(null,false),d=w.document;
 try{
  d.getElementById('setup-button').click();await flush();
  d.getElementById('enemy-account-input').value='111';
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();await flush();
  d.getElementById('setup-button').click();await flush();
  d.getElementById('enemy-match-input').value='8001 8003';
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Load matches').click();await flush();
  // With Setup open, notices render inside the dialog.
  assert.match((d.querySelector('dialog[open] [data-dialog-notice]')||d.getElementById('notice')).textContent,/8003/);
  const m=d.querySelector('#draft-enemy-scouting .draft-enemy-matches');
  assert.ok(m,'loaded match still shown');assert.match(items(m,'.draft-enemy-match-pick').join('|'),/Crystal Maiden/);
  assert.ok(w.localStorage.getItem('captain-enemy-matches-v1:practice'),'loaded match saved');
 }finally{w.close();}
});

test('a team match list arriving after sign-out never reaches the device scope',async()=>{
 const draft='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';let auth,finish,asked=0;
 const backend={getSession:async()=>({user:{id:'owner'}}),onAuthChange(fn){auth=fn;},loadProfile:async()=>({displayName:'Captain',preferredRoles:[1]}),listTeams:async()=>[{id:'team',name:'Team',owner_user_id:'owner'}],loadRoster:async()=>[],
  getDraft:async()=>({id:draft,team_id:'team',revision:0,drafter_user_id:null,state:{actions:[],firstPick:true,enemyIds:[],roster:[]}}),
  listEnemyMatches:()=>{asked++;return new Promise(r=>{finish=r;});},signOut:async()=>{}};
 const dom=new JSDOM(markup,{url:'https://board.example/?draft='+draft,runScripts:'outside-only'}),w=dom.window;
 w.__backend=backend;w.fetch=async()=>({ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.__heroes=Object.fromEntries(heroes.map(h=>[h.id,h]));w.__matches={};w.__players={};
 try{
  w.eval(code);for(let i=0;i<6;i++)await flush();
  assert.ok(asked>0,'team list requested');
  auth(null,'SIGNED_OUT');for(let i=0;i<4;i++)await flush();
  finish([{match_id:9001,enemy_side:'dire',context_enemy_ids:[],summary:A,added_at:new Date().toISOString()}]);for(let i=0;i<4;i++)await flush();
  assert.equal(w.document.querySelector('#draft-enemy-scouting .draft-enemy-matches'),null);
  for(const k of Object.keys(w.localStorage).filter(k=>k.startsWith('captain-enemy-matches')))assert.doesNotMatch(w.localStorage.getItem(k),/8001|9001/);
 }finally{w.close();}
});
