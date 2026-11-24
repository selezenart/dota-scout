import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';
import {PublicQueue,loadPlayer} from '../web/data.js';
import {reduceDraft,initialState} from '../web/demo.js';
import {publicConfig} from '../api/config.js';
import {CM_ORDER} from '../web/draft-engine.js';

test('public configuration rejects privileged keys and URL credentials',()=>{
 const jwt=role=>'e30.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.sig';
 assert.deepEqual(publicConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:jwt('service_role')}),{});
 assert.deepEqual(publicConfig({SUPABASE_URL:'https://user:pass@example.com',SUPABASE_ANON_KEY:jwt('anon')}),{});
 assert.equal(publicConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30)}).url,'https://example.supabase.co');
});
test('queue coalesces public requests, caps concurrency and retries rate limits',async()=>{
 let active=0,max=0,calls=0,retry=0;const waits=[];
 const queue=new PublicQueue({storage:null,sleep:async ms=>{waits.push(ms);},fetcher:async url=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;if(url.endsWith('/players/1')&&!retry++)return {status:429,headers:{get:()=> '2'}};return {ok:true,json:async()=>({ok:true})};}});
 const a=queue.request('/players/1');assert.equal(a,queue.request('/players/1'));
 await Promise.all([a,queue.request('/players/2'),queue.request('/players/3')]);assert.ok(max<=2);assert.equal(calls,4);assert.deepEqual(waits,[2000]);
 await queue.request('/players/1');assert.equal(calls,4);
 await assert.rejects(queue.request('/auth/token'));
});
test('rolling quota reserves at most the configured starts per window',async()=>{
 let now=0;const starts=[];const queue=new PublicQueue({storage:null,limit:2,windowMs:100,sleep:async ms=>{now+=ms;},now:()=>now,fetcher:async()=>{starts.push(now);return {ok:true,json:async()=>[]};}});
 await Promise.all([1,2,3,4,5].map(id=>queue.request('/players/'+id)));
 assert.equal(starts.length,5);for(let i=2;i<starts.length;i++)assert.ok(starts[i]-starts[i-2]>=100);
});
test('player fetch is partially usable when sources are private or fail',async()=>{
 const queue={request:async path=>{if(path.endsWith('/42'))return {};if(path.includes('recentMatches'))throw Error('Unavailable');return [{hero_id:1,games:12}];}};
 const player=await loadPlayer(42,()=>{},queue);assert.equal(player.sources.profile.status,'private');assert.equal(player.sources.recent.status,'error');assert.equal(player.heroes[0].games,12);
});
test('local actions enforce control, uniqueness, assignment locks and completion',()=>{
 const heroes=Object.fromEntries(Array.from({length:25},(_,i)=>[i+1,{id:i+1}]));let state=initialState();
 assert.throws(()=>reduceDraft(state,'append',{heroId:1,mode:'ourBan'},{heroes,canWrite:false}));
 state=reduceDraft(state,'append',{heroId:1,mode:'ourBan'},{heroes,canWrite:true});assert.throws(()=>reduceDraft(state,'append',{heroId:1,mode:'ourBan'},{heroes,canWrite:true}));
 assert.equal(reduceDraft(state,'undo',{}, {canWrite:true}).actions.length,0);
});
test('DOM integration stages and confirms manually, undoes, resets and renders 24 rows',async()=>{
 const result=await build({logLevel:'silent',build:{write:false,minify:false}});
 const js=result.output.find(o=>o.type==='chunk'&&o.isEntry).code;
 const html=await readFile('web/index.html','utf8');const dom=new JSDOM(html,{url:'https://board.example/?demo',runScripts:'outside-only'});const w=dom.window;
 w.fetch=async()=>{throw Error('Offline test');};w.setInterval=()=>0;w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(js);await new Promise(r=>setTimeout(r,10));
 const q=id=>w.document.getElementById(id),click=async node=>{node.click();await new Promise(r=>setTimeout(r,5));};
 assert.equal(q('timeline').querySelectorAll('.tree-row').length,24);assert.match(q('connection-status').textContent,/Demo/);
 assert.equal(q('suggestions').querySelector('details.decision-evidence').open,false);
 assert.ok(q('suggestions').querySelector('.decision-candidates').querySelectorAll('.rec-row').length<=6);
 const recommended=q('suggestions').querySelector('.rec-row');assert.ok(recommended);await click(recommended);
 assert.ok(q('suggestions').querySelector('.decision-reason'));assert.equal(q('timeline').querySelectorAll('.is-recorded').length,0,'staging never records an action');
 await click(q('suggestions').querySelector('.clear-staged'));assert.equal(q('suggestions').querySelector('.rec-feature'),null);assert.equal(q('timeline').querySelectorAll('.is-recorded').length,0);assert.equal(w.document.activeElement,q('hero-search'));

 await click(q('hero-groups').querySelector('.hero-tile:not(:disabled)'));assert.match(q('turn-progress').textContent,/0 \/ 24/);
 await click(q('suggestions').querySelector('button.primary'));assert.match(q('turn-progress').textContent,/1 \/ 24/);
 await click(q('undo'));assert.match(q('turn-progress').textContent,/0 \/ 24/);
 for(let i=0;i<24;i++){await click(q('hero-groups').querySelector('.hero-tile:not(:disabled)'));await click(q('suggestions').querySelector('button.primary'));}
 assert.equal(q('turn-label').textContent,'Draft complete');assert.equal(q('analysis').hidden,false);assert.equal(q('our-lineup').children.length,5);
 await click(q('reset-draft'));assert.match(q('turn-progress').textContent,/0 \/ 24/);dom.window.close();
});

