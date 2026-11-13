import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CM_ORDER,nextTurn,parseAccountIds,recommend} from '../web/draft-engine.js';
const now = 1700000000;
const heroes = [
  {id:1,roles:['Carry']},{id:2,roles:['Support','Disabler']},{id:3,roles:['Initiator','Durable']},
  {id:4,roles:['Nuker']},{id:5,roles:['Support']},{id:6,roles:['Carry']}];
const base = {heroes,now};
test('turns reverse for second pick and stop at 24',()=>{
  assert.equal(CM_ORDER.length,24);
  assert.equal(nextTurn([],false).mode,'enemyBan');
  assert.equal(nextTurn(Array(24)),null);
});
test('parses both Steam and account IDs without duplicates',()=>{
  assert.deepEqual(parseAccountIds('99, https://steamcommunity.com/profiles/76561197960265827/ 0 garbage'),[99]);
});
test('unknown opponents give no personal bans',()=>{
  assert.deepEqual(recommend(base),[]);
});
test('target bans reflect recent and cup games, deduplicate and exclude future evidence',()=>{
  const cup = {match_id:3,start_time:now-3600,lobby_type:9,hero_id:2};
  const opponents = [{id:1,heroes:[{hero_id:1,games:1},{hero_id:3,games:100,last_played:now+1}],recent:[cup,{...cup,match_id:4,start_time:now+1,hero_id:3}],matches:[cup]}];
  const rec = recommend({...base,opponents});
  assert.deepEqual(rec.map(r=>r.heroId),[2,1]);
  assert.equal(rec[0].components.history,27);
});
test('player-specific intent and exclusions, position and assigned player honored',()=>{
  const allies = [1,2,3,4,5].map(id=>({id,selfReport:{preferredRoles:[id],roleComfort:{[id]:5},avoidHeroes:[6]}}));
  allies[4].selfReport.signatureHeroes = [5];
  allies[3].selfReport.desiredHeroes = [2];
  const rec = recommend({...base,mode:'ourPick',allies,draft:[{mode:'ourPick',heroId:1,position:1,playerId:'1'}]});
  assert.equal(rec[0].heroId,5);
  assert.deepEqual([rec[0].playerId,rec[0].position],['5',5]);
  assert.equal(rec.find(r=>r.heroId===2).components.desired,5);
  assert.ok(rec.every(r=>r.position!==1 && r.playerId!=='1' && ![1,6].includes(r.heroId)));
});
test('matchup perspective reversed when only enemy row exists; missing rows neutral',()=>{
  const rec = recommend({...base,mode:'ourPick',draft:[{mode:'enemyPick',heroId:1}],matchups:{1:[{hero_id:2,games_played:150,wins:50}]}});
  assert.equal(rec.find(r=>r.heroId===2).components.matchup,2.5);
  assert.equal(rec.find(r=>r.heroId===3).components.matchup,0);
});
test('flex player leaves the specialist position free',()=>{
  const allies = [
    {id:1,selfReport:{signatureHeroes:[2],preferredRoles:[4,5]}},
    {id:2,selfReport:{preferredRoles:[4],roleComfort:{4:5}}}];
  const hero = recommend({...base,mode:'ourPick',allies}).find(r=>r.heroId===2);
  assert.deepEqual([hero.playerId,hero.position],['1',5]);
});
test('availability and declared roles are hard exclusions, impossible locks yield no rows',()=>{
  const allies = [1,2,3,4,5].map(id=>({id,selfReport:{preferredRoles:[id],signatureHeroes:[5]}}));
  const draft = [1,2,3,4].map(id=>({mode:'ourPick',heroId:id,position:id,playerId:String(id)}));
  assert.ok(recommend({...base,mode:'ourPick',allies,draft}).every(r=>r.playerId==='5' && r.position===5));
  allies[4].selfReport.preferredRoles = [1];
  assert.deepEqual(recommend({...base,mode:'ourPick',allies,draft}),[]);
  allies[4].selfReport.preferredRoles = [5];
  allies[4].selfReport.availability = 'unavailable';
  assert.deepEqual(recommend({...base,mode:'ourPick',allies,draft}),[]);
  assert.deepEqual(recommend({...base,mode:'ourPick',allies,draft:[draft[0],{...draft[1],playerId:'1'}]}),[]);
});
test('overlapping declarations count once, and opponents cannot supply manual declarations',()=>{
  const profile = {id:1,selfReport:{signatureHeroes:[5],desiredHeroes:[5]}};
  assert.deepEqual(recommend({...base,opponents:[profile]}),[]);
  const r = recommend({...base,mode:'ourPick',allies:[profile]}).find(x=>x.heroId===5);
  assert.equal(r.components.signature,20);
  assert.equal(r.components.desired,0);
});
test('16-hour cup evidence outranks older cup evidence; bans include observed matchup threat and inferred lane',()=>{
  const opponents = [{id:42,recent:[
    {match_id:4,hero_id:2,start_time:now-17*3600,lobby_type:9},
    {match_id:5,hero_id:4,start_time:now-16*3600,lobby_type:9,lane_role:2}]}];
  const rec = recommend({...base,mode:'ourBan',draft:[{mode:'ourPick',heroId:1}],opponents,matchups:{4:[{hero_id:1,games_played:150,wins:100}]}});
  assert.equal(rec[0].heroId,4);
  assert.equal(rec[0].position,2);
  assert.equal(rec[0].components.matchup,2.5);
  assert.equal(rec[0].details.find(d=>d.category==='history').sample.cup16h,1);
  assert.equal(rec[1].details.find(d=>d.category==='history').sample.cup16h,0);
});
test('composition coverage changes when initiation is secured and results are deterministic',()=>{
  const fresh = recommend({...base,mode:'ourPick'}).find(x=>x.heroId===3);
  const options = {...base,heroes:[...heroes,{id:7,roles:['Initiator']}],draft:[{mode:'ourPick',heroId:7}],mode:'ourPick'};
  const rec = recommend(options), chosen = rec.find(x=>x.heroId===3);
  assert.ok(fresh.components.composition > chosen.components.composition);
  assert.ok(fresh.reasons.includes('Adds Initiator'));
  assert.deepEqual(rec,recommend(options));
  assert.ok(rec.every(x=>Number.isFinite(x.score)));
});
