import test from 'node:test';
import assert from 'node:assert/strict';
import {boardCode} from './build-board.js';
import {BACKEND_STUB,dataStub,flush as flushRounds,observed,openBoard} from './board-harness.js';
import {CM_ORDER} from '../web/draft-engine.js';
const code=await boardCode({'/web/backend.js':BACKEND_STUB,'/web/data.js':dataStub({loadHeroes:'()=>new Promise(()=>{})',loadPlayer:'()=>new Promise(()=>{})'})});
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const flush=()=>flushRounds(1);
async function harness({query='?draft='+id,row,profile,config}={}){
 const calls=[];
 let auth;let current=row||{id,team_id:'team',revision:0,drafter_user_id:'owner',state:{actions:[],firstPick:true,enemyIds:[42],roster:[{id:'owner',userId:'owner',displayName:'Captain',availability:'available'}]}};
 const backend={getSession:async()=>({user:{id:'owner'}}),onAuthChange:fn=>auth=fn,loadProfile:async()=>profile||{},listTeams:async()=>[{id:'team',name:'Audit team',owner_user_id:'owner'}],loadRoster:async()=>[{userId:'owner',displayName:'Captain',availability:'available'},{userId:'sub',displayName:'Sub',availability:'available'}],getDraft:async()=>structuredClone(current),mutateDraft:async(_id,rev,op,payload)=>{calls.push({op,payload:structuredClone(payload)});let state=structuredClone(current.state);if(op==='append')state.actions.push(payload);if(op==='undo')state.actions.pop();if(op==='set_state')state={...state,...payload};current={...current,revision:rev+1,state};return structuredClone(current);},saveProfile:async p=>p};
 const {dom,w,q,button}=await openBoard(code,{query,settle:flush,fetch:config||(async()=>({ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})})),
  beforeRun:w=>{w.__backend=backend;w.HTMLElement.prototype.scrollIntoView=function(){};}});
 const click=async n=>{assert.ok(n,'control exists');assert.equal(n.closest('[hidden]'),null,'control is visible');n.click();await flush();};
 const label=(prefix,root=w.document)=>[...root.querySelectorAll('label')].find(l=>l.textContent.startsWith(prefix))?.querySelector('input,textarea');
 return {dom,w,q,calls,button,click,label,backend,auth:()=>auth,poll:async()=>{w.dispatchEvent(new w.Event('focus'));await flush();},row:()=>current};
}

test('home to practice isolates shared writes, persists signed-in practice and Back restores shared mode',async()=>{
 const h=await harness({row:{id,team_id:'team',revision:1,drafter_user_id:'owner',state:{actions:[{heroId:1,mode:'ourBan'}],firstPick:true,roster:[]}}});try{
 await h.click(h.q('home-button'));await h.click(h.q('welcome-practice'));assert.match(h.q('connection-status').textContent,/Practice/);assert.match(h.q('turn-progress').textContent,/^0 \/ 24/);
 await h.click(h.q('hero-groups').querySelector('button'));await h.click(h.q('suggestions').querySelector('button.primary'));assert.equal(h.calls.length,0,'practice never mutates shared backend');
 assert.ok(Object.keys(h.w.localStorage).some(key=>{try{return JSON.parse(h.w.localStorage.getItem(key))?.state?.actions?.length===1;}catch{return false;}}),'signed-in practice is stored');
 const home=observed(h.w,()=>h.w.document.body.dataset.view==='welcome','Back restores welcome');h.w.history.back();await home;const restored=observed(h.w,()=>h.q('session-code').textContent==='aaaaaaaa','Back restores shared draft');h.w.history.back();await restored;assert.equal(h.q('turn-progress').textContent.startsWith('1 / 24'),true);
 }finally{h.dom.window.close();}
});

test('reopened roster selection starts from draft and previews removal before submission',async()=>{
 const h=await harness();try{await h.poll();await h.click(h.q('setup-button'));const manual=h.w.document.querySelector('[data-manual-entry]');const checks=[...manual.querySelectorAll('input[type=checkbox]')];assert.equal(checks[0].checked,true);assert.equal(checks[1].checked,false);checks[0].click();await h.click(h.button('Refresh draft roster snapshot'));assert.match(h.q('session-dialog').textContent,/remov.*Captain|Captain.*remov/i);assert.equal(h.calls.length,0);await h.click(h.button('Apply roster refresh'));assert.deepEqual(h.calls.at(-1)?.payload.roster,[]);}finally{h.dom.window.close();}
});

test('Team shortcuts cannot undo or type into hidden draft search',async()=>{
 const row={id,team_id:'team',revision:1,drafter_user_id:'owner',state:{actions:[{mode:'ourBan',heroId:1}],firstPick:true,roster:[]}};const h=await harness({row});try{await h.click(h.q('team-button'));h.w.document.body.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));h.w.document.body.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'x',bubbles:true,cancelable:true}));await flush();assert.equal(h.calls.length,0);assert.equal(h.q('hero-search').value,'');assert.match(h.q('turn-progress').textContent,/1 \/ 24/);}finally{h.dom.window.close();}
});

