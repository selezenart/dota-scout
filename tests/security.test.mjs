import test from 'node:test';
import assert from 'node:assert/strict';
import {boardCode} from './build-board.js';
import {BACKEND_STUB,flush,observed,boardWindow,stubDialogs} from './board-harness.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('team selection ignores stale roster responses and signout erases pending private data',async()=>{
 const code=await boardCode({'/web/backend.js':BACKEND_STUB});
 const dom=boardWindow(),w=dom.window;
 const slowA=deferred(),slowAfterLogout=deferred();let authCallback,loadCount=0;
 const profile=(name,id)=>({userId:id,displayName:name,availability:'available',preferredRoles:[],signatureHeroes:[]});
 w.__backend={getSession:async()=>({user:{id:'me'}}),onAuthChange:fn=>authCallback=fn,loadProfile:async()=>profile('My private name','me'),listTeams:async()=>[{id:'a',name:'Team A',owner_user_id:'me'},{id:'b',name:'Team B',owner_user_id:'me'}],loadRoster:id=>{loadCount++;return id==='a'?(loadCount===1?slowA.promise:slowAfterLogout.promise):Promise.resolve([profile('B private roster','b-player')]);}};
 w.fetch=async url=>{if(url==='/api/config')return {ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})};throw Error('Offline');};w.setInterval=()=>0;stubDialogs(w);
 try{
  w.eval(code);await flush();
  const q=id=>w.document.getElementById(id),manual=()=>w.document.querySelector('[data-manual-entry]')?.textContent||'';
  q('setup-button').click();await observed(w,()=>w.document.querySelector('select[aria-label="Team"]'),'team picker');
  const select=w.document.querySelector('select[aria-label="Team"]');
  select.value='a';select.dispatchEvent(new w.Event('change'));await flush();
  select.value='b';select.dispatchEvent(new w.Event('change'));await observed(w,()=>/B private roster/.test(manual()),'team B roster');
  slowA.resolve([profile('A confidential roster','a-player')]);await flush();
  assert.match(w.document.querySelector('[data-manual-entry]').textContent,/B private roster/);
  assert.doesNotMatch(w.document.querySelector('[data-manual-entry]').textContent,/A confidential roster/);
  const current=w.document.querySelector('select[aria-label="Team"]');current.value='a';current.dispatchEvent(new w.Event('change'));await flush();
  authCallback(null,'SIGNED_OUT');await observed(w,()=>q('session-code').textContent==='Local','signed out');slowAfterLogout.resolve([profile('Late confidential teammate','late')]);await flush();
  assert.doesNotMatch(w.document.body.textContent,/B private roster|A confidential roster|My private name|Late confidential teammate/);
  assert.equal(q('session-code').textContent,'Local');
 }finally{dom.window.close();}
});
