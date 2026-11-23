import test from 'node:test';
import assert from 'node:assert/strict';
import {winTier,comfortRows,enemyBanTarget,allyCounterBans,recentCupGames,tileMark} from '../web/draft-stats.js';

test('win tiers use minimum games and displayed rate',()=>{
 assert.equal(winTier(63,9),'low');assert.equal(winTier(54,10),'normal');assert.equal(winTier(55,10),'warm');
 assert.equal(winTier(59,10),'warm');assert.equal(winTier(60,10),'hot');assert.equal(winTier(null,20),'unknown');
});
test('enemy comfort uses the first two top heroes',()=>{
 const summary={topHeroes:[{heroId:1,games:40,winRate:61},{heroId:2,games:30,winRate:50},{heroId:3,games:20,winRate:70}]};
 assert.deepEqual(comfortRows({player:{},summary,side:'enemy'}).map(r=>[r.heroId,r.tier]),[[1,'hot'],[2,'normal']]);
});
test('ally comfort orders self-report first and removes duplicates',()=>{
 const player={selfReport:{signatureHeroes:[5],desiredHeroes:[5,6]}};
 const rows=comfortRows({player,summary:{topHeroes:[{heroId:6,games:12,winRate:58},{heroId:7,games:50,winRate:60}]},side:'ally'});
 assert.deepEqual(rows.map(r=>r.heroId),[5,6]);assert.equal(rows[0].tier,'low');assert.equal(rows[1].tier,'warm');
});
test('enemy ban target ignores taken heroes and small samples and breaks ties by games',()=>{
 const summary={topHeroes:[{heroId:1,games:7,winRate:90},{heroId:2,games:20,winRate:60},{heroId:3,games:40,winRate:60},{heroId:4,games:30,winRate:70}]};
 assert.equal(enemyBanTarget(summary,new Set([4])).heroId,3);
 assert.equal(enemyBanTarget({topHeroes:[{heroId:1,games:7,winRate:90}]},new Set()),null);
});
test('ally counters sort by worst matchup and require enough games',()=>{
 const rows=[{hero_id:2,games_played:19,wins:1},{hero_id:3,games_played:20,wins:8},{hero_id:4,games_played:40,wins:12},{hero_id:5,games_played:50,wins:5}];
 assert.deepEqual(allyCounterBans(1,rows,new Set([5])).map(r=>r.heroId),[4,3]);
 assert.deepEqual(allyCounterBans(1,undefined,new Set()),[]);
});
test('recent cup games dedupe, filter, sort, and keep unknown results',()=>{
 const now=1_000_000_000,day=86400,row=(id,age,extra={})=>({match_id:id,hero_id:id,lobby_type:9,start_time:now-age*day,player_slot:1,radiant_win:true,...extra});
 const games=recentCupGames({recent:[row(1,1)],matches:[row(1,1),row(2,3,{radiant_win:null}),row(3,2,{player_slot:130}),row(4,200),row(5,1,{lobby_type:7})]},now);
 assert.deepEqual(games.map(g=>[g.matchId,g.won]),[[1,true],[3,false],[2,null]]);
});
test('tile marks prefer draft state over suggestions',()=>{
 assert.deepEqual(tileMark({takenMode:'ourBan',pick:true,ban:true}),{text:'BAN',kind:'banned'});
 assert.deepEqual(tileMark({takenMode:'enemyPick'}),{text:'PICK',kind:'picked'});
 assert.deepEqual(tileMark({pick:true,ban:true}),{text:'P+B',kind:'contested'});
 assert.deepEqual(tileMark({pick:true}),{text:'P',kind:'sug-pick'});assert.deepEqual(tileMark({ban:true}),{text:'B',kind:'sug-ban'});
 assert.equal(tileMark({}),null);
});
