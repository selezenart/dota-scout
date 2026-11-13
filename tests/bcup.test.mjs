import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {nextBattleCup,mountBattleCup} from '../web/bcup.js';

test('Kyiv Saturday kickoff rolls forward at 20:00 and observes summer time',()=>{
  assert.equal(nextBattleCup(new Date('2026-03-28T17:59:59Z')),'2026-03-28T18:00:00.000Z');
  assert.equal(nextBattleCup(new Date('2026-03-28T18:00:00Z')),'2026-04-04T17:00:00.000Z');
  assert.equal(nextBattleCup(new Date('2026-10-24T17:00:00Z')),'2026-10-31T18:00:00.000Z');
});

test('missing open-lineup setup offers useful actions and recovers after refresh',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;let ready=false,profile=0;
 try{
  const root=document.querySelector('main'),page=mountBattleCup({root,getContext:()=>({user:{id:'me'},teams:[],backend:{listBattleCup:async()=>{if(!ready)throw {code:'PGRST202',message:'public.get_open_battle_cup missing'};return {eventAt:nextBattleCup(),signups:[]};}}}),onProfile:()=>profile++});
  page.sync();await page.refresh();assert.doesNotMatch(root.textContent,/public.get_open_battle_cup/);assert.match(root.textContent,/not available yet/);
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Set up my profile').click();assert.equal(profile,1);
  ready=true;await page.refresh();assert.equal(root.querySelectorAll('[data-slot]').length,6);assert.doesNotMatch(root.textContent,/not available yet/);
 }finally{delete globalThis.document;dom.window.close();}
});

test('signed-in players can reserve without a team and use the guide and next actions',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 let stored={eventAt:nextBattleCup(),signups:[]},profile=0,today=0,setup=0,drafts=0;
 const backend={listBattleCup:async team=>{assert.equal(team,'');return stored;},saveBattleCup:async(team,eventAt,slot,positions,userId)=>{assert.equal(team,'');stored={eventAt,signups:[{slot,positions,userId,displayName:'Solo'}]};return stored;}};
 try{
  const root=document.querySelector('main'),page=mountBattleCup({root,getContext:()=>({user:{id:'solo'},teams:[],backend,profileReady:true}),onProfile:()=>profile++,onToday:()=>today++,onSetup:()=>setup++,onDraft:()=>drafts++});
  page.sync();await page.refresh();
  assert.match(root.querySelector('.cup-guide').textContent,/Team · optional/);
  assert.equal(root.querySelectorAll('.cup-guide button').length,4);
  assert.equal(root.querySelector('.cup-draft-ready'),null);
  root.querySelector('[data-slot="2"]').click();root.querySelector('input[name=cup-position][value="1"]').click();
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Save my spot').click();await new Promise(r=>setImmediate(r));
  assert.match(root.textContent,/You’re signed up/);
  root.querySelector('.cup-draft-ready button').click();assert.equal(drafts,1);assert.match(root.querySelector('.cup-draft-ready').textContent,/Joining a team is optional/);
  const cards=root.querySelectorAll('.cup-next-card');assert.equal(cards.length,3);
  cards[0].click();cards[1].click();cards[2].click();assert.deepEqual([today,setup,profile],[1,1,1]);
  root.querySelectorAll('.cup-guide button')[3].click();assert.equal(document.activeElement.getAttribute('data-slot'),'2');
 }finally{delete globalThis.document;dom.window.close();}
});

test('Battle Cup demo books, moves and cancels one seat with up to two roles',async()=>{
  const dom=new JSDOM('<main></main>');
  globalThis.document=dom.window.document;
  try{
    const root=document.querySelector('main');
    const page=mountBattleCup({root,getContext:()=>({demo:true})});
    await page.refresh();
    const spot=n=>root.querySelector('[data-slot="'+n+'"]');
    const role=n=>root.querySelector('input[name="cup-position"][value="'+n+'"]');
    const action=name=>[...root.querySelectorAll('button')].find(button=>button.textContent===name);
    assert.equal(root.querySelectorAll('[data-slot]').length,6);
    assert.equal(spot(1).disabled,true);
    assert.equal(spot(6).type,'radio');
    assert.equal(spot(6).name,'cup-slot');
    spot(6).click();
    assert.equal(spot(6).checked,true);
    assert.equal(action('Save my spot').disabled,true);
    const summary=()=>document.getElementById('cup-selection-summary');
    assert.equal(action('Save my spot').getAttribute('aria-describedby'),summary().id);
    assert.match(summary().textContent,/Replacement · Choose one or two positions/);
    role(4).click();role(5).click();
    assert.equal(role(3).disabled,true);
    assert.match(summary().textContent,/Replacement · P4 Soft support \/ P5 Hard support/);
    assert.match(root.querySelector('.cup-positions legend').textContent,/2 of 2/);
    assert.match(document.getElementById('cup-role-hint').textContent,/Uncheck a position/);
    action('Save my spot').click();
    assert.match(root.textContent,/signed up · Replacement · P4 \/ P5/);
    assert.equal(root.querySelector('.cup-plan-details').open,false);
    assert.ok(action('Open draft board').compareDocumentPosition(spot(2)) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    spot(2).click();action('Update my signup').click();
    assert.match(root.textContent,/signed up · Main spot 2/);
    assert.match(spot(6).closest('label').textContent,/Available/i);
    assert.equal(action('Update my signup').disabled,true);
    action('Cancel my signup').click();
    assert.equal(spot(2).checked,true);
    action('Confirm cancellation').click();
    assert.match(spot(2).closest('label').textContent,/Available/i);
    assert.match(root.textContent,/signup cancel(?:led|ed)/i);
    await page.refresh();
    assert.match(root.textContent,/signup cancel(?:led|ed)/i);
  }finally{delete globalThis.document;dom.window.close();}
});

test('next actions keep the lineup team selected in Battle Cup',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;let opened;
 try{
  const root=document.querySelector('main'),page=mountBattleCup({root,getContext:()=>({user:{id:'me'},teams:[{id:'a',name:'A'},{id:'b',name:'B'}],backend:{listBattleCup:async()=>({eventAt:nextBattleCup(),signups:[{userId:'me',slot:1,positions:[1],displayName:'Me'}]})}}),onTeam:id=>{opened=id;}});
  page.sync();await page.refresh();const select=root.querySelector('select');select.value='b';select.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setImmediate(r));
  root.querySelectorAll('.cup-next-card')[1].click();assert.equal(opened,'b');
 }finally{delete globalThis.document;dom.window.close();}
});