test('invalid scouting tokens retain prior enemy IDs and report in the lobby',async()=>{
 const h=await harness();try{await h.click(h.q('setup-button'));const input=h.label('Enemy public');input.value='42 invalid-player';await h.click(h.button('Save and scout enemies'));assert.equal(h.calls.length,0);assert.deepEqual(h.row().state.enemyIds,[42]);assert.match(h.q('session-dialog').textContent,/invalid-player/);assert.equal(input.getAttribute('aria-invalid'),'true');}finally{h.dom.window.close();}
});

test('unchanged polls retain focused hero and assignment controls',async()=>{
 const h=await harness();try{const tile=h.q('hero-groups').querySelector('button');tile.focus();await h.poll();assert.equal(h.w.document.activeElement,tile);assert.equal(tile.isConnected,true);}finally{h.dom.window.close();}
});

test('invalid session feedback is inside the modal and seat CTA reaches applicable control',async()=>{
 const h=await harness();try{await h.click(h.q('setup-button'));h.q('session-input').value='bad-session';await h.click(h.q('join-session'));assert.match(h.q('session-dialog').textContent,/valid draft UUID|valid.*session/i);assert.equal(h.q('session-input').getAttribute('aria-invalid'),'true');h.q('session-dialog').close();await h.click(h.q('drafter-seat'));assert.equal(h.w.document.activeElement,h.q('release-drafter'));}finally{h.dom.window.close();}
});

test('completed draft retains chosen hero-board view across polls and labels recorded turns',async()=>{
 const actions=CM_ORDER.map((step,i)=>({mode:(step.team==='A'?'our':'enemy')+step.action,heroId:i+1}));const row={id,team_id:'team',revision:24,drafter_user_id:'owner',state:{actions,firstPick:true,roster:[]}};
 const h=await harness({row});try{assert.equal(h.q('analysis').hidden,false);assert.match(h.q('timeline').querySelector('.tree-row').getAttribute('aria-label')||'',/Turn 1.*our ban/i);await h.click(h.button('Show hero board'));await h.poll();assert.equal(h.q('analysis').hidden,true);assert.ok(h.button('Show draft review'),'explicit route returns to review');}finally{h.dom.window.close();}
});

test('profile toggles preserve focus, tabs navigate with arrows and manual changes clear presets',async()=>{
 const h=await harness({query:'?practice'});try{await h.click(h.q('profile-button'));const root=h.q('profile-content');const tile=root.querySelector('.profile-hero-suggestions button');tile.focus();await h.click(tile);assert.equal(h.w.document.activeElement.textContent,tile.textContent);assert.equal(h.w.document.activeElement.closest('.profile-hero-suggestions')!==null,true);
 const tabs=[...root.querySelectorAll('[role=tab]')];tabs[0].focus();tabs[0].dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(h.w.document.activeElement,tabs[1]);assert.equal(tabs[1].getAttribute('aria-selected'),'true');assert.equal(tabs.filter(t=>t.tabIndex===0).length,1);
 await h.click(h.button('Support',root));await h.click(root.querySelector('#profile-role-4'));assert.equal(h.button('Support',root).getAttribute('aria-pressed'),'false');
 }finally{h.dom.window.close();}
});

test('profile overlap identifies heroes and navigates to Avoid',async()=>{
 const h=await harness({query:'?practice',profile:{displayName:'Captain',preferredRoles:[],roleComfort:{},signatureHeroes:[1],desiredHeroes:[],avoidHeroes:[1]}});try{await h.click(h.q('profile-button'));await h.click(h.button('Save profile'));const root=h.q('profile-content');assert.match(h.q('profile-dialog').querySelector('.profile-save-status').textContent,/Anti-Mage/);assert.equal(root.querySelector('[data-kind=avoid]').hidden,false);assert.equal(h.w.document.activeElement.closest('[data-kind=avoid]')!==null,true);}finally{h.dom.window.close();}
});

test('initial auth checking cannot become a persistent unavailable error once ready',async()=>{
 let finish;const config=new Promise(resolve=>finish=resolve);const h=await harness({query:'',config:()=>config});try{
 await h.click(h.q('welcome-signin'));const form=h.q('welcome-auth').querySelector('form');form.querySelector('[type=email]').value='captain@example.com';form.querySelector('[type=password]').value='password';form.requestSubmit();await flush();assert.doesNotMatch(form.textContent,/service unavailable/i);assert.match(form.textContent,/checking|availability/i);
 h.backend.getSession=async()=>null;const ready=observed(h.w,()=>form.querySelector('.auth-message').textContent==='','configuration ready');finish({ok:true,json:async()=>({url:'https://example.supabase.co',anonKey:'public'})});await ready;await flush();
 assert.doesNotMatch(h.q('welcome-auth').textContent,/unavailable/i);h.backend.signIn=async()=>{throw Error('Wrong password');};form.requestSubmit();await flush();assert.match(form.textContent,/Wrong password/);
 }finally{h.dom.window.close();}
});
