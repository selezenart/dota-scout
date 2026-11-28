import test from 'node:test';
import assert from 'node:assert/strict';
import {boardCode} from './build-board.js';
import {BACKEND_STUB,dataStub,flush,boardWindow,prepareWindow} from './board-harness.js';
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
const code=await boardCode({'/web/backend.js':BACKEND_STUB,'/web/data.js':dataStub({matches:true})});
const now=1_700_000_000;
const sources={profile:{status:'updated'},recent:{status:'updated'},heroes:{status:'updated'},matches:{status:'updated'}};

const draft=()=>{let ban=100,our=140,en=[2,53,3,1,104];const o=[];
 for(const {team,action} of engine.CM_ORDER){const side=team==='A'?'our':'enemy';
  const heroId=action==='Pick'?(side==='our'?our++:en.shift()):ban++;o.push({mode:side+action,heroId});}
 return o;};
const full=JSON.stringify({state:{actions:draft(),firstPick:true,enemyIds:['111','222']},profile:{}});
const boot=async saved=>{
 const dom=boardWindow(),w=dom.window;
 prepareWindow(w);
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

test('a different practice game keeps the earlier game sightings',async()=>{
 const w=await boot();
 try{
  await pick(w,"Enemy player for Nature's Prophet",'111');await pick(w,'Enemy player for Axe','222');await save(w);
  assert.equal(count(w),2);
  const saved=Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));w.close();
  // Next game: same enemies, different draft (first ban changed).
  const next=draft();next[0]={...next[0],heroId:139};
  saved['captain-practice-v1']=JSON.stringify({state:{actions:next,firstPick:true,enemyIds:['111','222']},profile:{}});
  const w2=await boot(saved);
  try{
   const fresh=[...w2.document.querySelectorAll('#analysis .enemy-assignment select')].filter(s=>s.getAttribute('aria-label')?.startsWith('Enemy player'));
   assert.ok(fresh.every(s=>s.value===''),'new game starts with an empty form');
   await pick(w2,'Enemy player for Axe','111');await save(w2);
   // Both games kept: 222 played Axe in game 1, 111 played Axe in game 2.
   assert.equal(count(w2),3);assert.equal(seenText(w2,'Axe').length,2);
  }finally{w2.close();}
 }finally{w.close();}
});

test('the result selector has a visible label',async()=>{
 const w=await boot();
 try{
  const select=[...w.document.querySelectorAll('#analysis .enemy-assignment select')].find(s=>[...s.options].some(o=>o.value==='lost'));
  assert.ok(select.closest('label'),'wrapped in a label');assert.match(select.closest('label').textContent,/Our result/);
 }finally{w.close();}
});

test('Undo and a different last pick in the same game replace the saved entries',async()=>{
 const w=await boot();
 try{
  await pick(w,"Enemy player for Nature's Prophet",'111');await pick(w,'Enemy player for Axe','222');await save(w);
  const saved=Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));w.close();
  // Same game, last action undone and re-picked with another hero.
  const fixed=draft();fixed[23]={...fixed[23],heroId:138};
  saved['captain-practice-v1']=JSON.stringify({state:{actions:fixed,firstPick:true,enemyIds:['111','222']},profile:{}});
  const w2=await boot(saved);
  try{await pick(w2,'Enemy player for Axe','111');await pick(w2,"Enemy player for Nature's Prophet",'222');await save(w2);assert.equal(count(w2),2);}
  finally{w2.close();}
 }finally{w.close();}
});

test('correcting an enemy account after saving replaces the earlier entries for that draft',async()=>{
 const w=await boot(),d=w.document;
 try{
  await pick(w,"Enemy player for Nature's Prophet",'111');await pick(w,'Enemy player for Axe','222');await save(w);
  assert.equal(count(w),2);
  d.getElementById('setup-button').click();await flush();
  d.getElementById('enemy-account-input').value='111 333';
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();await flush();
  for(const dialog of d.querySelectorAll('dialog[open]'))dialog.close();await flush();
  await pick(w,"Enemy player for Nature's Prophet",'111');await save(w);
  assert.equal(count(w),1);assert.equal(seenText(w,'Axe').length,0);
 }finally{w.close();}
});

test('a Reset and a new game in the same window keep the earlier game',async()=>{
 const w=await boot(),d=w.document;
 try{
  await pick(w,"Enemy player for Nature's Prophet",'111');await pick(w,'Enemy player for Axe','222');await save(w);
  assert.equal(count(w),2);
  d.getElementById('reset-draft').click();await flush();
  // Play a fresh 24-action draft through the real controls.
  for(let i=0;i<24;i++){
   const card=[...d.querySelectorAll('#hero-groups [data-hero-id]')].find(b=>!b.disabled&&!b.getAttribute('aria-disabled'));
   assert.ok(card,'a hero is available at step '+i);card.click();await flush();
   const confirm=[...d.querySelectorAll('button')].find(b=>/^(Enemy )?(Pick|Ban) /.test(b.textContent)&&!b.disabled);
   assert.ok(confirm,'confirm button at step '+i);confirm.click();await flush();
  }
  const selects=[...d.querySelectorAll('#analysis .enemy-assignment select[data-hero]')];
  assert.equal(selects.length,5);
  selects[0].value='111';selects[0].dispatchEvent(new w.Event('change',{bubbles:true}));await save(w);
  assert.equal(count(w),3,'game 1 entries kept, game 2 added');
 }finally{w.close();}
});
