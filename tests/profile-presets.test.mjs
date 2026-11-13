import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';

// Test profile interactions through the actual compiled application. Public
// network data stays pending so defaults are stable and no external data leaks.
const built=await build({logLevel:'silent',plugins:[{name:'profile-public-data',enforce:'pre',load(id){
 if(id.replaceAll('\\','/').endsWith('/web/data.js'))return 'export const publicData={request:()=>new Promise(()=>{})};export const loadHeroes=()=>new Promise(()=>{});export const loadPlayer=()=>globalThis.__profileImport||new Promise(()=>{});';
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const html=await readFile('web/index.html','utf8');
async function harness(profile,importResult){
 const dom=new JSDOM(html,{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.__profileImport=importResult;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 if(profile)w.localStorage.setItem('captain-practice-v1',JSON.stringify({profile,state:{actions:[],firstPick:true,roster:[]}}));
 w.eval(code);await settle();
 const q=id=>w.document.getElementById(id);
 const click=async node=>{assert.ok(node,'expected profile control exists');assert.equal(node.closest('[hidden]'),null,'clicked control must be in visible panel');node.click();await settle();};
 const button=(text,root=q('profile-dialog'))=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const saved=()=>JSON.parse(w.localStorage.getItem('captain-practice-v1')).profile;
 await click(q('profile-button'));
 return {dom,w,q,click,button,saved};
}
async function settle(){await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));}

test('click-only profile presets save roles, comfort and separate hero preferences',async()=>{
 const h=await harness();try{
 const root=h.q('profile-content'),picker=kind=>root.querySelector(`.profile-hero-picker[data-kind="${kind}"]`),hero=kind=>picker(kind).querySelector('.profile-hero-suggestions button');
 assert.equal(root.querySelector('input[type=number]'),null,'comfort does not require number typing');
 await h.click(h.button('Support',root.querySelector('.profile-role-presets')));
 assert.deepEqual([...root.querySelectorAll('.profile-role-card .profile-role-toggle input')].map(c=>c.checked),[false,false,false,true,true]);
 root.querySelectorAll('.profile-role-expertise')[3].open=true;
 const comfort=root.querySelectorAll('.profile-role-card')[3].querySelector('.profile-comfort input[value="5"]');await h.click(comfort);assert.equal(comfort.checked,true);
 assert.ok(hero('signature').querySelector('img'),'signature choices include portraits before typing a search');
 assert.equal(picker('signature').hidden,false);assert.equal(picker('desired').hidden,true);assert.equal(picker('avoid').hidden,true);
 const signature=hero('signature');await h.click(signature);assert.equal(picker('desired').querySelectorAll('.profile-hero-suggestions [aria-pressed=true]').length,0,'signature selection does not imply desire today');
 await h.click(h.button('Today'));assert.equal(picker('signature').hidden,true);assert.equal(picker('desired').hidden,false);assert.equal(h.button('Today').getAttribute('aria-selected'),'true');await h.click(hero('desired'));await h.click(h.button('Save profile'));
 const first=h.saved();assert.deepEqual(first.preferredRoles,[4,5]);assert.equal(first.roleComfort[4],5);assert.equal(first.signatureHeroes.length,1);assert.equal(first.desiredHeroes.length,1);
 await h.click(h.q('profile-button'));assert.deepEqual(h.saved(),first,'opening dialog must not alter saved profile');assert.equal(root.querySelectorAll('.profile-role-card')[3].querySelector('.profile-comfort input[value="5"]').checked,true);
 await h.click(h.button('Today'));assert.equal(picker('desired').hidden,false);await h.click(h.button('Clear today'));assert.equal(picker('desired').querySelectorAll('.profile-hero-chips button').length,0);
 await h.click(h.button('Use signatures for today'));await h.click(h.button('Save profile'));assert.deepEqual(h.saved().desiredHeroes,h.saved().signatureHeroes);
 }finally{h.dom.window.close();}
});

test('opening existing profiles preserves comfort, roles and hero preferences',async()=>{
 const profile={displayName:'Existing player',steamAccountId:'',preferredRoles:[2],roleComfort:{1:1,2:5,3:2,4:3,5:4},signatureHeroes:[1,2],desiredHeroes:[3],avoidHeroes:[4],notes:'Keep my choices',availability:'maybe'};
 const h=await harness(profile);try{
 assert.deepEqual(h.saved(),profile);assert.equal(h.q('profile-role-2').checked,true);
 await h.click(h.button('Save profile'));assert.deepEqual(h.saved(),profile);
 }finally{h.dom.window.close();}
});



test('role preset undo restores prior comfort and preferences',async()=>{
 const profile={preferredRoles:[2],roleComfort:{1:1,2:5,3:2,4:3,5:4},signatureHeroes:[],desiredHeroes:[],avoidHeroes:[]};
 const h=await harness(profile);try{
 const root=h.q('profile-content');await h.click(h.button('Support'));await h.click(h.button('Undo preset'));
 assert.deepEqual([...root.querySelectorAll('.profile-role-toggle input')].map(c=>c.checked),[false,true,false,false,false]);
 assert.deepEqual([...root.querySelectorAll('.profile-comfort input:checked')].map(c=>+c.value),[1,5,2,3,4]);
 assert.equal(h.button('Undo preset').hidden,true);
 }finally{h.dom.window.close();}
});

test('copying an oversized saved signature list preserves Today without silent truncation',async()=>{
 const profile={displayName:'Legacy list',preferredRoles:[],roleComfort:{},signatureHeroes:Array.from({length:13},(_,i)=>i+1),desiredHeroes:[20,21],avoidHeroes:[]};
 const h=await harness(profile);try{
 await h.click(h.button('Today'));const panel=h.q('profile-content').querySelector('[data-kind=desired]');assert.equal(panel.hidden,false);
 await h.click(h.button('Use signatures for today'));assert.match(h.q('profile-dialog').querySelector('.profile-save-status').textContent,/more than 12/);
 assert.equal(panel.querySelectorAll('.profile-hero-chips button').length,2);assert.deepEqual(h.saved(),profile);
 }finally{h.dom.window.close();}
});


test('import waits before saving and seeds empty Today with editable signature suggestions',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const h=await harness({displayName:'Steam 42',steamAccountId:'42',preferredRoles:[],signatureHeroes:[],desiredHeroes:[],avoidHeroes:[]},pending);
 try{
  const save=h.button('Save profile');assert.equal(save.disabled,true,'saving waits for automatic public import');
  finish({id:'42',profile:{profile:{personaname:'Public Friend'}},heroes:[{hero_id:1,games:25},{hero_id:8,games:10}],sources:{heroes:{status:'updated'}}});await settle();
  assert.equal(save.disabled,false);assert.equal(h.q('profile-content').querySelector('input').value,'Public Friend');
  assert.equal(h.q('profile-content').querySelectorAll('[data-kind=signature] .profile-hero-chips button').length,2);
  assert.equal(h.q('profile-content').querySelectorAll('[data-kind=signature] .profile-hero-suggestions [aria-pressed=true]').length,2);
  await h.click(save);assert.deepEqual(h.saved().signatureHeroes,[1,8]);assert.deepEqual(h.saved().desiredHeroes,[1,8]);
 }finally{h.dom.window.close();}
});

test('selected heroes stay in the table across role presets and import keeps existing Today',async()=>{
 const h=await harness({displayName:'Friend',steamAccountId:'42',preferredRoles:[4,5],signatureHeroes:[1,8],desiredHeroes:[44],avoidHeroes:[]},Promise.resolve({id:'42',heroes:[{hero_id:2,games:10}],sources:{heroes:{status:'updated'}}}));
 try{
  const root=h.q('profile-content');assert.equal(root.querySelectorAll('[data-kind=signature] .profile-hero-suggestions [aria-pressed=true]').length,2);
  await h.click(h.button('Support'));assert.equal(root.querySelectorAll('[data-kind=signature] .profile-hero-suggestions [aria-pressed=true]').length,2);
  await h.click(h.button('Import public stats'));await h.click(h.button('Save profile'));assert.deepEqual(h.saved().desiredHeroes,[44]);assert.deepEqual(h.saved().signatureHeroes,[1,8]);
 }finally{h.dom.window.close();}
});
