import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {JSDOM} from 'jsdom';

const input=fileURLToPath(new URL('../web/onboarding-demo.js',import.meta.url));
const built=await build({logLevel:'silent',build:{
 write:false,
 rollupOptions:{input,output:{format:'iife',name:'OnboardingDemo'}},
}});
const code=built.output.find(item=>item.type==='chunk'&&item.isEntry).code;
const markup=await readFile('web/index.html','utf8');

function start(saved={},fetcher){
 const {window}=new JSDOM(markup,{url:'https://board.example/?onboarding-demo',runScripts:'outside-only'});
 const requests=[];
 window.fetch=async url=>{requests.push(url);if(fetcher)return fetcher(url);throw Error('Configuration API is offline');};
 window.localStorage.setItem('captain-practice-v1','existing practice');
 for(const [key,value] of Object.entries(saved))window.sessionStorage.setItem(key,value);
 window.eval(code);
 const root=window.document.getElementById('onboarding-demo');
 assert.ok(root);
 const action=(name,scope=root)=>{
  const control=scope.querySelector(`[data-demo-action="${name}"]`);
  assert.ok(control,`demo action ${name} exists`);
  assert.equal(control.closest('[hidden]'),null);
  control.click();
 };
 const field=label=>[...root.querySelectorAll('label')].find(item=>item.textContent.startsWith(label)).querySelector('input,select');
 const change=(control,value,event)=>{
  control.value=value;
  control.dispatchEvent(new window.Event(event,{bubbles:true}));
 };
 return {window,root,action,field,change,requests};
}

test('the demo completes without config or auth and saves only demo state through refresh',()=>{
 let saved;
 const h=start();
 try{
  assert.equal(h.window.document.getElementById('app-shell').hidden,true);
  assert.match(h.root.textContent,/Night Shift/);
  h.action('accept');
  assert.ok(h.field('Dota account link or Steam ID'));
  h.action('sample-account');
  assert.equal(h.root.querySelector('input[type=password]'),null);
  h.change(h.field('Display name'),'Demo Teammate','input');
  h.change(h.field('Sample email'),'invalid','input');
  h.action('signup');
  assert.ok(h.root.querySelector('[data-demo-action=signup]'));
  h.change(h.field('Sample email'),'demo@example.com','input');
  h.action('signup');
  assert.match(h.root.textContent,/demo@example.com/);
  assert.equal(h.root.querySelector('[data-demo-action=join]'),null);
  h.action('open-email');
  h.action('confirm');
  assert.match(h.root.textContent,/Welcome back, Demo Teammate/);
  assert.equal(h.root.querySelector('[data-demo-action=save-profile]'),null);
  h.action('join');
  h.root.querySelector('input[name="preferred-role"][value="Soft support"]').click();
  const signature=h.root.querySelector('[aria-label="Signature heroes"]');
  h.change(signature.querySelector('input'),'Rubick','input');
  assert.equal(signature.querySelector('[aria-label=Rubick]').getAttribute('aria-pressed'),'false');
  h.action('toggle-hero',signature);
  assert.equal(signature.querySelector('[aria-label=Rubick]').getAttribute('aria-pressed'),'true');
  saved={...h.window.sessionStorage};
  assert.deepEqual(h.requests,[]);
  assert.deepEqual({...h.window.localStorage},{'captain-practice-v1':'existing practice'});
 }finally{h.window.close();}

 const refreshed=start(saved);
 try{
  assert.equal(refreshed.root.querySelector('input[name="preferred-role"]:checked').value,'Soft support');
  assert.ok(refreshed.root.querySelector('[aria-label="Remove Rubick from signature heroes"]'));
  refreshed.action('save-profile');
  const roster=refreshed.root.querySelector('[aria-label="Captain roster preview"]');
  assert.equal(roster.querySelectorAll('article').length,5);
  const own=roster.querySelector('article');
  assert.match(own.textContent,/Demo Teammate · You/);
  assert.match(own.textContent,/Soft support/);
  assert.match(own.textContent,/Rubick/);
  assert.deepEqual(refreshed.requests,[]);
  assert.deepEqual({...refreshed.window.localStorage},{'captain-practice-v1':'existing practice'});
  refreshed.action('restart');
  assert.ok(refreshed.root.querySelector('[data-demo-action=accept]'));
 }finally{refreshed.window.close();}
});

