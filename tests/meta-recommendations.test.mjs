import {test} from 'node:test';
import assert from 'node:assert/strict';
import {heroMeta,metaTotals,recommend} from '../web/draft-engine.js';
const now = 1700000000;
const strong = {id:2,roles:['Carry'],'7_pick':150,'8_pick':100,'7_win':80,'8_win':52,pro_pick:10,pro_ban:20,pro_win:6};
const weak = {id:3,roles:['Carry'],'7_pick':150,'8_pick':100,'7_win':70,'8_win':50};
const plain = {id:1,roles:['Carry']};
const pool = [plain,strong,weak];
const round2 = x => Math.round(x*100)/100;

test('metaTotals sums Divine+ picks, pro picks and counts heroes with Divine+ picks',()=>{
  assert.deepEqual(metaTotals([{'7_pick':100,'8_pick':50,pro_pick:3},{'7_pick':10,pro_pick:2},{pro_pick:4}]),{high:160,pro:9,heroes:2});
  assert.deepEqual(metaTotals([]),{high:0,pro:0,heroes:0});
});
// strong: 250 picks, 132 wins -> 52.8% win; pickRate 100*250*10/50000 = 5; avg = 1000/100 = 10
// winPart (52.8-50)*.5 = 1.4; pickPart .75*log2(5/10) = -.75; pro: 30 of 100 games -> min(1,.6) * min(1,100/300) = .2; 1.4-.75+.2 = .85
test('heroMeta computes rates and score from Divine+ and pro data',()=>{
  assert.deepEqual(heroMeta(strong,{high:50000,pro:1000,heroes:100}),
    {winRate:52.8,pickRate:5,proPicks:10,proBans:20,proWinRate:60,score:0.85});
});
test('heroMeta is null below both thresholds',()=>{
  assert.equal(heroMeta({'7_pick':100,'8_pick':99,pro_pick:2,pro_ban:2},{high:1000,pro:1000,heroes:10}),null);
  assert.equal(heroMeta({},{high:1000,pro:1000,heroes:10}),null);
});
// pickRate 100*200*10/40000 = 5 vs avg 10 -> .75*log2(.5) = -.75; winRate 50 -> 0; no pro
test('heroMeta: pick rate below the average gives a negative pick part',()=>{
  const m = heroMeta({'8_pick':200,'8_win':100},{high:40000,pro:0,heroes:100});
  assert.deepEqual(m,{winRate:50,pickRate:5,proPicks:0,proBans:0,proWinRate:null,score:-0.75});
});
// pickRate 100*200*10/10000 = 20 vs avg 10 -> .75*log2(2) = .75
test('heroMeta: pick rate above the average gives a positive pick part',()=>{
  assert.equal(heroMeta({'8_pick':200,'8_win':100},{high:10000,pro:0,heroes:100}).score,0.75);
});
test('heroMeta: pick part is 0 without a hero count',()=>{
  assert.deepEqual(heroMeta({'8_pick':200,'8_win':100},{high:20000,pro:0,heroes:0}),
    {winRate:50,pickRate:10,proPicks:0,proBans:0,proWinRate:null,score:0});
});
// 5 pro picks+bans, 100 pro games: min(1,2*5/100)=.1, damping 100/300 -> .0333 -> .03
test('heroMeta boundary: 5 pro picks+bans alone is enough, but win rates need samples',()=>{
  const m = heroMeta({'7_pick':199,pro_pick:3,pro_ban:2,pro_win:3},{high:1000,pro:1000,heroes:10});
  assert.deepEqual(m,{winRate:null,pickRate:null,proPicks:3,proBans:2,proWinRate:null,score:0.03});
});
// 50 pro picks+bans of 100 games: min(1,2*50/100)=1, small-sample damping 100/300 -> .33
test('heroMeta damps the pro part for small pro samples',()=>{
  assert.equal(heroMeta({pro_pick:10,pro_ban:40},{high:0,pro:1000,heroes:0}).score,0.33);
  assert.equal(heroMeta({pro_pick:5,pro_win:3},{high:0,pro:0,heroes:0}).score,0);
});
// 1000 picks, 600 wins: win part clamps 1.5; pickRate 100 vs avg 10 -> clamps 1; 200 of 300 pro games -> 1*1 = 1; 3.5 -> 3
// 200 picks, 60 wins: win -1.5; pickRate .2 vs avg 10 -> clamps -.75; -2.25 -> -1.5
test('heroMeta score clamps at 3 and -1.5',()=>{
  assert.equal(heroMeta({'7_pick':1000,'7_win':600,pro_pick:100,pro_ban:100},{high:10000,pro:3000,heroes:100}).score,3);
  assert.equal(heroMeta({'7_pick':200,'7_win':60},{high:1000000,pro:0,heroes:100}).score,-1.5);
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
test('ban turns add meta but evidence still leads',()=>{
  const weakBan = {id:3,roles:['Carry'],'7_pick':200,'7_win':80};
  const heroes = [{...strong,id:2},weakBan];
  const totals = metaTotals(heroes);
  assert.ok(heroMeta(weakBan,totals).score < 1);
  const allies = [{id:1,selfReport:{signatureHeroes:[2]}}];
  const opponents = [{id:9,heroes:[{hero_id:2,games:100,last_played:now-3600}]}];
  for (const [mode,extra] of [['enemyBan',{allies}],['ourBan',{opponents}]]) {
    const rec = recommend({heroes,now,mode,...extra}), r = rec.find(r=>r.heroId===2);
    assert.equal(rec[0].heroId,2,mode);
    assert.equal(r.components.meta,heroMeta(heroes[0],totals).score);
    assert.ok(r.reasons.some(t=>t.startsWith('Meta: ')));
    assert.ok(!rec.some(x=>x.heroId===3),'weak-meta hero without evidence is not suggested');
  }
});

// Pool with realistic totals: 100 small fillers, one huge Divine+ filler and one pro-heavy filler.
const fillers = [{id:9,roles:['Carry'],'7_pick':100000},{id:8,roles:['Carry'],'7_pick':90,pro_pick:2900},
  ...Array.from({length:100},(_,i)=>({id:100+i,roles:['Carry'],'7_pick':90}))];
// worst: 30% win → -1.5; 300 picks is ~2.6% of games vs ~9.6% average → -0.75; clamp → -1.5
const worst = {id:2,roles:['Carry'],'7_pick':300,'7_win':90}, best = {id:3,roles:['Carry'],'7_pick':3000,'7_win':1800,pro_pick:100,pro_ban:100};
const rankPool = [worst,best,...fillers], rankTotals = metaTotals(rankPool);
const metaOf = (rec,id) => rec.find(r=>r.heroId===id);
test('fixtures: worst meta is -1.5 and best meta is 3',()=>{
  assert.equal(heroMeta(worst,rankTotals).score,-1.5);
  assert.equal(heroMeta(best,rankTotals).score,3);
});
test('a desired hero with the worst meta still outranks an undesired top-meta hero',()=>{
  const allies = [{id:1,selfReport:{desiredHeroes:[2]}}];
  const rec = pickRec(rankPool,{allies});
  assert.ok(metaOf(rec,2).score > metaOf(rec,3).score);
  assert.ok(rec.findIndex(r=>r.heroId===2) < rec.findIndex(r=>r.heroId===3));
});
test('a hero the player has 3 games on outranks a top-meta hero despite the worst meta',()=>{
  const allies = [{id:1,heroes:[{hero_id:2,games:3,last_played:now-100*86400}]}];
  const rec = pickRec(rankPool,{allies});
  assert.ok(metaOf(rec,2).components.history > 0);
  assert.ok(rec.findIndex(r=>r.heroId===2) < rec.findIndex(r=>r.heroId===3));
});
test('pick turn: a strong meta reason (score >= 2) comes first, a weaker one stays last',()=>{
  // mid: 52% win → +1; ~13% of games vs ~9.5% average → about +0.34; total about 1.34 (between 0 and 2)
  const mid = {id:7,roles:['Carry'],'7_pick':1500,'7_win':780};
  const rec = pickRec([mid,...rankPool]);
  const top = metaOf(rec,3), low = metaOf(rec,7);
  assert.ok(top.components.meta >= 2 && top.reasons.length > 1);
  assert.ok(top.reasons[0].startsWith('Meta: '));
  assert.ok(low.components.meta > 0 && low.components.meta < 2 && low.reasons.length > 1);
  assert.ok(low.reasons.at(-1).startsWith('Meta: '));
});
test('pick turn without any meta data says so in the evidence; ban turns do not',()=>{
  const rec = pickRec([{id:1,roles:['Carry']},{id:2,roles:['Carry']}]);
  assert.equal(rec.length,2);
  assert.ok(rec.every(r=>r.evidence.includes('Meta data unavailable')));
  const withMeta = pickRec(rankPool);
  assert.ok(withMeta.every(r=>!r.evidence.includes('Meta data unavailable')));
  const ban = recommend({heroes:[{id:1,roles:['Carry']}],now,mode:'enemyBan',allies:[{id:1,selfReport:{signatureHeroes:[1]}}]});
  assert.equal(ban.length,1);
  assert.ok(!ban[0].evidence.includes('Meta data unavailable'));
});
test('predicted enemy picks use meta too',()=>{
  const rec = recommend({heroes:pool,now,mode:'enemyPick'}), totals = metaTotals(pool);
  assert.equal(rec.find(r=>r.heroId===2).components.meta,heroMeta(strong,totals).score);
  assert.equal(rec.find(r=>r.heroId===1).components.meta,0);
});
