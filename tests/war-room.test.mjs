import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {buildBoard} from './build-board.js';

const built=await buildBoard({logLevel:'silent',plugins:[{name:'war-room-boundaries',enforce:'pre',load(id){
 if(id.replaceAll('\\','/').endsWith('/web/data.js'))return `export const publicData={request:path=>globalThis.__request(path)};export const loadHeroes=()=>new Promise(()=>{});export const loadPlayer=async(id,progress)=>{const p=globalThis.__player(String(id));progress(p);return p;};`;
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code,markup=await readFile('web/index.html','utf8');
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const profile=(id,topHeroes)=>({id,name:'Player '+id,sources:{profile:{status:'updated'},heroes:{status:'updated'}},profile:{profile:{personaname:'Player '+id}},heroes:topHeroes.map(([hero_id,games,win])=>({hero_id,games,win})),recent:[],matches:[]});

async function board({state={},players={},request=async()=>[]}={}){
 const dom=new JSDOM(markup,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.__request=request;w.__player=id=>players[id]||profile(id,[]);w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{actions:[],firstPick:true,roster:[],opponents:[],assignments:{},...state}}));
 w.eval(code);await flush();
 return {w,q:id=>w.document.getElementById(id),click:async node=>{assert.ok(node);node.click();await flush();}};
}

test('player row renders ten seats with win warnings and small samples',async()=>{
 const h=await board({state:{enemyIds:['900'],roster:[{id:'ally',displayName:'Ally',signatureHeroes:[1],desiredHeroes:[2]}]},players:{900:profile('900',[[109,38,23],[74,7,5]])}});
 try{
  assert.equal(h.q('player-rail').querySelectorAll('.seat-card').length,10);
  const enemy=[...h.q('player-rail').querySelectorAll('.seat-card.is-enemy')].find(card=>/Player 900/.test(card.textContent));
  assert.match(enemy.textContent,/▲ 61%/);assert.match(enemy.textContent,/38 games/);assert.match(enemy.textContent,/low/);assert.match(enemy.querySelector('.seat-ban').textContent,/Terrorblade/);
 }finally{h.w.close();}
});
test('ally without a linked account shows self-reported heroes instead of loading',async()=>{
 const h=await board({state:{roster:[{id:'ally',displayName:'Ally',signatureHeroes:[1]}]}});
 try{const card=h.q('player-rail').querySelector('.seat-card.is-ally');assert.match(card.textContent,/Anti-Mage/);assert.doesNotMatch(card.textContent,/Loading/);}finally{h.w.close();}
});
test('private and failed accounts show their state without a zero win rate',async()=>{
 const closed={...profile('901',[]),sources:{profile:{status:'private'}}},failed={...profile('902',[]),sources:{profile:{status:'error'},heroes:{status:'error'}}};
 const h=await board({state:{enemyIds:['901','902']},players:{901:closed,902:failed}});
 try{const text=h.q('player-rail').textContent;assert.match(text,/Closed account/);assert.match(text,/Stats unavailable/);assert.doesNotMatch(text,/0%/);}finally{h.w.close();}
});
test('a failed optional comfort matchup does not show the draft-wide retry',async()=>{
 const h=await board({state:{roster:[{id:'ally',displayName:'Ally',signatureHeroes:[1]}]},request:async()=>{throw Error('offline');}});
 try{assert.equal([...h.q('suggestions').querySelectorAll('button')].some(b=>/Retry unavailable/.test(b.textContent)),false);assert.match(h.q('player-rail').textContent,/No counter data/);}finally{h.w.close();}
});
test('a transient optional matchup failure recovers after the retry reset',async()=>{
 let calls=0;
 const request=async path=>{calls++;if(calls<=2)throw Error('offline');return path.includes('/heroes/1/')?[{hero_id:2,games_played:30,wins:10}]:[];};
 const h=await board({state:{actions:[{mode:'ourPick',heroId:5}],roster:[{id:'ally',displayName:'Ally',signatureHeroes:[1]}]},request});
 try{
  assert.match(h.q('player-rail').textContent,/No counter data/);
  const retry=[...h.q('suggestions').querySelectorAll('button')].find(b=>/Retry unavailable/.test(b.textContent));
  await h.click(retry);
  assert.match(h.q('player-rail').querySelector('.seat-card.is-ally .seat-ban').textContent,/Axe/);
  assert.doesNotMatch(h.q('player-rail').querySelector('.seat-card.is-ally .seat-ban').textContent,/No counter data/);
 }finally{h.w.close();}
});
test('activating a seat keeps keyboard focus on it',async()=>{
 const h=await board({state:{roster:[{id:'ally',displayName:'Ally',signatureHeroes:[1]}]}});
 try{
  const seat=h.q('player-rail').querySelector('.seat-card.is-ally');seat.focus();assert.equal(h.w.document.activeElement,seat);
  await h.click(seat);
  const active=h.w.document.activeElement;
  assert.ok(active.classList.contains('seat-card'));assert.equal(active.dataset.seatId,seat.dataset.seatId);assert.equal(active.getAttribute('aria-pressed'),'true');
 }finally{h.w.close();}
});
test('taken heroes stay visible, labeled, and unavailable to keyboard selection',async()=>{
 const h=await board({state:{actions:[{mode:'ourBan',heroId:1}]}});
 try{
  const banned=h.q('hero-groups').querySelector('[data-hero-id="1"]');
  assert.equal(banned.disabled,true);assert.equal(banned.querySelector('.tile-mark').textContent,'BAN');assert.match(banned.getAttribute('aria-label'),/banned/);
  const search=h.q('hero-search');search.value='Anti-Mage';search.dispatchEvent(new h.w.Event('input'));
  assert.equal(h.q('hero-groups').querySelector('[data-hero-id="1"]').classList.contains('is-search-miss'),false);
  search.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.q('suggestions').querySelector('.rec-feature'),null);
  search.value='';search.dispatchEvent(new h.w.Event('input'));
  for(let i=0;i<130;i++){search.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(h.q('hero-groups').querySelector('.is-highlighted').disabled,false);}
 }finally{h.w.close();}
});
test('search dims non-matching heroes and keeps the no-result message',async()=>{
 const h=await board();
 try{
  const search=h.q('hero-search');search.value='Axe';search.dispatchEvent(new h.w.Event('input'));
  assert.equal(h.q('hero-groups').querySelector('[data-hero-id="1"]').classList.contains('is-search-miss'),true);
  search.value='zzzzzz';search.dispatchEvent(new h.w.Event('input'));assert.match(h.q('hero-groups').textContent,/No heroes match/);
 }finally{h.w.close();}
});
test('enemy comfort shows a win chip and a broken portrait keeps the name visible',async()=>{
 const h=await board({state:{enemyIds:['900']},players:{900:profile('900',[[109,38,23]])}});
 try{
  const tile=h.q('hero-groups').querySelector('[data-hero-id="109"]');assert.equal(tile.querySelector('.tile-win').textContent,'61%');
  tile.querySelector('img').dispatchEvent(new h.w.Event('error'));assert.equal(tile.classList.contains('is-image-missing'),true);assert.match(tile.textContent,/Terrorblade/);
 }finally{h.w.close();}
});
test('focusing a player highlights their heroes and dims the rest',async()=>{
 const h=await board({state:{enemyIds:['900']},players:{900:profile('900',[[109,38,23]])}});
 try{
  const tiles=()=>h.q('hero-groups').querySelectorAll('.hero-tile');
  assert.equal(h.q('hero-groups').querySelectorAll('.is-player-hero,.is-player-dim').length,0);
  await h.click(h.q('player-rail').querySelector('.seat-card.is-enemy'));
  assert.equal(h.q('hero-groups').querySelector('[data-hero-id="109"]').classList.contains('is-player-hero'),true);
  assert.equal(h.q('hero-groups').querySelector('[data-hero-id="1"]').classList.contains('is-player-dim'),true);
  await h.click(h.q('player-rail').querySelector('.seat-card.is-enemy'));
  assert.equal(h.q('hero-groups').querySelectorAll('.is-player-hero,.is-player-dim').length,0);
 }finally{h.w.close();}
});
test('recommendations separate six best actions from the decision dock',async()=>{
 const h=await board({state:{enemyIds:['900']},players:{900:profile('900',[[109,38,23],[74,30,18],[8,20,12]])}});
 try{
  const best=h.q('suggestions').querySelector('.best-now'),dock=h.q('suggestions').querySelector('.decision-dock');
  assert.ok(best);assert.ok(dock);{const n=best.querySelector('.decision-candidates').querySelectorAll('.rec-row').length;assert.ok(n>0&&n<=6);}
  await h.click(best.querySelector('.rec-row'));
  assert.ok(h.q('suggestions').querySelector('.decision-dock .rec-feature'));assert.ok(h.q('suggestions').querySelector('.decision-dock button.primary'));
 }finally{h.w.close();}
});
test('the current draft slot previews the staged hero without recording it',async()=>{
 const h=await board();
 try{
  const cur=()=>h.q('timeline').querySelector('.tree-row.is-current');
  assert.equal(cur().querySelector('.tree-preview'),null);
  await h.click(h.q('hero-groups').querySelector('[data-hero-id="1"]'));
  const slot=cur(),preview=slot.querySelector('.tree-preview');
  assert.ok(preview);assert.ok(preview.classList.contains('tree-hero'));
  assert.match(slot.querySelector('.tree-label').textContent,/Anti-Mage/);
  assert.match(slot.getAttribute('aria-label'),/^Turn 1, .*previewing Anti-Mage/);assert.match(slot.title,/previewing Anti-Mage/);
  assert.equal(slot.classList.contains('is-recorded'),false);
  await h.click(h.q('suggestions').querySelector('.clear-staged'));
  assert.equal(cur().querySelector('.tree-preview'),null);
 }finally{h.w.close();}
});
test('win evidence chip needs ten games, names the enemy on bans, and ignores enemy stats on our picks',async()=>{
 const wins=h=>[...h.q('suggestions').querySelectorAll('.best-now .rec-win')].map(n=>n.textContent);
 let h=await board({state:{enemyIds:['900']},players:{900:profile('900',[[109,10,6],[74,10,6],[8,10,6],[1,10,6],[2,10,6],[3,10,6]])}});
 try{
  assert.ok(h.q('suggestions').querySelectorAll('.best-now .rec-row').length>0);
  const chips=wins(h);assert.ok(chips.length>0);assert.ok(chips.every(t=>/^Enemy Player 900 · 60% · 10 games$/.test(t)),chips.join('|'));
 }finally{h.w.close();}
 h=await board({state:{enemyIds:['900']},players:{900:profile('900',[[109,9,6],[74,9,6],[8,9,6],[1,9,6],[2,9,6],[3,9,6]])}});
 try{assert.ok(h.q('suggestions').querySelectorAll('.best-now .rec-row').length>0);assert.equal(wins(h).length,0);}finally{h.w.close();}
 const bans=[1,2,3,4,5,6,7].map(heroId=>({mode:'ourBan',heroId}));
 h=await board({state:{enemyIds:['900'],actions:bans},players:{900:profile('900',[[109,38,23],[74,30,18],[8,20,12],[11,20,12],[12,20,12],[13,20,12]])}});
 try{
  assert.equal(h.q('suggestions').querySelector('.best-now h3').textContent,'Best picks now');
  assert.ok(h.q('suggestions').querySelectorAll('.best-now .rec-row').length>0);
  assert.equal(wins(h).filter(t=>t.includes('Player 900')).length,0);
 }finally{h.w.close();}
});
test('clicking an enemy opens only that player scouting detail',async()=>{
 const h=await board({state:{enemyIds:['900','901']},players:{900:profile('900',[[109,38,23]]),901:profile('901',[[74,20,10]])}});
 try{
  assert.equal(h.q('draft-enemy-scouting').classList.contains('is-detail-open'),false);
  await h.click([...h.q('player-rail').querySelectorAll('.seat-card.is-enemy')].find(card=>/Player 900/.test(card.textContent)));
  assert.equal(h.q('draft-enemy-scouting').classList.contains('is-detail-open'),true);
  assert.equal(h.q('draft-enemy-list').querySelector('.draft-enemy.is-focused').dataset.playerId,'900');
 }finally{h.w.close();}
});
test('war room stylesheet is linked and scouting follows the player rail',async()=>{
 const doc=new JSDOM(markup).window.document,css=await readFile('web/war-room.css','utf8');
 assert.ok(doc.querySelector('link[href="./war-room.css"]'));
 assert.equal(doc.getElementById('draft-enemy-scouting').previousElementSibling.id,'player-rail');
 assert.equal(doc.querySelector('.decision-panel #draft-enemy-scouting'),null);
 assert.match(css,/\.tree-turn\[data-action=pick\]/);
 assert.match(css,/\.tree-preview\{[^}]*dashed/);
 assert.match(css,/\.is-player-hero\{[^}]*#fff/);
 assert.match(css,/\.is-player-dim\{[^}]*opacity:\.26/);
 assert.match(css,/\.is-search-miss\.is-player-hero/);
});
test('add enemy uses the existing setup flow',async()=>{
 const h=await board();
 try{await h.click(h.q('player-rail').querySelector('.seat-add-enemy'));assert.ok(h.w.document.querySelector('dialog[open]'));}finally{h.w.close();}
});
