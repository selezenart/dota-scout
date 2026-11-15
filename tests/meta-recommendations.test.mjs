import {test} from 'node:test';
import assert from 'node:assert/strict';
import {heroMeta,metaTotals,recommend} from '../web/draft-engine.js';
const now = 1700000000;
const strong = {id:2,roles:['Carry'],'7_pick':150,'8_pick':100,'7_win':80,'8_win':52,pro_pick:10,pro_ban:20,pro_win:6};
const weak = {id:3,roles:['Carry'],'7_pick':150,'8_pick':100,'7_win':70,'8_win':50};
const plain = {id:1,roles:['Carry']};
const pool = [plain,strong,weak];
const round2 = x => Math.round(x*100)/100;

test('metaTotals sums Divine+ picks and pro picks, missing fields are 0',()=>{
  assert.deepEqual(metaTotals([{'7_pick':100,'8_pick':50,pro_pick:3},{'7_pick':10,pro_pick:2},{}]),{high:160,pro:5});
  assert.deepEqual(metaTotals([]),{high:0,pro:0});
});
test('heroMeta computes rates and score from Divine+ and pro data',()=>{
  assert.deepEqual(heroMeta(strong,{high:50000,pro:1000}),
    {winRate:52.8,pickRate:5,proPicks:10,proBans:20,proWinRate:60,score:7.2});
});
test('heroMeta is null below both thresholds',()=>{
  assert.equal(heroMeta({'7_pick':100,'8_pick':99,pro_pick:2,pro_ban:2},{high:1000,pro:1000}),null);
  assert.equal(heroMeta({},{high:1000,pro:1000}),null);
});
test('heroMeta boundary: 200 Divine+ games alone is enough, without pro data',()=>{
  const m = heroMeta({'8_pick':200,'8_win':100},{high:20000,pro:0});
  assert.deepEqual(m,{winRate:50,pickRate:10,proPicks:0,proBans:0,proWinRate:null,score:4});
});
test('heroMeta boundary: 5 pro picks+bans alone is enough, but win rates need samples',()=>{
  const m = heroMeta({'7_pick':199,pro_pick:3,pro_ban:2,pro_win:3},{high:1000,pro:1000});
  assert.deepEqual(m,{winRate:null,pickRate:null,proPicks:3,proBans:2,proWinRate:null,score:0.4});
});
test('heroMeta tolerates missing pro fields and totals',()=>{
  assert.deepEqual(heroMeta({pro_pick:5,pro_win:3},{high:0,pro:1000}),
    {winRate:null,pickRate:null,proPicks:5,proBans:0,proWinRate:60,score:0.4});
  assert.equal(heroMeta({pro_pick:5,pro_win:3},{high:0,pro:0}).score,0);
});
test('heroMeta score clamps at 12 and -4',()=>{
  assert.equal(heroMeta({'7_pick':1000,'7_win':800,pro_pick:100,pro_ban:100},{high:10000,pro:1000}).score,12);
  assert.equal(heroMeta({'7_pick':1000,'7_win':300},{high:0,pro:0}).score,-4);
});

const pickRec = (heroes,extra={}) => recommend({heroes,now,mode:'ourPick',...extra});
test('pick turn: meta component equals heroMeta score, 0 without data',()=>{
  const totals = metaTotals(pool), rec = pickRec(pool);
  assert.equal(rec.length,3);
  assert.equal(rec.find(r=>r.heroId===2).components.meta,heroMeta(strong,totals).score);
  assert.equal(rec.find(r=>r.heroId===3).components.meta,heroMeta(weak,totals).score);
  assert.equal(rec.find(r=>r.heroId===1).components.meta,0);
  assert.ok(!rec.find(r=>r.heroId===1).reasons.some(x=>x.startsWith('Meta: ')));
});
test('pick turn: reason text and detail entry',()=>{
  const rec = pickRec(pool), r = rec.find(r=>r.heroId===2), totals = metaTotals(pool), m = heroMeta(strong,totals);
  assert.ok(r.reasons.includes(`Meta: ${m.winRate}% win in Divine+ (${m.pickRate}% of games), pro 10 picks / 20 bans`));
  const d = r.details.filter(x=>x.category==='meta');
  assert.equal(d.length,1);
  assert.equal(d[0].contribution,r.components.meta);
  assert.equal(d[0].source,'OpenDota hero stats (Divine+ and pro)');
  const none = rec.find(r=>r.heroId===1).details.find(x=>x.category==='meta');
  assert.deepEqual([none.contribution,none.source],[0,null]);
});
test('reason omits absent parts',()=>{
  const proOnly = {id:4,roles:['Carry'],pro_pick:38,pro_ban:61,pro_win:20};
  const winOnly = {id:5,roles:['Carry'],'7_pick':200,'7_win':107};
  const rec = pickRec([plain,proOnly,winOnly]);
  assert.ok(rec.find(r=>r.heroId===4).reasons.includes('Meta: pro 38 picks / 61 bans'));
  const win = rec.find(r=>r.heroId===5).reasons.find(x=>x.startsWith('Meta: '));
  assert.match(win,/^Meta: 53\.5% win in Divine\+ \(\d+(\.\d)?% of games\)$/);
});
test('higher meta score ranks first when everything else is equal',()=>{
  const rec = pickRec([{id:1,roles:['Carry']},{id:2,roles:['Carry'],'7_pick':1000,'7_win':560},{id:3,roles:['Carry'],'7_pick':1000,'7_win':400}]);
  assert.deepEqual(rec.map(r=>r.heroId),[2,1,3]);
});
test('ban turns ignore meta',()=>{
  const heroes = [{...strong,id:2},{...weak,id:3}];
  const allies = [{id:1,selfReport:{signatureHeroes:[2]}}];
  const opponents = [{id:9,heroes:[{hero_id:2,games:100,last_played:now-3600}]}];
  for (const [mode,extra] of [['enemyBan',{allies}],['ourBan',{opponents}]]) {
    const rec = recommend({heroes,now,mode,...extra}), r = rec.find(r=>r.heroId===2);
    assert.ok(r,mode);
    assert.equal(r.components.meta,0);
    assert.ok(!rec.some(x=>x.reasons.some(t=>t.startsWith('Meta: '))));
    assert.equal(r.details.find(d=>d.category==='meta').contribution,0);
  }
});
