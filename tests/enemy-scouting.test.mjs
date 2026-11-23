import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';
import * as engine from '../web/draft-engine.js';
import {loadPlayer} from '../web/data.js';

const now=1_700_000_000,day=86400;
const heroes=[{id:1,localized_name:'Anti-Mage',roles:['Carry']},{id:2,localized_name:'Axe',roles:['Initiator']},{id:3,localized_name:'Crystal Maiden',roles:['Support']},{id:53,localized_name:"Nature's Prophet",roles:['Carry','Pusher']}];
const ok={status:'updated'};
const sources=(over={})=>({profile:ok,recent:ok,heroes:ok,matches:ok,...over});
const player=(over={})=>engine.normalizeProfile({id:'1',name:'Foe',heroes:[],recent:[],matches:[],sources:sources(),...over});
const match=(match_id,hero_id,days,extra={})=>({match_id,hero_id,start_time:now-days*day,radiant_win:true,player_slot:0,...extra});
const summary=(p,extra={})=>engine.enemySummary(p,{now,heroes,...extra});

test('loadPlayer asks OpenDota to project hero_id for matches',async()=>{
 const paths=[];
 const queue={request:async path=>{paths.push(path);return path.includes('/heroes')||path.includes('/matches')||path.includes('/recentMatches')?[]:{profile:{personaname:'X'}};},getSourceInfo:()=>null};
 await loadPlayer('123',()=>{},queue);
 assert.match(paths.find(p=>p.includes('/matches?')),/project=hero_id/);
});

test('state is loading while any source is fetching',()=>{
 assert.equal(summary(player({sources:sources({matches:{status:'fetching'}}),heroes:[{hero_id:1,games:3,win:1}]})).state,'loading');
});
test('state is error, not closed, when OpenDota failed and nothing usable loaded',()=>{
 const failed={status:'error',message:'429'};
 assert.equal(summary(player({sources:sources({recent:failed,heroes:failed,matches:failed})})).state,'error');
 assert.equal(summary(player({sources:sources({profile:failed,recent:failed,heroes:failed,matches:failed})})).state,'error');
 assert.equal(summary(player({sources:sources({profile:{status:'private'},recent:failed})})).state,'closed');
 assert.equal(summary(player({sources:sources({matches:failed}),heroes:[{hero_id:1,games:3,win:1}]})).state,'ready');
});
test('state is loading before any source exists, ready for sourceless fixtures with data',()=>{
 assert.equal(summary(engine.normalizeProfile({id:'9',name:'New'})).state,'loading');
 assert.equal(summary(engine.normalizeProfile({id:'9',name:'Demo',heroes:[{hero_id:1,games:5,win:3}]})).state,'ready');
});
test('topHeroes has no win rate when OpenDota gave no win count',()=>{
 assert.deepEqual(summary(player({heroes:[{hero_id:1,games:40}]})).topHeroes,[{heroId:1,games:40,wins:null,winRate:null}]);
});
test('cup games with an unknown result are counted but never as wins',()=>{
 const cup=summary(player({recent:[match(1,2,1,{lobby_type:9,radiant_win:null,player_slot:128})]})).cup;
 assert.deepEqual(cup,[{heroId:2,games:1,wins:0}]);
});
test('state is closed for a private profile or when all history is empty',()=>{
 assert.equal(summary(player({sources:sources({profile:{status:'private'}}),heroes:[{hero_id:1,games:3,win:1}]})).state,'closed');
 assert.equal(summary(player()).state,'closed');
 assert.equal(summary(player({recent:[match(1,1,1)]})).state,'ready');
 // Real closed accounts: visible profile, hero list of zero-game rows, no matches.
 assert.equal(summary(player({heroes:[{hero_id:1,games:0,win:0},{hero_id:2,games:0,win:0}]})).state,'closed');
});
test('topHeroes keeps five played heroes sorted by games then wins with rounded win rate',()=>{
 const rows=[{hero_id:1,games:3,win:2},{hero_id:2,games:14,win:10},{hero_id:3,games:3,win:3},{hero_id:4,games:0,win:0},{hero_id:5,games:1,win:0},{hero_id:6,games:2,win:0},{hero_id:7,games:2,win:1}];
 const top=summary(player({heroes:rows})).topHeroes;
 assert.deepEqual(top.map(h=>h.heroId),[2,3,1,7,6]);
 assert.deepEqual(top[0],{heroId:2,games:14,wins:10,winRate:71});
 assert.equal(top[1].winRate,100);
 assert.equal(summary(player({heroes:[{hero_id:1,games:3,win:1}]})).topHeroes[0].winRate,33);
 assert.equal(summary(player({heroes:[{hero_id:1,games:3,win:2}]})).topHeroes[0].winRate,67);
});
test('recent counts wins by side and radiant_win',()=>{
 const recent=[match(1,1,1),match(2,1,1,{player_slot:130,radiant_win:false}),match(3,1,1,{player_slot:130}),match(4,1,1,{radiant_win:false})];
 assert.deepEqual(summary(player({recent})).recent,{wins:2,losses:2});
});
test('cup groups Battle Cup games, dedupes across sources and drops matches older than 180 days',()=>{
 const cup=(id,hero,days,extra)=>match(id,hero,days,{lobby_type:9,...extra});
 const p=player({
  matches:[cup(1,1,5),cup(2,1,6,{radiant_win:false}),cup(3,2,7),cup(4,1,181),match(5,1,2,{lobby_type:0})],
  recent:[cup(1,1,5),cup(6,2,3),cup(7,2,4,{radiant_win:false})]});
 assert.deepEqual(summary(p).cup,[{heroId:1,games:2,wins:1},{heroId:2,games:3,wins:2}].sort((a,b)=>b.games-a.games));
 assert.deepEqual(summary(player({matches:[match(1,1,1)]})).cup,[]);
});
test('positions follow lane logic, dedupe by match, respect 180 days and order by frequency',()=>{
 const p=player({
  matches:[match(1,1,1,{lane_role:2}),match(2,1,2,{lane_role:2}),match(3,1,3,{lane_role:1}),match(4,3,4,{lane_role:1}),match(5,2,5,{lane_role:3}),match(6,3,6,{lane_role:3}),match(7,2,7,{is_roaming:true,lane_role:1}),match(8,1,200,{lane_role:2}),match(9,1,1)],
  recent:[match(1,1,1,{lane_role:2}),match(10,3,1,{lane_role:3})]});
 // pos2 x2, pos4 x3 (roam, support lane 3 x2), pos1 x1, pos5 x1, pos3 x1
 const out=summary(p).positions;
 assert.deepEqual(out[0],{position:4,games:3});
 assert.deepEqual(out[1],{position:2,games:2});
 assert.deepEqual(out.slice(2).map(x=>x.position).sort(),[1,3,5]);
 assert.equal(out.length,5);
 assert.deepEqual(summary(player({recent:[match(1,1,1)]})).positions,[]);
});

