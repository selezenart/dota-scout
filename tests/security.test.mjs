import test from 'node:test';
import assert from 'node:assert/strict';
import {boardCode} from './build-board.js';
import {BACKEND_STUB,flush,observed,boardWindow,stubDialogs} from './board-harness.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('team selection ignores stale roster responses and signout erases pending private data',async()=>{
 const code=await boardCode({'/web/backend.js':BACKEND_STUB});
 const dom=boardWindow(),w=dom.window;
 const slowA=deferred(),slowAfterLogout=deferred();let authCallback;const loads=[];
 const profile=(name,id)=>({userId:id,displayName:name,availability:'available',preferredRoles:[],signatureHeroes:[]});
 // Team B is first, so the automatic load when Setup opens is B. Both slow responses
 // answer the user's own selects of A, which only loadTeam's stale-response guard can drop.
 const answers=[()=>[profile('B private roster','b-player')],()=>slowA.promise,()=>[profile('B private roster','b-player')],()=>slowAfterLogout.promise,()=>[profile('B private roster','b-player')]];
 w.__backend={getSession:async()=>({user:{id:'me'}}),onAuthChange:fn=>authCallback=fn,loadProfile:async()=>profile('My private name','me'),listTeams:async()=>[{id:'b',name:'Team B',owner_user_id:'me'},{id:'a',name:'Team A',owner_user_id:'me'}],loadRoster:async id=>{loads.push(id);return answers[loads.length-1]();}};
 w.fetch=async url=>{if(url==='/api/config')return {ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})};throw Error('Offline');};w.setInterval=()=>0;stubDialogs(w);
 try{
  w.eval(code);await flush();
  const q=id=>w.document.getElementById(id),manual=()=>w.document.querySelector('[data-manual-entry]')?.textContent||'';
  const choose=async id=>{const select=w.document.querySelector('select[aria-label="Team"]');select.value=id;select.dispatchEvent(new w.Event('change'));await flush();};
  q('setup-button').click();await observed(w,()=>/B private roster/.test(manual()),'automatic team B roster');
  await choose('a');
  await choose('b');await observed(w,()=>/B private roster/.test(manual()),'team B roster');
  slowA.resolve([profile('A confidential roster','a-player')]);await flush();
  assert.deepEqual(loads,['b','a','b']);
  assert.match(manual(),/Selected team: Team B/);
  assert.match(manual(),/B private roster/);
  assert.doesNotMatch(manual(),/A confidential roster/,'a late roster for A never shows under team B');

  await choose('a');assert.deepEqual(loads,['b','a','b','a']);
  authCallback(null,'SIGNED_OUT');await observed(w,()=>q('session-code').textContent==='Local','signed out');
  await observed(w,()=>!/B private roster|A confidential roster|My private name/.test(w.document.body.textContent),'signout erases private data');
  // Sign back in and reopen Setup before the old request answers: its rows must not reach the new session.
  authCallback({user:{id:'me'}},'SIGNED_IN');await observed(w,()=>/My private name/.test(q('team-roster').textContent),'signed back in');
  q('setup-button').click();
  await observed(w,()=>/B private roster/.test(manual()),'team B roster after signing back in');
  slowAfterLogout.resolve([profile('Late confidential teammate','late')]);await flush();
  q('setup-button').click();await flush();
  assert.deepEqual(loads,['b','a','b','a','b']);
  assert.doesNotMatch(w.document.body.textContent,/Late confidential teammate|A confidential roster/);
 }finally{dom.window.close();}
});
