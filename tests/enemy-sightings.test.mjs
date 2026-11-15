import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';
import * as engine from '../web/draft-engine.js';
import * as data from '../web/data.js';

const fakeFetch=(body,log=[])=>async url=>{log.push(url);return {ok:true,status:200,json:async()=>body};};
const store=()=>{const m=new Map();return {m,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};

// engine
test('enemySightings aggregates one account and ignores others',()=>{
 const r=(accountId,heroId,enemyWon,sourceKey,seenAt=1)=>({accountId,heroId,enemyWon,sourceKey,seenAt});
 const rows=[r('111',2,true,'a'),r('111',2,false,'b'),r('111',53,true,'c'),r('111',5,null,'d'),r('111',3,true,'e'),r('222',9,true,'a')];
 assert.deepEqual(engine.enemySightings(rows,'111'),[{heroId:2,games:2,wins:1},{heroId:3,games:1,wins:1},{heroId:53,games:1,wins:1},{heroId:5,games:1,wins:0}]);
 assert.deepEqual(engine.enemySightings(rows,'999'),[]);
});

// UI
const heroes=[...[[1,'Anti-Mage'],[2,'Axe'],[3,'Crystal Maiden'],[53,"Nature's Prophet"]].map(([id,n])=>({id,localized_name:n,roles:['Carry']})),...Array.from({length:40},(_,i)=>({id:100+i,localized_name:'Hero '+(100+i),roles:['Carry']}))];
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

const draft=()=>{let ban=100,our=140,en=[2,53,3,1,104];const o=[];
 for(const {team,action} of engine.CM_ORDER){const side=team==='A'?'our':'enemy';
  const heroId=action==='Pick'?(side==='our'?our++:en.shift()):ban++;o.push({mode:side+action,heroId});}
 return o;};
const full=JSON.stringify({state:{actions:draft(),firstPick:true,enemyIds:['111','222']},profile:{}});
const boot=async saved=>{
 const dom=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const [k,v] of Object.entries(saved||{'captain-practice-v1':full}))w.localStorage.setItem(k,v);
 w.__heroes=Object.fromEntries(heroes.map(h=>[h.id,h]));w.__matches={};
 w.__players={111:{id:'111',name:'Foe',sources,heroes:[{hero_id:1,games:3,win:1,last_played:now}],recent:[],matches:[]},222:{id:'222',name:'Shut',sources,heroes:[],recent:[],matches:[]}};
 w.eval(code);await flush();return w;
};
const KEY='captain-enemy-sightings-v1:practice';
const count=w=>{const v=JSON.parse(w.localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v.length:Object.keys(v).length;};
const pick=async(w,label,value)=>{const s=[...w.document.querySelectorAll('#analysis .enemy-assignment select')].find(x=>x.getAttribute('aria-label')===label);s.value=value;s.dispatchEvent(new w.Event('change',{bubbles:true}));await flush();};
const save=async w=>{[...w.document.querySelectorAll('#analysis button')].find(b=>b.textContent==='Save who played what').click();await flush();};
const seenText=(w,name)=>[...w.document.querySelectorAll('#draft-enemy-scouting .draft-enemy-seen')].map(x=>x.textContent).filter(t=>t.includes(name));

test('draft review offers who-played-what selectors per enemy pick',async()=>{
 const w=await boot(),d=w.document;
 try{
  const a=d.querySelector('#analysis .enemy-assignment');assert.ok(a,'.enemy-assignment');assert.equal(a.querySelector('h3').textContent,'Who played what?');
  const sel=[...a.querySelectorAll('select')].map(s=>s.getAttribute('aria-label'));
  assert.equal(sel.filter(l=>/^Enemy player for /.test(l)).length,5);assert.ok(sel.includes("Enemy player for Nature's Prophet"));
  const ps=a.querySelector('select[aria-label="Enemy player for Axe"]');
  assert.deepEqual([...ps.options].map(o=>o.value),['','111','222']);assert.equal(ps.options[0].textContent,'Unknown');
  assert.deepEqual([...a.querySelector('select[aria-label="Our result"]').options].map(o=>o.value),['','won','lost']);
  assert.ok([...a.querySelectorAll('button')].some(b=>b.textContent==='Save who played what'));
 }finally{w.close();}
});
test('saving assignments stores sightings and shows Seen vs us for open and closed accounts, across reload',async()=>{
 const w=await boot(),d=w.document;
 try{
  await pick(w,"Enemy player for Nature's Prophet",'111');await pick(w,'Enemy player for Axe','222');await pick(w,'Our result','lost');await save(w);
  assert.equal(count(w),2);assert.match(d.getElementById('notice').textContent+(d.querySelector('dialog[open]')?.textContent||''),/Saved who played what\./);
  assert.deepEqual(seenText(w,'Axe'),['Seen vs us: Axe ×1 (1W)']);assert.deepEqual(seenText(w,"Nature's"),["Seen vs us: Nature's Prophet ×1 (1W)"]);
  const closed=[...d.querySelectorAll('#draft-enemy-scouting .draft-enemy-meta')].find(m=>m.textContent==='Closed account');assert.ok(closed,'closed meta kept');
  assert.ok(closed.parentElement.querySelector('.draft-enemy-seen'),'seen in the closed row');
  const saved=Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));w.close();
  const w2=await boot(saved);
  try{assert.deepEqual(seenText(w2,'Axe'),['Seen vs us: Axe ×1 (1W)']);}finally{w2.close();}
 }finally{w.close();}
});
test('the same account for two heroes is rejected and nothing is saved',async()=>{
 const w=await boot(),d=w.document;
 try{
  await pick(w,"Enemy player for Nature's Prophet",'111');await pick(w,'Enemy player for Axe','111');await save(w);
  assert.match(d.getElementById('notice').textContent+(d.querySelector('dialog[open]')?.textContent||''),/once/);assert.equal(count(w),0);
 }finally{w.close();}
});
test('re-saving the same draft replaces its earlier sightings',async()=>{
 const w=await boot(),d=w.document;
 try{
  await pick(w,"Enemy player for Nature's Prophet",'111');await pick(w,'Enemy player for Axe','222');await pick(w,'Our result','lost');await save(w);
  await pick(w,"Enemy player for Nature's Prophet",'');await pick(w,'Enemy player for Axe','111');await save(w);
  assert.equal(count(w),1);assert.deepEqual(seenText(w,'Axe'),['Seen vs us: Axe ×1 (1W)']);
  assert.equal(d.querySelectorAll('#draft-enemy-scouting .draft-enemy-seen').length,1);
 }finally{w.close();}
});