test('shared controller confirms ownership, refetches conflicts without replay and clears on signout',async()=>{
 const result=await build({logLevel:'silent',plugins:[{name:'test-backend',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/web/backend.js'))return 'export const createBackend = () => globalThis.__backend;';}}],build:{write:false,minify:false}});
 const dom=new JSDOM(await readFile('web/index.html','utf8'),{url:'https://board.example/?draft=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',runScripts:'outside-only'}),w=dom.window;
 const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';let row={id,team_id:'team',revision:0,drafter_user_id:null,state:{actions:[],firstPick:true,enemyIds:[],roster:[{id:'user-a',displayName:'Private teammate',preferredRoles:[1],signatureHeroes:[1]}]}};let callback,calls=[],conflict=false;
 w.__backend={getSession:async()=>({user:{id:'user-a'}}),onAuthChange:fn=>{callback=fn;},loadProfile:async()=>({displayName:'Private own profile'}),listTeams:async()=>[{id:'team',name:'Test team',owner_user_id:'user-a'}],loadRoster:async()=>[],getDraft:async()=>structuredClone(row),mutateDraft:async(_id,rev,op,payload)=>{calls.push(op);assert.equal(rev,row.revision);if(op==='claim')row={...row,drafter_user_id:'user-a',revision:row.revision+1};if(op==='append'){if(conflict){row={...row,revision:row.revision+1,state:{...row.state,actions:[{mode:'ourBan',heroId:2}]}};throw Error('revision conflict');}row={...row,revision:row.revision+1,state:{...row.state,actions:[...row.state.actions,payload]}};}return structuredClone(row);}};
 w.fetch=async url=>{if(url==='/api/config')return {ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})};throw Error('Offline');};w.setInterval=()=>0;w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(result.output.find(o=>o.type==='chunk'&&o.isEntry).code);const wait=()=>new Promise(r=>setTimeout(r,25));await wait();const q=id=>w.document.getElementById(id);
 assert.equal(q('claim-drafter').disabled,false);q('hero-groups').querySelector('.hero-tile:not(:disabled)').click();await wait();assert.equal(q('suggestions').querySelector('button.primary').disabled,true);assert.match(q('suggestions').querySelector('.decision-readonly').textContent,/Become drafter/);q('suggestions').querySelector('.clear-staged').click();await wait();assert.equal(q('suggestions').querySelector('.rec-feature'),null);assert.deepEqual(calls,[]);
 q('claim-drafter').click();await wait();assert.match(q('draft-owner').textContent,/Private teammate/);conflict=true;q('hero-groups').querySelector('.hero-tile:not(:disabled)').click();await wait();q('suggestions').querySelector('button.primary').click();await wait();assert.deepEqual(calls,['claim','append']);assert.match(q('turn-progress').textContent,/1 \/ 24/);assert.match(q('notice').textContent,/conflict/);
 callback(null,'SIGNED_OUT');await wait();assert.equal(q('session-code').textContent,'Local');assert.doesNotMatch(w.document.body.textContent,/Private teammate/);assert.match(q('turn-progress').textContent,/0 \/ 24/);dom.window.close();
});


async function welcomeHarness(query='',backend){
 const result=await build({logLevel:'silent',plugins:[{name:'welcome-backend',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/web/backend.js'))return 'export const createBackend = () => globalThis.__backend;';}}],build:{write:false,minify:false}});
 const dom=new JSDOM(await readFile('web/index.html','utf8'),{url:'https://board.example/'+query,runScripts:'outside-only'}),w=dom.window;
 assert.ok(w.document.getElementById('welcome-view'),'actual design markup includes welcome');
 w.__backend=backend;w.fetch=async url=>{if(backend&&url==='/api/config')return {ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})};throw Error('Offline');};w.setInterval=()=>0;w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.eval(result.output.find(o=>o.type==='chunk'&&o.isEntry).code);await new Promise(r=>setTimeout(r,25));return dom;
}
const settle=()=>new Promise(r=>setTimeout(r,25));
test('welcome is the default, practice and demo enter board, home typing is untouched',async()=>{
 const dom=await welcomeHarness(),w=dom.window,q=id=>w.document.getElementById(id);
 assert.equal(w.document.body.dataset.view,'welcome');w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'a',bubbles:true}));assert.equal(q('hero-search').value,'');
 q('welcome-signin').click();const form=q('welcome-auth').querySelector('form');assert.ok(form.querySelector('label input[type=email]'));form.querySelector('[type=email]').value='captain@example.com';form.querySelector('[type=password]').value='password';form.requestSubmit();await settle();assert.match(form.textContent,/unavailable/);assert.equal(w.document.body.dataset.view,'welcome');
 q('welcome-practice').click();assert.equal(w.document.body.dataset.view,'board');dom.window.close();
 for(const query of ['?demo','?practice']){const direct=await welcomeHarness(query);assert.equal(direct.window.document.body.dataset.view,'board');direct.window.close();}
});
test('configured register confirms email, signin opens deferred draft and recovery works on first session',async()=>{
 let callback,opened=0,finishSignup;const calls=[];const session={user:{id:'captain'}};
 const backend={getSession:async()=>null,onAuthChange:fn=>callback=fn,loadProfile:async()=>({}),listTeams:async()=>[],signUp:async(...args)=>{calls.push(args);return new Promise(resolve=>{finishSignup=resolve;});},signIn:async()=>({session}),getDraft:async id=>{opened++;return {id,revision:0,state:initialState()};},updatePassword:async password=>calls.push(password)};
 const dom=await welcomeHarness('?draft=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',backend),w=dom.window,q=id=>w.document.getElementById(id);
 assert.equal(opened,0);q('welcome-register').click();let form=q('welcome-auth').querySelector('form');const inputs=form.querySelectorAll('input');inputs[0].value='Captain';inputs[1].value='captain@example.com';inputs[2].value='password';form.requestSubmit();await settle();assert.deepEqual(calls[0],['captain@example.com','password','Captain','/']);assert.ok(form.querySelector('button[data-loading=true]').disabled);finishSignup({session:null});await settle();assert.match(form.textContent,/confirm your account/);assert.match(form.textContent,/captain@example.com/);assert.equal(inputs[2].value,'');assert.equal(form.querySelector('[type=password]'),null);
 q('welcome-signin').click();form=q('welcome-auth').querySelector('form');form.querySelector('[type=email]').value='captain@example.com';form.querySelector('[type=password]').value='password';form.requestSubmit();await settle();assert.equal(opened,1);assert.equal(w.document.body.dataset.view,'board');assert.equal(q('welcome-auth').children.length,0);dom.window.close();
 const recovery=await welcomeHarness('',backend);callback(session,'PASSWORD_RECOVERY');await settle();const r=recovery.window.document.querySelector('.auth-form');assert.match(r.textContent,/Choose a new password/);r.querySelector('input').value='new-password';r.requestSubmit();await settle();assert.equal(calls.at(-1),'new-password');recovery.window.close();
});


test('board search supports arrows, empty feedback, native button activation and mutation clearing',async()=>{
 const dom=await welcomeHarness('?practice'),w=dom.window,q=id=>w.document.getElementById(id),search=q('hero-search');
 search.value='zzzzzz';search.dispatchEvent(new w.Event('input'));assert.match(q('hero-groups').textContent,/No heroes match/);
 search.value='';search.dispatchEvent(new w.Event('input'));search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const highlighted=q('hero-groups').querySelector('.is-highlighted').getAttribute('aria-label');
 search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await settle();assert.match(q('suggestions').querySelector('.decision-dock h3').textContent,new RegExp(highlighted));
 const confirm=q('suggestions').querySelector('button.primary'),native=new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});confirm.dispatchEvent(native);assert.equal(native.defaultPrevented,false);
 search.value=highlighted;search.dispatchEvent(new w.Event('input'));confirm.click();await settle();assert.equal(search.value,'');assert.match(q('turn-progress').textContent,/1 \/ 24/);
 q('team-button').click();assert.equal(q('team-button').getAttribute('aria-current'),'page');assert.equal(q('draft-button').hasAttribute('aria-current'),false);dom.window.close();
});


