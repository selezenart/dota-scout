import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {heroMeta,metaTotals,recommend} from '../web/draft-engine.js';
import {buildBoard} from './build-board.js';

const now = 1700000000;
const mk = (id,p,w) => ({id,roles:['Carry'],'8_pick':p,'8_win':w});
// meta scores with metaTotals(pool): 1 -> 1.66, 2 -> 1.16, 3 -> 0.16, 4 -> -1.34, 6 -> -0.75, 5 has no meta data
const pool = [mk(1,1000,540),mk(2,1000,520),mk(3,1000,500),mk(4,1000,470),{id:5,roles:['Carry']},mk(6,300,150)];
const bare = pool.map(({id,roles})=>({id,roles}));
const ids = list => list.map(r=>r.heroId);
const ban = (mode,extra={}) => recommend({heroes:pool,mode,now,...extra});
const row = (h,m,w,s) => ({h,m,w,s});

test('fixture sanity: meta scores',()=>{
  const t = metaTotals(pool), s = id => heroMeta(pool.find(h=>h.id===id),t)?.score;
  assert.deepEqual([1,2,3,4,5,6].map(s),[1.66,1.16,0.16,-1.34,undefined,-0.75]);
});
for (const mode of ['ourBan','enemyBan']) {
  test(`first ${mode} with no enemy data suggests only meta heroes (score >= 1)`,()=>{
    const out = ban(mode);
    assert.deepEqual(ids(out),[1,2]);
    for (const r of out) {
      assert.equal(r.playerId,null);
      assert.equal(r.playerName,null);
      assert.equal(r.components.meta,heroMeta(pool.find(h=>h.id===r.heroId),metaTotals(pool)).score);
      assert.equal(r.reasons.length,1);
      assert.ok(r.reasons[0].startsWith('Meta: '),r.reasons[0]);
    }
  });
}
test('a hero with meta score below 1 is not suggested as a ban',()=>{
  const out = ban('ourBan');
  for (const id of [3,4,5,6]) assert.ok(!ids(out).includes(id),`hero ${id}`);
});
test('without meta data in heroStats, ban turns still return nothing',()=>{
  assert.deepEqual(recommend({heroes:bare,mode:'ourBan',now}),[]);
  assert.deepEqual(recommend({heroes:bare,mode:'enemyBan',now}),[]);
});
test('enemy-player evidence outranks meta-only bans',()=>{
  const allies = [{id:1,selfReport:{signatureHeroes:[3]}}];
  const out = ban('enemyBan',{allies});
  assert.equal(out[0].heroId,3);
  assert.equal(out[0].components.signature,20);
  assert.ok(out[0].score > out.find(r=>r.heroId===1).score);
  assert.ok(ids(out).includes(1) && ids(out).includes(2));
});
test('ban after picks combines STRATZ counter and meta; STRATZ-only heroes stay',()=>{
  const draft = [{mode:'ourPick',heroId:5}];
  const stratz = {5:{heroId:5,vs:[row(1,100,0.3,-8),row(3,100,0.3,-8)],with:[]}};
  const out = ban('ourBan',{draft,stratz});
  const h1 = out.find(r=>r.heroId===1), h3 = out.find(r=>r.heroId===3), h2 = out.find(r=>r.heroId===2);
  assert.ok(h1 && h3 && h2,'1 (stratz+meta), 3 (stratz only), 2 (meta only)');
  assert.ok(h1.components.stratzCounter>=2 && h1.components.meta===1.66);
  const iCounter = h1.reasons.findIndex(r=>r.startsWith('Counters ')), iMeta = h1.reasons.findIndex(r=>r.startsWith('Meta: '));
  assert.ok(iCounter>=0 && iMeta>iCounter,'meta reason comes after STRATZ reasons');
  assert.equal(h3.components.meta,0.16);
  assert.ok(!h3.reasons.some(r=>r.startsWith('Meta: ')),'meta 0.16 < 1 adds no Meta reason');
  assert.equal(h1.playerId,null);
  assert.ok(!ids(out).includes(4) && !ids(out).includes(6));
});
test('a meta-only ban is dropped when STRATZ says it is weak vs our picks (total score <= 0)',()=>{
  const draft = [{mode:'ourPick',heroId:5}];
  const neutral = {5:{heroId:5,vs:[],with:[]}};
  const weakVs = {5:{heroId:5,vs:[row(2,100,0.6,6)],with:[]}};
  const kept = ban('ourBan',{draft,stratz:neutral}).find(r=>r.heroId===2);
  assert.ok(kept && kept.score>0,'meta-only hero 2 (1.16) is suggested with neutral STRATZ');
  const out = ban('ourBan',{draft,stratz:weakVs});
  assert.ok(!ids(out).includes(2),'stratzCounter -3 pushes total below 0, so it is dropped');
  assert.ok(ids(out).includes(1),'the stronger meta hero stays');
});
test('pick ranking is unchanged by the ban-meta change',()=>{
  const out = recommend({heroes:pool,mode:'ourPick',now});
  assert.deepEqual(out.slice(0,3).map(r=>[r.heroId,r.score]),[[1,7.66],[2,7.16],[3,6.16]]);
  assert.equal(out.length,6);
});

// ---- board ----
const boardBuilt = await buildBoard({logLevel:'silent',plugins:[{name:'ban-boundaries',enforce:'pre',load(id){
  const p = id.replaceAll('\\','/');
  if (p.endsWith('/web/backend.js')) return 'export const createBackend=()=>globalThis.__backend;';
  if (p.endsWith('/web/data.js')) return 'export const publicData={request:async()=>[]};export const loadHeroes=async()=>globalThis.__heroes;export const loadPlayer=async id=>({id:String(id),name:String(id),sources:{},heroes:[],recent:[],matches:[]});export const loadStratz=async id=>({heroId:+id,vs:[],with:[]});';
}}],build:{write:false,minify:false}});
const boardCode = boardBuilt.output.find(o=>o.type==='chunk'&&o.isEntry).code, boardMarkup = await readFile('web/index.html','utf8');
const settle = async()=>{for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,0));await new Promise(r=>setImmediate(r));}};
test('board: the first ban of a fresh practice draft shows meta suggestions',async()=>{
  const w = new JSDOM(boardMarkup,{url:'https://board.example/?practice',runScripts:'outside-only'}).window;
  w.fetch = async()=>({ok:true,json:async()=>({})});w.setInterval = ()=>0;w.confirm = ()=>true;
  w.HTMLDialogElement.prototype.showModal = function(){this.open=true;};w.HTMLDialogElement.prototype.close = function(){this.open=false;};
  const real = JSON.parse(await readFile('web/heroes.json','utf8'));
  w.__heroes = Object.fromEntries(Object.entries(real).map(([k,h],i)=>[k,i<3?{...h,'8_pick':1000,'8_win':540}:{...h,'8_pick':1000,'8_win':495}]));
  try {
    w.eval(boardCode);await settle();
    const doc = w.document;
    assert.ok(doc.querySelectorAll('.decision-candidates .rec-row').length>0,'ban suggestions are listed');
    assert.ok(!doc.body.textContent.includes('No evidence-backed recommendations'));
  } finally { w.close(); }
});