// UI flow
const built=await build({logLevel:'silent',plugins:[{name:'flow-boundaries',enforce:'pre',load(id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(path.endsWith('/web/data.js'))return `export const publicData={request:async()=>[]};export const loadHeroes=async()=>globalThis.__heroes;export const loadPlayer=async(id,progress)=>{const p=globalThis.__players[id];progress(p);return p;};`;
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const markup=await readFile('web/index.html','utf8');
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

test('enemy scouting cards show public stats, loading and closed states',async()=>{
 const dom=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.__heroes=Object.fromEntries(heroes.map(h=>[h.id,h]));
 const open={id:'111',name:'Open Foe',sources:sources(),
  heroes:[{hero_id:1,games:14,win:10,last_played:now},{hero_id:53,games:3,win:1,last_played:now}],
  recent:[...Array(6)].map((_,i)=>match(100+i,1,1,{lane_role:2})).concat([...Array(4)].map((_,i)=>match(200+i,1,1,{lane_role:3,player_slot:0,radiant_win:false}))),
  matches:[match(300,53,2,{lane_role:2,lobby_type:9})]};
 const closed={id:'222',name:'Closed Foe',sources:sources({profile:{status:'private'},recent:{status:'empty'},heroes:{status:'empty'},matches:{status:'empty'}})};
 w.__players={111:open,222:closed};
 w.eval(code);await flush();
 const doc=w.document;
 w.eval(`Date.now=()=>${now*1000}`);
 doc.getElementById('setup-button').click();await flush();
 doc.getElementById('enemy-account-input').value='111\n222';
 [...doc.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();await flush();
 try{
  const cards=[...doc.querySelectorAll('#team-roster .player-card')];
  const card=name=>cards.find(c=>c.querySelector('h3').textContent===name);
  const o=card('Open Foe'),c=card('Closed Foe');
  assert.ok(o&&c,'both enemy cards render');
  assert.doesNotMatch(o.textContent+c.textContent,/Role preferences not set|Signatures|Wants/);
  assert.equal(c.querySelector('p.enemy-status').textContent,'Closed account — no public match history.');
  assert.match(o.querySelector('p.player-role-summary').textContent,/^Likely Pos \d · Pos \d$/);
  const heads=[...o.querySelectorAll('h4')].map(h=>h.textContent);
  assert.deepEqual(heads,['Most played · 180 days','Recent','Battle Cup']);
  const top=[...o.querySelector('.enemy-top-heroes').children];
  assert.equal(top.length,2);
  assert.match(top[0].textContent,/Anti-Mage/);assert.match(top[0].textContent,/14 games · 71%/);
  assert.match(top[1].textContent,/Nature's Prophet/);
  assert.match(o.querySelector('.enemy-recent').textContent,/6W 4L \(last 10\)/);
  assert.match(o.querySelector('.enemy-cup').textContent,/Nature's Prophet/);
  assert.match(o.querySelector('.enemy-cup').textContent,/1 games?/);
 }finally{w.close();}
});

const boot=async(players,ids)=>{
 const dom=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.__heroes=Object.fromEntries(heroes.map(h=>[h.id,h]));w.__players=players;
 w.eval(code);await flush();w.eval(`Date.now=()=>${now*1000}`);
 if(ids){w.document.getElementById('setup-button').click();await flush();w.document.getElementById('enemy-account-input').value=ids;
  [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();await flush();}
 return w;
};

test('draft panel shows enemy scouting for open and closed enemies without the Team tab',async()=>{
 const open={id:'111',name:'Open Foe',sources:sources(),
  heroes:[{hero_id:1,games:14,win:10,last_played:now},{hero_id:53,games:3,win:1,last_played:now},{hero_id:2,games:2,win:1,last_played:now},{hero_id:3,games:1,win:0,last_played:now}],
  recent:[...Array(6)].map((_,i)=>match(100+i,1,1,{lane_role:2})).concat([...Array(4)].map((_,i)=>match(200+i,1,1,{lane_role:3}))),
  matches:[match(300,53,2,{lane_role:2,lobby_type:9})]};
 const closed={id:'222',name:'Closed Foe',sources:sources({profile:{status:'private'},recent:{status:'empty'},heroes:{status:'empty'},matches:{status:'empty'}})};
 const w=await boot({111:open,222:closed},'111\n222'),doc=w.document;
 try{
  assert.equal(doc.getElementById('draft-view').hidden,false);assert.equal(doc.getElementById('team-view').hidden,true);
  const s=doc.getElementById('draft-enemy-scouting');
  assert.ok(s,'#draft-enemy-scouting exists');assert.equal(s.hidden,false);
  assert.equal(s.previousElementSibling.id,'player-rail','right after the player rail');
  assert.equal(s.querySelector('h3').textContent,'Enemy scouting');
  const cards=[...s.querySelectorAll('.draft-enemy')];
  assert.deepEqual(cards.map(c=>c.querySelector('.draft-enemy-name').textContent),['Open Foe','Closed Foe']);
  const [o,c]=cards;
  assert.match(o.querySelector('.draft-enemy-meta').textContent,/^Pos \d · Pos \d$/);
  const hs=[...o.querySelectorAll('.draft-enemy-hero')];
  assert.equal(hs.length,3);
  assert.match(hs[0].textContent,/Anti-Mage/);assert.match(hs[0].textContent,/71% · 14/);
  assert.match(hs[1].textContent,/Nature's Prophet/);assert.match(hs[2].textContent,/Axe/);
  assert.equal(o.querySelector('.draft-enemy-cup').textContent,"Battle Cup: Nature's Prophet");
  assert.equal(c.querySelector('.draft-enemy-meta').textContent,'Closed account');
  assert.equal(c.querySelectorAll('.draft-enemy-hero').length,0);assert.equal(c.querySelector('.draft-enemy-cup'),null);
 }finally{w.close();}
});

test('draft enemy scouting section is hidden when no enemies are set',async()=>{
 const w=await boot({});
 try{const s=w.document.getElementById('draft-enemy-scouting');assert.ok(s,'section exists');assert.equal(s.hidden,true);assert.equal(s.previousElementSibling.id,'player-rail');}finally{w.close();}
});

test('draft enemy scouting shows Loading… while a source is fetching',async()=>{
 const w=await boot({333:{id:'333',name:'Slow Foe',sources:sources({matches:{status:'fetching'}})}},'333');
 try{
  const s=w.document.getElementById('draft-enemy-scouting');
  assert.ok(s,'section exists');assert.equal(s.hidden,false);
  const c=s.querySelector('.draft-enemy');
  assert.equal(c.querySelector('.draft-enemy-name').textContent,'Slow Foe');
  assert.equal(c.querySelector('.draft-enemy-meta').textContent,'Loading…');
  assert.equal(c.querySelectorAll('.draft-enemy-hero').length,0);
 }finally{w.close();}
});

test('enemy card shows loading text while sources are fetching',async()=>{
 const dom=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.__heroes={};w.__players={333:{id:'333',name:'Slow Foe',sources:sources({matches:{status:'fetching'}})}};
 w.eval(code);await flush();
 w.document.getElementById('setup-button').click();await flush();
 w.document.getElementById('enemy-account-input').value='333';
 [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Save and scout enemies').click();await flush();
 try{assert.equal(w.document.querySelector('#team-roster p.enemy-status').textContent,'Loading public stats…');}finally{w.close();}
});