test('redesign sorts heroes alphabetically, records portraits and preserves explicit role choices',async()=>{
 const fixture={1:{id:1,name:'npc_dota_hero_antimage',localized_name:'Alpha',primary_attr:'agi',pub_pick:20},2:{id:2,name:'npc_dota_hero_axe',localized_name:'Zulu',primary_attr:'agi',pub_pick:900},3:{id:3,name:'npc_dota_hero_bane',localized_name:'Beta',primary_attr:'agi',pub_pick:20},4:{id:4,name:'npc_dota_hero_bloodseeker',localized_name:'Absent',primary_attr:'agi'},5:{id:5,name:'npc_dota_hero_crystal_maiden',localized_name:'Strength low',primary_attr:'str',pub_pick:1},6:{id:6,name:'npc_dota_hero_drow_ranger',localized_name:'Strength high',primary_attr:'str',pub_pick:100}};
 for(let id=7;id<=20;id++)fixture[id]={...fixture[1],id,primary_attr:'all',localized_name:'Hero '+id};
 const result=await build({logLevel:'silent',plugins:[{name:'popularity-fixture',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/web/data.js'))return `export const publicData={request:()=>({then(fn){globalThis.__stats=fn;return {catch(){}};}})};export const loadHeroes=()=>new Promise(resolve=>globalThis.__constants=resolve);export const loadPlayer=async()=>({});`;if(id.replaceAll('\\','/').endsWith('/web/heroes.json'))return JSON.stringify(fixture);}}],build:{write:false,minify:false}});
 const dom=new JSDOM(await readFile('web/index.html','utf8'),{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>{throw Error('Offline');};w.setInterval=()=>0;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(result.output.find(o=>o.type==='chunk'&&o.isEntry).code);await settle();const q=id=>w.document.getElementById(id),click=async n=>{n.click();await settle();},ids=attr=>[...w.document.querySelectorAll(`[data-attribute="${attr}"] .hero-tile`)].map(n=>+n.dataset.heroId);
 assert.deepEqual(ids('agi'),[4,1,3,2]);assert.deepEqual(ids('str'),[6,5]);
 w.__stats([{id:1,pub_pick:1000}]);await settle();w.__constants(Object.fromEntries(Object.entries(fixture).map(([id,h])=>{const {pub_pick,...constant}=h;return [id,constant];})));await settle();assert.deepEqual(ids('agi'),[4,1,3,2]);assert.match(w.document.querySelector('[data-hero-id="1"]').title,/1[,. ]000/);
 assert.equal(w.document.querySelectorAll('.tree-row').length,24);const turns=[...q('timeline').querySelectorAll('.tree-row')].map(row=>row.getAttribute('aria-label')).sort((a,b)=>Number(a.match(/^Turn (\d+)/)[1])-Number(b.match(/^Turn (\d+)/)[1]));CM_ORDER.forEach((step,index)=>assert.match(turns[index],new RegExp('^Turn '+(index+1)+', '+(step.team==='A'?'our':'enemy')+' '+step.action.toLowerCase())));assert.equal(q('timeline').querySelectorAll('.tree-turn.phase-start').length,6);const orderedRows=[...q('timeline').querySelectorAll('.tree-turn')];assert.equal(orderedRows.length,24);CM_ORDER.forEach((step,index)=>{const row=orderedRows[index];assert.equal(row.dataset.side,step.team==='A'?'our':'enemy');assert.match(row.querySelector('.tree-row').getAttribute('aria-label'),new RegExp('^Turn '+(index+1)+','));assert.equal(Number(row.querySelector('.tree-number').textContent),index+1);});assert.equal(w.document.querySelectorAll('.is-current').length,1);assert.ok(w.document.querySelector('.tree-placeholder [aria-hidden="true"]'));
 await click(w.document.querySelector('[data-hero-filter="str"]'));assert.deepEqual(ids('str'),[6,5]);assert.equal(ids('agi').length,0);
 await click(w.document.querySelector('[data-hero-filter="all-attr"]'));assert.equal(ids('all').length,14);assert.equal(ids('str').length,0);
 await click(w.document.querySelector('[data-hero-filter="recommended"]'));assert.ok([...q('hero-groups').querySelectorAll('.hero-tile')].every(tile=>tile.classList.contains('is-recommended')));
 assert.equal(w.document.querySelector('[data-hero-filter="recommended"]').getAttribute('aria-pressed'),'true');
 await click(w.document.querySelector('[data-hero-filter="all"]'));
 for(let i=0;i<7;i++){await click(q('hero-groups').querySelector('.hero-tile:not(:disabled)'));await click(q('suggestions').querySelector('.primary'));}

 assert.equal(w.document.querySelectorAll('.tree-row.is-recorded .tree-hero').length,7);await click(q('timeline').querySelector('.tree-row[data-turn="0"]'));assert.match(q('history-inspect').textContent,/Our ban.*turn 1/);assert.equal(q('timeline').querySelectorAll('.tree-row:disabled').length,16);assert.equal(w.document.querySelectorAll('.tree-row[data-action="ban"] .tree-hero').length,7);
 await click(q('hero-groups').querySelector('.hero-tile:not(:disabled)'));const picker=q('suggestions').querySelector('fieldset.position-picker');assert.equal(picker.querySelector('legend').textContent,'Assign position');assert.equal(picker.querySelectorAll('input[type=radio]').length,5);
 const key=new w.KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true});picker.dispatchEvent(key);assert.equal(key.defaultPrevented,false);const arrow=new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true});picker.querySelector('input').dispatchEvent(arrow);assert.equal(arrow.defaultPrevented,false);await click(picker.querySelector('[value="4"]'));q('hero-search').value='Hero';q('hero-search').dispatchEvent(new w.Event('input'));w.__stats([{id:1,pub_pick:1001}]);await settle();assert.equal(q('suggestions').querySelector('[value="4"]').checked,true);
 await click(q('suggestions').querySelector('.primary'));const saved=JSON.parse(w.localStorage.getItem('captain-practice-v1'));assert.equal(saved.state.actions.at(-1).position,4);assert.equal(w.document.querySelectorAll('.tree-row[data-action="pick"] .tree-hero').length,1);
 // The next allied pick cannot reuse P4, and clearing an automatic suggestion stays explicit after a render.
 while(!q('turn-label').textContent.startsWith('Our pick')){await click(q('hero-groups').querySelector('.hero-tile:not(:disabled)'));await click(q('suggestions').querySelector('.primary'));}
 await click(q('hero-groups').querySelector('.hero-tile:not(:disabled)'));assert.equal(q('suggestions').querySelector('[value="4"]').disabled,true);await click(q('suggestions').querySelector('.position-auto'));w.__stats([{id:1,pub_pick:1002}]);await settle();assert.equal(q('suggestions').querySelector('input:checked'),null);await click(q('suggestions').querySelector('.primary'));assert.equal(JSON.parse(w.localStorage.getItem('captain-practice-v1')).state.actions.at(-1).position,undefined);
 await click(q('profile-button'));assert.equal(w.document.querySelectorAll('.profile-role-card').length,5);for(const input of w.document.querySelectorAll('.profile-role-card input'))assert.ok(w.document.querySelector(`label[for="${input.id}"]`));dom.window.close();
});

test('allied picks prioritize available unassigned teammates wanted heroes within each attribute',async()=>{
 const fixture=Object.fromEntries(Array.from({length:30},(_,i)=>{const id=i+1;return [id,{id,name:'npc_dota_hero_axe',localized_name:'Hero '+id,primary_attr:'agi',pub_pick:id===9?1000:id===11?500:id===8?1:id===10?2:100}];}));
 const result=await build({logLevel:'silent',plugins:[{name:'wanted-fixture',enforce:'pre',load(id){const path=id.replaceAll('\\','/');if(path.endsWith('/web/heroes.json'))return JSON.stringify(fixture);if(path.endsWith('/web/data.js'))return 'export const publicData={request:async()=>[]};export const loadHeroes=()=>new Promise(()=>{});export const loadPlayer=async()=>({});';}}],build:{write:false,minify:false}});
 const dom=new JSDOM(await readFile('web/index.html','utf8'),{url:'https://board.example/?practice',runScripts:'outside-only'}),w=dom.window;
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{...initialState(),actions:CM_ORDER.slice(0,7).map((step,i)=>({mode:(step.team==='A'?'our':'enemy')+step.action,heroId:i+1})),roster:[{id:'waiting',displayName:'Waiting player',desiredHeroes:[8,10],signatureHeroes:[8],availability:'available'},{id:'away',displayName:'Absent player',desiredHeroes:[11],availability:'unavailable'}]}}));
 w.fetch=async()=>{throw Error('Offline');};w.setInterval=()=>0;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 try{
  w.eval(result.output.find(o=>o.type==='chunk'&&o.isEntry).code);await settle();const q=id=>w.document.getElementById(id),click=async node=>{assert.ok(node);node.click();await settle();};
  const ids=()=>[...q('hero-groups').querySelectorAll('.hero-tile')].map(tile=>+tile.dataset.heroId);
  const names=()=>[...q('hero-groups').querySelectorAll('.hero-tile>span')].map(n=>n.textContent),assertAlphabetical=()=>assert.deepEqual(names(),[...names()].sort((a,b)=>a.localeCompare(b)));
  assertAlphabetical();assert.equal(q('hero-groups').querySelector('[data-hero-id="8"]').classList.contains('is-wanted'),true);assert.equal(q('hero-groups').querySelector('[data-hero-id="11"]').classList.contains('is-wanted'),false);
  await click(q('hero-groups').querySelector('[data-hero-id="8"]'));const reasons=q('suggestions').querySelector('details.decision-reasons');assert.ok(reasons);assert.equal(reasons.open,false);assert.match(reasons.querySelector('summary').textContent,/Why this hero/);reasons.open=true;assert.ok(reasons.querySelectorAll('p').length>0);
  const player=q('assigned-player');player.value='waiting';player.dispatchEvent(new w.Event('change'));
  await click(q('suggestions').querySelector('.primary'));
  assertAlphabetical();
  for(const heroId of [30,29,28,27,26]){await click(q('hero-groups').querySelector('[data-hero-id="'+heroId+'"]'));await click(q('suggestions').querySelector('.primary'));}
  assert.match(q('turn-label').textContent,/Our pick/);assertAlphabetical();assert.equal(q('hero-groups').querySelector('[data-hero-id="10"]').classList.contains('is-wanted'),false,'assigned player no longer boosts remaining wishlist');
  const roster=q('team-roster');assert.ok([...roster.querySelectorAll('h2')].some(h=>h.textContent==='Our team'));assert.ok(roster.querySelector('img'));
 }finally{w.close();}
});
