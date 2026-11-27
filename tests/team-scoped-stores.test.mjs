import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';

// Enemy Battle Cup matches and enemy sightings are each kept per team in a team
// draft and per account on this device otherwise. These flows pin that isolation.
const heroes=[[1,'Anti-Mage'],[2,'Axe'],[3,'Crystal Maiden'],[53,"Nature's Prophet"]].map(([id,n])=>({id,localized_name:n,roles:['Carry']}));
const built=await build({logLevel:'silent',plugins:[{name:'flow-boundaries',enforce:'pre',load(id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(path.endsWith('/web/data.js'))return `export const publicData={request:async()=>[]};export const loadHeroes=async()=>globalThis.__heroes;export const loadPlayer=async(id,progress)=>{const p=globalThis.__players[id];progress(p);return p;};export const loadMatch=async id=>globalThis.__matches[id];export const parseMatchIds=t=>[...new Set(String(t).split(/[\\s,]+/).filter(Boolean))];export const summarizeMatch=x=>x;`;
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const markup=await readFile('web/index.html','utf8');
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const settle=async(n=6)=>{for(let i=0;i<n;i++)await flush();};
const now=Date.now();
const sources={profile:{status:'updated'},recent:{status:'updated'},heroes:{status:'updated'},matches:{status:'updated'}};
const P=(accountId,heroId,isRadiant,name)=>({accountId,heroId,isRadiant,name});
const match=id=>({matchId:id,startTime:Math.floor(now/1000)-3600,lobbyType:9,radiantWin:true,players:[P(null,1,true),P(null,2,true),P('111',3,false,'Foe'),P(null,53,false)],picksBans:[]});
const draftId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deviceMatch=id=>JSON.stringify([{matchId:id,summary:match(id),enemySide:'dire',contextIds:['111'],addedAt:now}]);
const deviceSighting=heroId=>JSON.stringify([{accountId:'111',heroId,enemyWon:true,sourceKey:'draft:practice:x',seenAt:now}]);
const teamMatchRow=id=>({match_id:id,enemy_side:'dire',context_enemy_ids:['111'],summary:match(String(id)),added_at:new Date(now).toISOString()});
const teamSightingRow=heroId=>({account_id:111,hero_id:heroId,enemy_won:true,source_key:'draft:team:x',seen_at:new Date(now).toISOString()});

function setup(w,saved){
 w.fetch=async()=>({ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const [k,v] of Object.entries(saved||{}))w.localStorage.setItem(k,v);
 w.__heroes=Object.fromEntries(heroes.map(h=>[h.id,h]));w.__matches={};
 w.__players={111:{id:'111',name:'Foe',sources,heroes:[],recent:[],matches:[]}};
}
async function teamBoard({saved,...extra}){
 let auth;
 const backend={getSession:async()=>({user:{id:'owner'}}),onAuthChange(fn){auth=fn;},loadProfile:async()=>({displayName:'Captain',preferredRoles:[1]}),
  listTeams:async()=>[{id:'team',name:'Team',owner_user_id:'owner'}],loadRoster:async()=>[],
  getDraft:async()=>({id:draftId,team_id:'team',revision:0,drafter_user_id:null,state:{actions:[],firstPick:true,enemyIds:['111'],roster:[]}}),
  signOut:async()=>{},...extra};
 const w=new JSDOM(markup,{url:'https://board.example/?draft='+draftId,runScripts:'outside-only'}).window;
 w.__backend=backend;setup(w,saved);w.eval(code);await settle();
 return {w,auth:(...a)=>auth(...a)};
}
async function practiceBoard(saved){
 const w=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}).window;
 setup(w,{'captain-practice-v1':JSON.stringify({state:{actions:[],firstPick:true,enemyIds:['111']},profile:{}}),...saved});w.eval(code);await settle();return w;
}
const report=w=>w.document.querySelector('#draft-enemy-scouting .draft-enemy-matches');
const seen=w=>[...w.document.querySelectorAll('#draft-enemy-scouting .draft-enemy-seen')].map(x=>x.textContent).join('|');
const notices=w=>[...w.document.querySelectorAll('#notice,[data-dialog-notice]')].map(n=>n.textContent).join('|');
const deviceKeys=w=>Object.keys(w.localStorage).filter(k=>k.startsWith('captain-enemy-'));

test('device scouting of another account never shows in practice',async()=>{
 const w=await practiceBoard({'captain-enemy-matches-v1:other':deviceMatch('8001'),'captain-enemy-sightings-v1:other':deviceSighting(2)});
 try{assert.equal(report(w),null);assert.doesNotMatch(seen(w),/Axe/);}finally{w.close();}
 const own=await practiceBoard({'captain-enemy-matches-v1:practice':deviceMatch('8001'),'captain-enemy-sightings-v1:practice':deviceSighting(2)});
 try{assert.ok(report(own),'own device matches shown');assert.match(seen(own),/Seen vs us: Axe ×1/);}finally{own.close();}
});

test('a team draft shows only the team lists and never writes them to the device',async()=>{
 const saved={'captain-enemy-matches-v1:owner':deviceMatch('7001'),'captain-enemy-sightings-v1:owner':deviceSighting(3)};
 const asked=[];
 const {w}=await teamBoard({saved,listEnemyMatches:async t=>{asked.push(['m',t]);return [teamMatchRow(9001)];},listEnemySightings:async t=>{asked.push(['s',t]);return [teamSightingRow(2)];}});
 try{
  assert.deepEqual(asked.map(a=>a[1]),asked.map(()=>'team'));assert.ok(asked.some(a=>a[0]==='m')&&asked.some(a=>a[0]==='s'));
  assert.ok(report(w),'team matches shown');assert.match(seen(w),/Axe/);assert.doesNotMatch(seen(w),/Crystal Maiden/);
  assert.equal(w.localStorage.getItem('captain-enemy-matches-v1:owner'),saved['captain-enemy-matches-v1:owner']);
  assert.equal(w.localStorage.getItem('captain-enemy-sightings-v1:owner'),saved['captain-enemy-sightings-v1:owner']);
  for(const k of deviceKeys(w))assert.doesNotMatch(w.localStorage.getItem(k),/9001|draft:team/);
 }finally{w.close();}
});

test('without the team storage functions both lists fall back to this account on the device',async()=>{
 const missing=async()=>{throw Object.assign(Error('Could not find the function'),{code:'PGRST202'});};
 const saved={'captain-enemy-matches-v1:owner':deviceMatch('7001'),'captain-enemy-sightings-v1:owner':deviceSighting(3),'captain-enemy-sightings-v1:practice':deviceSighting(2)};
 const {w}=await teamBoard({saved,listEnemyMatches:missing,listEnemySightings:missing});
 try{
  assert.ok(report(w),'device matches of this account shown');
  assert.match(seen(w),/Crystal Maiden/);assert.doesNotMatch(seen(w),/Axe/);
  assert.match(notices(w),/Team match storage is not set up yet/);
 }finally{w.close();}
});

test('a failed team load reports each list and shows no rows',async()=>{
 const boom=async()=>{throw Error('boom');};
 const {w}=await teamBoard({saved:{'captain-enemy-matches-v1:owner':deviceMatch('7001'),'captain-enemy-sightings-v1:owner':deviceSighting(3)},listEnemyMatches:boom,listEnemySightings:boom});
 try{
  assert.equal(report(w),null);assert.doesNotMatch(seen(w),/Crystal Maiden/);
  const text=notices(w);assert.match(text,/Could not load team Battle Cup matches: boom|Could not load the team scouting list: boom/);
 }finally{w.close();}
});

test('a team sightings list arriving after sign-out never reaches the device scope',async()=>{
 let finish,asked=0;
 const {w,auth}=await teamBoard({listEnemyMatches:async()=>[],listEnemySightings:()=>{asked++;return new Promise(r=>{finish=r;});}});
 try{
  assert.ok(asked>0,'team list requested');
  auth(null,'SIGNED_OUT');await settle(4);
  finish([teamSightingRow(2)]);await settle(4);
  assert.doesNotMatch(seen(w),/Axe/);
  for(const k of deviceKeys(w))assert.doesNotMatch(w.localStorage.getItem(k),/draft:team/);
 }finally{w.close();}
});