const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const response=value=>({ok:true,status:200,json:async()=>value,headers:{get:()=>null}});
test('public import converts SteamID64 and keeps imported suggestions editable',async()=>{
 const h=start({},async url=>{
  if(url.endsWith('/players/123456789'))return response({profile:{personaname:'Public Player'}});
  if(url.includes('/heroes?'))return response([{hero_id:86,games:50},{hero_id:8,games:90},{hero_id:999999,games:500}]);
  return response([]);
 });
 try{
  h.action('accept');
  h.change(h.field('Dota account link or Steam ID'),'76561198083722517','input');
  h.action('import-account'); await flush();
  assert.equal(h.field('Display name').value,'Public Player');
  assert.equal(h.requests.length,4);
  assert.ok(h.requests.every(url=>url.startsWith('https://api.opendota.com/api/players/123456789')));
  const state=JSON.parse(h.window.sessionStorage.getItem('captain-onboarding-demo-v2'));
  assert.deepEqual(state.signature,[8,86]);assert.deepEqual(state.desired,[]);assert.equal(state.accountId,'123456789');
  h.action('signup');h.action('open-email');h.action('confirm');h.action('join');
  assert.match(h.root.textContent,/Most-played heroes are suggested signatures/);
  h.change(h.field('Display name'),'Edited Player','input');
  h.root.querySelector('input[name="preferred-role"][value="Soft support"]').click();
  h.action('save-profile');assert.match(h.root.textContent,/Edited Player/);
 }finally{h.window.close();}
});
test('invalid and vanity account inputs avoid requests and manual setup has no invented signatures',()=>{
 const h=start();try{
  h.action('accept');
  for(const input of ['https://evil.example/123456789','https://steamcommunity.com/id/friend','123 456']){
   h.change(h.field('Dota account link or Steam ID'),input,'input');h.action('import-account');
   assert.ok(h.root.querySelector('[data-demo-action=import-account]'));assert.equal(h.requests.length,0);
  }
  h.action('manual-account');
  const state=JSON.parse(h.window.sessionStorage.getItem('captain-onboarding-demo-v2'));
  assert.deepEqual(state.signature,[]);assert.deepEqual(state.desired,[]);
 }finally{h.window.close();}
});

test('failed public sources remain on import with a retry and manual continuation',async()=>{
 const h=start({},async()=>{throw Error('Network unavailable');});try{
  h.action('accept');h.change(h.field('Dota account link or Steam ID'),'123456789','input');
  h.action('import-account');await flush();
  assert.ok(h.root.querySelector('[data-demo-action=import-account]'));
  assert.match(h.root.textContent,/could not|unable|try again/i);
  assert.equal(h.requests.length,4);
  h.action('manual-account');assert.ok(h.field('Display name'));
 }finally{h.window.close();}
});

test('role cards and hero browsing filters support click-only profile editing',()=>{
 const h=start();try{
  h.action('accept');h.action('sample-account');h.action('signup');h.action('open-email');h.action('confirm');h.action('join');
  const role=h.root.querySelector('input[name="preferred-role"][value="Mid"]');role.click();assert.equal(role.checked,true);
  const signature=h.root.querySelector('[aria-label="Signature heroes"]');
  const desired=h.root.querySelector('[aria-label="Want to play"]');
  const filter=(section,label)=>[...section.querySelectorAll('[data-demo-action=filter-heroes]')].find(button=>button.textContent===label).click();
  filter(signature,'Strength');assert.ok(signature.querySelector('[data-demo-action=toggle-hero][aria-label=Axe]'));assert.equal(signature.querySelector('[data-demo-action=toggle-hero][aria-label=Juggernaut]'),null);
  filter(signature,'Selected');assert.equal(signature.querySelectorAll('[data-demo-action=toggle-hero]').length,2);
  h.action('copy-signatures',desired);assert.ok(desired.querySelector('[aria-label="Remove Juggernaut from want to play"]'));
  filter(desired,'Selected');assert.equal(desired.querySelectorAll('[data-demo-action=toggle-hero]').length,2);
  h.action('clear-heroes',desired);assert.equal(desired.querySelectorAll('[data-demo-action=toggle-hero]').length,0);
  filter(desired,'All');assert.ok(desired.querySelectorAll('[data-demo-action=toggle-hero]').length>100);
  const firstSix=[...desired.querySelectorAll('[data-demo-action=toggle-hero]')].slice(0,6).map(button=>button.getAttribute('aria-label'));
  for(const label of firstSix)desired.querySelector('[data-demo-action=toggle-hero][aria-label="'+label+'"]').click();
  assert.equal(desired.querySelectorAll('[data-demo-action=remove-hero]').length,5);assert.match(desired.querySelector('.od-selection-count').textContent,/5 \/ 5 selected/);
  assert.match(h.root.querySelector('[role=status]').textContent,/up to five/);
  const removed=desired.querySelector('[data-demo-action=remove-hero]');removed.focus();removed.click();assert.equal(h.window.document.activeElement.isConnected,true);assert.equal(desired.contains(h.window.document.activeElement),true);
  filter(desired,'Selected');const toggled=desired.querySelector('[data-demo-action=toggle-hero]');toggled.focus();toggled.click();assert.equal(h.window.document.activeElement.isConnected,true);assert.equal(desired.contains(h.window.document.activeElement),true);
  h.action('save-profile');assert.match(h.root.querySelector('[aria-label="Captain roster preview"] article').textContent,/Mid/);
 }finally{h.window.close();}
});
