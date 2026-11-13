import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';

const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('team selection ignores stale roster responses and signout erases pending private data',async()=>{
 const compiled=await build({logLevel:'silent',plugins:[{name:'security-backend',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/web/backend.js'))return 'export const createBackend = () => globalThis.__backend;';}}],build:{write:false,minify:false}});
 const dom=new JSDOM(await readFile('web/index.html','utf8'),{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 const slowA=deferred(),slowAfterLogout=deferred();let authCallback,loadCount=0;
 const profile=(name,id)=>({userId:id,displayName:name,availability:'available',preferredRoles:[],signatureHeroes:[]});
 w.__backend={getSession:async()=>({user:{id:'me'}}),onAuthChange:fn=>authCallback=fn,loadProfile:async()=>profile('My private name','me'),listTeams:async()=>[{id:'a',name:'Team A',owner_user_id:'me'},{id:'b',name:'Team B',owner_user_id:'me'}],loadRoster:id=>{loadCount++;return id==='a'?(loadCount===1?slowA.promise:slowAfterLogout.promise):Promise.resolve([profile('B private roster','b-player')]);}};
 w.fetch=async url=>{if(url==='/api/config')return {ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})};throw Error('Offline');};w.setInterval=()=>0;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 try{
  w.eval(compiled.output.find(item=>item.type==='chunk'&&item.isEntry).code);await settle();
  const q=id=>w.document.getElementById(id);q('setup-button').click();await settle();
  const select=w.document.querySelector('select[aria-label="Team"]');
  select.value='a';select.dispatchEvent(new w.Event('change'));await settle();
  select.value='b';select.dispatchEvent(new w.Event('change'));await settle();
  slowA.resolve([profile('A confidential roster','a-player')]);await settle();
  assert.match(w.document.querySelector('[data-manual-entry]').textContent,/B private roster/);
  assert.doesNotMatch(w.document.querySelector('[data-manual-entry]').textContent,/A confidential roster/);
  const current=w.document.querySelector('select[aria-label="Team"]');current.value='a';current.dispatchEvent(new w.Event('change'));await settle();
  authCallback(null,'SIGNED_OUT');await settle();slowAfterLogout.resolve([profile('Late confidential teammate','late')]);await settle();
  assert.doesNotMatch(w.document.body.textContent,/B private roster|A confidential roster|My private name|Late confidential teammate/);
  assert.equal(q('session-code').textContent,'Local');
 }finally{dom.window.close();}
});
