import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';
import * as engine from '../web/draft-engine.js';

const now=1_700_000_000;
const strongMeta={'7_pick':1000,'7_win':600};
// 1-10 meta heroes, 11 meta+signature+counter, 25 signature only, 30 counter only, 26 desired only.
const heroes=[...Array(40)].map((_,i)=>({id:i+1,localized_name:'Hero '+(i+1),roles:['Carry'],...(i<11?strongMeta:{})}));
const heroMap=Object.fromEntries(heroes.map(h=>[h.id,h]));
const ally={id:'p1',name:'Ally',signatureHeroes:[11,25],desiredHeroes:[26]};
const rows=[{hero_id:30,games_played:60,wins:24},{hero_id:11,games_played:60,wins:24}];
const matchups={50:rows,51:rows};
const opening=(n,pickIds)=>{let ban=101,our=60,en=pickIds.slice();return engine.CM_ORDER.slice(0,n).map(({team,action})=>{const side=team==='A'?'our':'enemy';
  return {mode:side+action,heroId:action==='Pick'?(side==='our'?our++:en.shift()):ban++};});};
const midDraft=opening(13,[50,51]);
const rec=(over={})=>engine.recommend({heroes:heroMap,draft:midDraft,allies:[{...ally,selfReport:ally}],matchups,firstPick:true,now,...over});

test('engine: tags team, counter and meta in that order on our pick turns',()=>{
  const by=Object.fromEntries(rec().map(r=>[r.heroId,r.tags]));
  assert.deepEqual(by[11],['team','counter','meta']);
  assert.deepEqual(by[25],['team']);
  assert.deepEqual(by[26],['team']);
  assert.deepEqual(by[30],['counter']);
  assert.deepEqual(by[1],['meta']);
  assert.deepEqual(by[35],[]);
});
test('engine: tags are empty arrays on other modes',()=>{
  const bans=engine.recommend({heroes:heroMap,draft:[],allies:[{...ally,selfReport:ally}],firstPick:true,now,mode:'enemyBan'});
  assert.ok(bans.length>0);
  for(const r of [...bans,...rec({mode:'enemyPick',opponents:[{...ally,selfReport:ally}]})])assert.deepEqual(r.tags,[]);
});
const mk=(id,tags)=>({heroId:id,score:100-id,tags});
test('diverseTop pulls a low-ranked counter hero into the top set',()=>{
  const ranked=[...Array(20)].map((_,i)=>mk(i+1,i===14?['counter']:[]));
  const out=engine.diverseTop(ranked,8,2);
  assert.ok(out.some(r=>r.heroId===15));
  assert.equal(out.length,8);
  assert.equal(new Set(out.map(r=>r.heroId)).size,8);
  assert.deepEqual(out.map(r=>r.heroId),[...out.map(r=>r.heroId)].sort((a,b)=>a-b));
});
test('diverseTop guarantees two best per tag and keeps score order',()=>{
  const ranked=[...Array(30)].map((_,i)=>mk(i+1,i===12||i===20||i===22?['counter']:i===18||i===25?['meta']:i===27?['team']:[]));
  const ids=engine.diverseTop(ranked,8,2).map(r=>r.heroId);
  for(const id of [13,21,19,26,28])assert.ok(ids.includes(id),'includes '+id);
  assert.ok(!ids.includes(23));
  assert.ok(ids.length<=8);
  assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));
});
test('diverseTop returns everything when ranked is shorter than the limit, and handles empty',()=>{
  const ranked=[mk(1,[]),mk(2,['counter']),mk(3,[])];
  assert.deepEqual(engine.diverseTop(ranked,8,2).map(r=>r.heroId),[1,2,3]);
  assert.deepEqual(engine.diverseTop([],8,2),[]);
});

const built=await build({logLevel:'silent',plugins:[{name:'flow-boundaries',enforce:'pre',load(id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(path.endsWith('/web/data.js'))return `export const publicData={request:async path=>{const m=/^\\/heroes\\/(\\d+)\\/matchups/.exec(path);return m?(globalThis.__matchups[m[1]]||[]):[];}};export const loadHeroes=async()=>globalThis.__heroes;export const loadPlayer=async(id,progress)=>{const p={id,name:id,heroes:[],recent:[],matches:[],sources:{}};progress(p);return p;};`;
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const markup=await readFile('web/index.html','utf8');
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const boot=async(actions,firstPick=true)=>{
 const dom=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{actions,firstPick,enemyIds:[],roster:[ally]},profile:{}}));
 w.__heroes=heroMap;w.__matchups=matchups;
 w.eval(code);await flush();await flush();return w;
};
const rowOf=(w,name)=>[...w.document.querySelectorAll('#suggestions .rec-row')].find(r=>r.querySelector('strong').textContent===name);
const badges=r=>[...r.querySelectorAll('.rec-badge')].map(b=>b.textContent);

test('UI: precondition - counter hero 30 is outside the plain top 8',()=>{
  assert.ok(!rec().slice(0,8).some(r=>r.heroId===30));
});
test('UI: rows carry tag badges and classes; low-ranked counter hero still shows',async()=>{
  const w=await boot(midDraft);
  try{
    const counter=rowOf(w,'Hero 30');assert.ok(counter,'counter hero visible');
    assert.deepEqual(badges(counter),['Counter']);
    assert.ok(counter.classList.contains('rec-tag-counter'));
    assert.ok(counter.querySelector('span.rec-badge.rec-badge-counter'));
    const team=rowOf(w,'Hero 25');assert.deepEqual(badges(team),['Team']);
    assert.ok(team.classList.contains('rec-tag-team')&&!team.classList.contains('rec-all-three'));
    const meta=rowOf(w,'Hero 1');assert.deepEqual(badges(meta),['Meta']);
    assert.ok(meta.classList.contains('rec-tag-meta'));
    assert.ok(meta.querySelector('.rec-badge-meta'));
    assert.equal(w.document.querySelectorAll('#suggestions .rec-row').length,8);
  }finally{w.close();}
});
test('UI: a hero with all three tags gets All three first',async()=>{
  const w=await boot(midDraft);
  try{
    const all=rowOf(w,'Hero 11');assert.ok(all,'hero 11 visible');
    assert.ok(all.classList.contains('rec-all-three'));
    for(const t of ['team','counter','meta'])assert.ok(all.classList.contains('rec-tag-'+t));
    assert.deepEqual(badges(all),['All three','Team','Counter','Meta']);
    assert.ok(all.querySelector('.rec-badge-all'));
  }finally{w.close();}
});
test('UI: legend lists four labels on our pick turns',async()=>{
  const w=await boot(midDraft);
  try{
    const legend=w.document.querySelector('.decision-panel .rec-legend');assert.ok(legend,'legend exists');
    const t=legend.textContent;for(const l of ['Team','Counter','Meta','All three'])assert.ok(t.includes(l),l);
  }finally{w.close();}
});
test('UI: ban turns have no badges and no legend',async()=>{
  const w=await boot([],false);
  try{
    assert.ok(w.document.querySelectorAll('#suggestions .rec-row').length>0,'ban suggestions render');
    assert.equal(w.document.querySelectorAll('.rec-badge').length,0);
    assert.equal(w.document.querySelector('.rec-legend'),null);
  }finally{w.close();}
});
