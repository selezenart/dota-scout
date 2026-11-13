import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBoard as build} from './build-board.js';
import {JSDOM} from 'jsdom';

// Compile the real entrypoint once; replace only network boundaries.
const built=await build({logLevel:'silent',plugins:[{name:'flow-boundaries',enforce:'pre',load(id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(path.endsWith('/web/data.js'))return `export const publicData={request:async()=>[]};export const loadHeroes=()=>new Promise(()=>{});export const loadPlayer=async(id,progress)=>{const p={id:String(id),name:'Public '+id,sources:{profile:{status:'private'},recent:{status:'error',message:'Unavailable'},heroes:{status:'ok'}},heroes:[{hero_id:1,games:12}]};progress(p);return p;};`;
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const markup=await readFile('web/index.html','utf8');
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const draftId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
// Auth notifications deliberately cross a timer boundary in the app. Observe the
// actual DOM transition instead of assuming one event-loop flush finishes it.
function waitForText(window,node,expected){
 if(node.textContent===expected)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{observer.disconnect();reject(Error('Timed out waiting for '+expected+'; saw '+node.textContent));},2000);
  const observer=new window.MutationObserver(()=>{if(node.textContent===expected){clearTimeout(timeout);observer.disconnect();resolve();}});
  observer.observe(node,{childList:true,subtree:true,characterData:true});
 });
}
async function harness({query='?practice',backend,saved,local={},session={},clipboard}={}){
 const dom=new JSDOM(markup,{url:'https://board.example/'+query,runScripts:'outside-only'}),w=dom.window;
 w.__backend=backend;w.fetch=async()=>({ok:true,json:async()=>backend?{url:'https://example.supabase.co',anonKey:'public'}:{}});
 w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const [key,value] of Object.entries(local))w.localStorage.setItem(key,value);
 for(const [key,value] of Object.entries(session))w.sessionStorage.setItem(key,value);
 if(clipboard)Object.defineProperty(w.navigator,'clipboard',{value:{writeText:clipboard}});
 if(saved)w.localStorage.setItem('captain-practice-v1',saved);
 w.eval(code);await flush();
 const q=id=>w.document.getElementById(id);
 const click=async node=>{assert.ok(node,'control exists');node.click();await flush();};
 const button=(text,root=w.document)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 return {dom,w,q,click,button};
}
function accountBackend(extra={}){return {getSession:async()=>({user:{id:'owner'}}),onAuthChange(){},loadProfile:async()=>({displayName:'Captain'}),listTeams:async()=>[],...extra};}

test('header signout handles failure, blocks duplicate clicks and clears the account on success',async()=>{
 let fail=true,finish,calls=0;
 const h=await harness({backend:accountBackend({signOut:async()=>{calls++;if(fail)throw Error('Sign out unavailable');await new Promise(resolve=>{finish=resolve;});}})});
 try{
  const control=h.q('signout-button');assert.equal(control.hidden,false);
  await h.click(control);assert.match(h.q('notice').textContent,/Sign out unavailable/);assert.equal(control.disabled,false);assert.equal(control.hidden,false);
  fail=false;await h.click(control);assert.equal(control.disabled,true);assert.equal(control.textContent,'Signing out…');await h.click(control);assert.equal(calls,2);
  finish();await flush();assert.equal(control.hidden,true);assert.equal(h.w.document.body.dataset.view,'welcome');
  assert.equal(h.q('profile-dialog').open,false);
 }finally{h.w.close();}
});

const inviteCode='a'.repeat(64);
const inviteKey='captain-team-invite-v1';
const invitedTeam={id:'invited-team',name:'Night Shift',owner_user_id:'owner'};
const guestSession={user:{id:'guest'}};

test('team home cards show saved roles, signatures and wanted heroes',async()=>{
 const rows=[{userId:'owner',displayName:'Captain',preferredRoles:[1,3],signatureHeroes:[1],desiredHeroes:[2]},{userId:'mate',displayName:'Mate',preferredRoles:[],signatureHeroes:[],desiredHeroes:[]}];
 const h=await harness({query:'',backend:accountBackend({listTeams:async()=>[invitedTeam],loadRoster:async()=>rows})});
 try{
  await flush();
  const cards=[...h.q('team-roster').querySelectorAll('.player-card')];
  const captain=cards.find(card=>card.querySelector('h3').textContent==='Captain');
  assert.ok(captain,'captain card rendered');
  assert.notEqual(captain.querySelector('.player-role-summary').textContent,'Role preferences not set');
  const strips=captain.querySelectorAll('.roster-hero-strip');
  assert.equal(strips[0].querySelectorAll('img, .hero-portrait, div').length>0,true);
  assert.doesNotMatch(strips[0].textContent,/Not set/);
  assert.doesNotMatch(strips[1].textContent,/Not set/);
  const mate=cards.find(card=>card.querySelector('h3').textContent==='Mate');
  assert.equal(mate.querySelector('.player-role-summary').textContent,'Role preferences not set');
 }finally{h.w.close();}
});

test('team owner copies a shareable invite URL distinct from the draft link',async()=>{
 let copied;
 const backend=accountBackend({listTeams:async()=>[{...invitedTeam,invite_code:inviteCode}],loadRoster:async()=>[]});
 const h=await harness({backend,clipboard:async text=>{copied=new URL(text);}});
 try{
  await h.click(h.q('setup-button'));
  const select=h.w.document.querySelector('select[aria-label=Team]');
  select.value=invitedTeam.id;
  select.dispatchEvent(new h.w.Event('change'));
  await flush();
  await h.click(h.button('Copy team invite link'));
  assert.equal(copied.origin,h.w.location.origin);
  assert.equal(copied.pathname,'/');
  assert.equal(copied.searchParams.has('draft'),false);
  assert.equal(new URLSearchParams(copied.hash.slice(1)).get('invite'),inviteCode);
 }finally{h.w.close();}
});

test('registering with an invite survives a confirmation tab and requires an explicit join before profile setup',async()=>{
 let storage,registration,callback,save,attempts=0,joined=false,finishJoin;
 const backend=accountBackend({
  getSession:async()=>null,
  onAuthChange:fn=>{callback=fn;},
  signUp:async(...args)=>{registration=args;return {session:null};},
  loadProfile:async()=>null,
  listTeams:async()=>joined?[invitedTeam]:[],
  joinTeam:async (code,account)=>{
   assert.equal(code,inviteCode);
   assert.equal(account,guestSession.user.id);
   if(++attempts===1)throw Error('Invitation temporarily unavailable');
   await new Promise(resolve=>{finishJoin=resolve;});
   joined=true;
   return invitedTeam;
  },
  loadRoster:async id=>{assert.equal(id,invitedTeam.id);return [];},
  saveProfile:async profile=>{save=structuredClone(profile);return profile;},
 });
 const guest=await harness({query:'#invite='+inviteCode,backend});
 try{
  const invite=guest.q('welcome-auth');
  assert.match(invite.textContent,/Team invitation/);
  assert.equal(guest.w.location.href.includes(inviteCode),false);
  await guest.click(guest.button('Create account',invite));
  const form=invite.querySelector('form');
  form.querySelector('[autocomplete=name]').value='New Teammate';
  form.querySelector('[type=email]').value='teammate@example.com';
  form.querySelector('[type=password]').value='example-password';
  form.requestSubmit();
  await flush();
  assert.match(form.textContent,/confirm your account/);
  assert.deepEqual(registration,['teammate@example.com','example-password','New Teammate','/']);
  assert.equal(attempts,0);
  storage={...guest.w.localStorage};
 }finally{guest.w.close();}

 // A confirmation opens the root URL in another tab on the same origin.
 const confirmed=await harness({query:'',backend,local:storage});
 try{
  const invite=confirmed.q('welcome-auth');
  callback(guestSession,'SIGNED_IN');
  await flush();
  assert.match(invite.textContent,/Team invitation/);
  assert.equal(attempts,0);
  await confirmed.click(confirmed.button('Join team',invite));
  assert.match(invite.textContent,/Invitation temporarily unavailable/);
  const retry=confirmed.button('Join team',invite);
  await confirmed.click(retry);
  retry.click();
  assert.equal(attempts,2);
  finishJoin();
  await flush();
  assert.equal(confirmed.q('profile-dialog').open,true);
  const profile=confirmed.q('profile-content');
  profile.querySelector('input').value='New Teammate';
  profile.querySelector('#profile-role-4').checked=true;
  await confirmed.click(confirmed.button('Save profile',confirmed.q('profile-dialog')));
  assert.equal(save.displayName,'New Teammate');
  assert.deepEqual(save.preferredRoles,[4]);
  assert.match(confirmed.q('profile-dialog').textContent,/Profile saved/);
  assert.equal(confirmed.q('profile-dialog').open,false);
  assert.equal(confirmed.q('team-view').hidden,false);
  assert.equal(new URL(confirmed.w.location.href).searchParams.has('team'),true);
  await confirmed.click(confirmed.q('setup-button'));
  assert.equal(confirmed.w.document.querySelector('select[aria-label=Team]').value,invitedTeam.id);
  storage={...confirmed.w.localStorage};
 }finally{confirmed.w.close();}

 const reloaded=await harness({query:'',backend:{...backend,getSession:async()=>guestSession,loadProfile:async()=>save},local:storage});
 try{
  assert.equal(reloaded.q('profile-dialog').open,false);
  assert.doesNotMatch(reloaded.q('welcome-auth').textContent,/Team invitation/);
  assert.equal(attempts,2);
 }finally{reloaded.w.close();}
});

test('an invitation response from a signed-out account cannot select a team for the next account',async()=>{
 let callback,finishJoin,calls=0;
 const backend=accountBackend({
  getSession:async()=>guestSession,
  onAuthChange:fn=>{callback=fn;},
  joinTeam:async()=>{calls++;return new Promise(resolve=>{finishJoin=resolve;});},
  signOut:async()=>callback(null,'SIGNED_OUT'),
 });
 const h=await harness({query:'?invite='+inviteCode,backend});
 try{
  const invite=h.q('welcome-auth');
  assert.equal(h.w.location.search,'');
  await h.click(h.button('Join team',invite));
  assert.equal(calls,1);
  callback(null,'SIGNED_OUT');
  await flush();
  assert.ok(h.button('Sign in',invite));
  callback({user:{id:'second-account'}},'SIGNED_IN');
  await flush();
  finishJoin(invitedTeam);
  await flush();
  assert.equal(h.q('profile-dialog').open,false);
  assert.ok(h.button('Join team',invite));
  await h.click(h.button('Decline invitation',invite));
  assert.doesNotMatch(invite.textContent,/Team invitation/);
  assert.equal(calls,1);
 }finally{h.w.close();}
});

test('an invited teammate signing into an existing account returns to the explicit join prompt',async()=>{
 let signIns=0,joins=0;
 const backend=accountBackend({
  getSession:async()=>null,
  signIn:async()=>{signIns++;return {session:guestSession};},
  joinTeam:async()=>{joins++;return invitedTeam;},
 });
 const h=await harness({query:'#invite='+inviteCode,backend});
 try{
  const invite=h.q('welcome-auth');
  await h.click(h.button('Sign in',invite));
  const form=invite.querySelector('form');
  form.querySelector('[type=email]').value='teammate@example.com';
  form.querySelector('[type=password]').value='example-password';
  form.requestSubmit();
  await flush();
  assert.equal(signIns,1);
  assert.equal(joins,0);
  assert.equal(invite.hidden,false);
  assert.ok(h.button('Join team',invite));
 }finally{h.w.close();}
});

test('invite URL cleanup preserves an auth callback and declining leaves newer tab storage intact',async()=>{
 const authHash='#access_token=fixture-token&type=signup';
 const h=await harness({query:'?invite='+inviteCode+authHash,backend:accountBackend({getSession:async()=>null})});
 try{
  assert.equal(h.w.location.search,'');
  assert.equal(h.w.location.hash,authHash);
  assert.equal(JSON.parse(h.w.localStorage.getItem(inviteKey)).code,inviteCode);
  const newerCode='b'.repeat(64);
  h.w.localStorage.setItem(inviteKey,JSON.stringify({code:newerCode,until:Date.now()+60000}));
  await h.click(h.button('Decline invitation',h.q('welcome-auth')));
  assert.equal(JSON.parse(h.w.localStorage.getItem(inviteKey)).code,newerCode);
  assert.equal(h.q('welcome-auth').hidden,true);
 }finally{h.w.close();}
});

test('expired or malformed invite links cannot create a membership',async()=>{
 let calls=0;
 const backend=accountBackend({
  joinTeam:async()=>{calls++;throw Object.assign(Error('RPC detail'),{code:'22023'});},
 });
 const malformed=await harness({query:'#invite=invalid',backend});
 try{
  const invite=malformed.q('welcome-auth');
  assert.match(invite.textContent,/invalid/);
  assert.equal(malformed.w.location.hash,'');
  assert.equal(malformed.button('Join team',invite),undefined);
  assert.equal(malformed.w.localStorage.getItem(inviteKey),null);
 }finally{malformed.w.close();}
 const expired=await harness({query:'#invite='+inviteCode,backend});
 try{
  const invite=expired.q('welcome-auth');
  await expired.click(expired.button('Join team',invite));
  assert.match(invite.textContent,/invalid or expired/);
  assert.doesNotMatch(invite.textContent,/RPC detail/);
  assert.equal(expired.q('profile-dialog').open,false);
  assert.equal(calls,1);
  assert.equal(expired.w.localStorage.getItem(inviteKey),null);
  await expired.click(expired.button('Continue to Battle Cup',invite));
  assert.equal(expired.q('cup-view').hidden,false);
 }finally{expired.w.close();}
});

test('account errors stay visible after connection setup and submitting can retry',async()=>{
 let finish,calls=0;
 const backend=accountBackend({getSession:()=>new Promise(r=>finish=r),signIn:async()=>{calls++;throw Object.assign(Error('Email not confirmed'),{code:'email_not_confirmed'});}});
 const h=await harness({query:'',backend});try{
 await h.click(h.q('welcome-signin'));const f=h.q('welcome-auth').querySelector('form');f.querySelector('[type=email]').value='captain@example.com';f.querySelector('[type=password]').value='password';f.requestSubmit();await flush();
 assert.match(f.textContent,/Confirm the email for captain@example.com/);finish(null);await flush();assert.match(f.textContent,/Confirm the email for captain@example.com/);assert.equal(f.querySelector('[type=submit]').disabled,false);
 f.requestSubmit();await flush();assert.equal(calls,2);
 }finally{h.dom.window.close();}
});

test('local profile and first-pick choice survive reload; scouting retains partial source errors',async()=>{
 const h=await harness();let saved;try{
 h.q('first-pick').checked=false;h.q('first-pick').dispatchEvent(new h.w.Event('change'));await flush();assert.equal(h.q('turn-label').textContent,'Enemy ban');
 await h.click(h.q('profile-button'));const root=h.q('profile-content');root.querySelector('input').value='Local Captain';root.querySelectorAll('input')[1].value='42';root.querySelector('#profile-role-4').checked=true;await h.click(h.button('Save profile',h.q('profile-dialog')));assert.match(h.q('team-roster').textContent,/Local Captain/);assert.match(h.q('team-roster').textContent,/recent: error/);assert.match(h.q('team-roster').textContent,/profile: private/);saved=h.w.localStorage.getItem('captain-practice-v1');
 }finally{h.dom.window.close();}
 const reloaded=await harness({saved});try{assert.equal(reloaded.q('first-pick').checked,false);await reloaded.click(reloaded.q('profile-button'));assert.equal(reloaded.q('profile-content').querySelector('input').value,'Local Captain');assert.equal(reloaded.q('profile-role-4').checked,true);}finally{reloaded.dom.window.close();}
});

test('team creation and joining preserve an explicit roster selection when creating shared draft',async()=>{
 let teams=[],created,joined;const roster=[{userId:'owner',displayName:'Captain',availability:'available'},{userId:'sub',displayName:'Substitute',availability:'available'},{userId:'away',displayName:'Absent',availability:'unavailable'}];
 const backend=accountBackend({listTeams:async()=>teams,createTeam:async name=>{teams=[{id:'team',name,owner_user_id:'owner'}];return teams[0];},joinTeam:async code=>{joined=code;return teams[0];},loadRoster:async()=>roster,createDraft:async(id,state)=>{created=structuredClone(state);return {id:draftId};},getDraft:async()=>({id:draftId,team_id:'team',revision:0,state:created})});
 const h=await harness({backend});try{
 await h.click(h.q('setup-button'));const manual=h.w.document.querySelector('[data-manual-entry]');const named=label=>[...manual.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input');named('New team name').value='Five';await h.click(h.button('Create team'));assert.equal(h.q('create-session').disabled,false);
 named('Team invitation code').value='invite-code';await h.click(h.button('Join team'));assert.equal(joined,'invite-code');
 const checks=[...manual.querySelectorAll('input[type=checkbox]')];assert.deepEqual(checks.map(c=>c.checked),[true,true,false]);checks[1].click();checks[2].click();await h.click(h.q('create-session'));
 assert.deepEqual(created.roster.map(p=>p.id),['owner','away']);assert.equal(h.q('session-code').textContent,'aaaaaaaa');
 }finally{h.dom.window.close();}
});

test('shared claim release reclaim and polling disconnect enforce confirmed authority',async()=>{
 let callback,offline=false;const calls=[];let row={id:draftId,team_id:'team',revision:0,drafter_user_id:null,state:{actions:[],firstPick:true,roster:[]}};
 const backend=accountBackend({onAuthChange:fn=>callback=fn,listTeams:async()=>[{id:'team',name:'Team',owner_user_id:'owner'}],loadRoster:async()=>[],getDraft:async()=>{if(offline)throw Error('Offline');return structuredClone(row);},mutateDraft:async(id,revision,op)=>{assert.equal(revision,row.revision);calls.push(op);row={...row,revision:row.revision+1,drafter_user_id:op==='release'?null:'owner'};return structuredClone(row);},signOut:async()=>callback(null,'SIGNED_OUT')});
 const h=await harness({query:'?draft='+draftId,backend});try{
 assert.equal(h.q('session-code').textContent,'aaaaaaaa');await h.click(h.q('claim-drafter'));assert.match(h.q('draft-owner').textContent,/controls/);await h.click(h.q('release-drafter'));assert.match(h.q('draft-owner').textContent,/Seat available/);await h.click(h.q('claim-drafter'));
 await h.click(h.q('setup-button'));await h.click(h.button('Owner reclaim drafter'));assert.deepEqual(calls,['claim','release','claim','assign']);h.q('session-dialog').close();
 offline=true;h.w.dispatchEvent(new h.w.Event('focus'));await flush();assert.match(h.q('connection-status').textContent,/reconnecting/);assert.equal(h.q('reset-draft').disabled,true);offline=false;h.w.dispatchEvent(new h.w.Event('online'));await flush();assert.equal(h.q('reset-draft').disabled,false);
 await h.click(h.q('profile-button'));const signedOut=waitForText(h.w,h.q('session-code'),'Local');await h.click(h.button('Sign out'));await signedOut;assert.equal(h.q('session-code').textContent,'Local');assert.equal(h.w.location.search,'');assert.equal(h.w.document.body.dataset.view,'welcome');
 }finally{h.dom.window.close();}
});


test('newer draft-open intent wins when responses arrive out of order',async()=>{
 const older='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',newer='cccccccc-cccc-cccc-cccc-cccccccccccc';
 const requests=new Map();
 const backend=accountBackend({getDraft:id=>new Promise(resolve=>requests.set(id,resolve))});
 const h=await harness({backend});try{
 await h.click(h.q('setup-button'));h.q('session-input').value=older;await h.click(h.q('join-session'));
 h.q('session-input').value=newer;await h.click(h.q('join-session'));
 assert.deepEqual([...requests.keys()],[older,newer]);
 const opened=waitForText(h.w,h.q('session-code'),'cccccccc');requests.get(newer)({id:newer,revision:0,state:{actions:[],firstPick:true,roster:[]}});await opened;
 requests.get(older)({id:older,revision:0,state:{actions:[],firstPick:false,roster:[]}});await flush();
 assert.equal(h.q('session-code').textContent,'cccccccc');assert.equal(h.q('first-pick').checked,true);assert.equal(new URL(h.w.location.href).searchParams.get('draft'),newer);
 }finally{h.dom.window.close();}
});


test('shared draft invitation survives an OAuth return to Cup and explains guest sign-in',async()=>{
 const guest=await harness({query:'?draft='+draftId,backend:{getSession:async()=>null,onAuthChange(){}}});
 try{
  assert.equal(guest.w.sessionStorage.getItem('captain-pending-draft'),draftId);
  assert.match(guest.q('welcome-auth').textContent,/invited to a shared draft/);
  assert.ok(guest.q('welcome-auth').querySelector('input[type=email]'));
 }finally{guest.dom.window.close();}
 let requested;
 const h=await harness({query:'?cup',session:{'captain-pending-draft':draftId},backend:accountBackend({getDraft:async id=>{requested=id;return {id,team_id:'team',revision:0,state:{actions:[],roster:[]}};}})});
 try{
  assert.equal(requested,draftId);
  assert.equal(new URL(h.w.location.href).searchParams.get('draft'),draftId);
  assert.equal(h.w.sessionStorage.getItem('captain-pending-draft'),null);
 }finally{h.dom.window.close();}
});


test('guest invitation shows the previewed team name without joining',async()=>{
 let token;
 const h=await harness({query:'#invite='+inviteCode,backend:{
  getSession:async()=>null,onAuthChange(){},
  previewTeamInvitation:async code=>{token=code;return 'Night Shift';},
 }});
 try{
  assert.equal(token,inviteCode);
  assert.equal(h.q('team-invite-heading').textContent,'Join Night Shift');
  assert.equal(h.button('Join team',h.q('welcome-auth')),undefined);
  assert.equal(h.w.location.hash,'');
 }finally{h.w.close();}
});

test('player replay follows all 24 captain actions without gaining draft control',async()=>{
 const h=await harness({query:'?demo&player'});
 try{
  assert.equal(h.q('claim-drafter').hidden,true);
  assert.equal(h.q('undo').disabled,true);
  assert.equal(h.q('first-pick').disabled,true);
  const advance=h.button('Show next captain action');
  for(let i=0;i<24;i++)await h.click(advance);
  assert.match(h.q('turn-progress').textContent,/24 \/ 24/);
  assert.equal(advance.disabled,true);
  assert.equal(h.q('our-lineup').querySelectorAll('img').length,5);
  assert.equal(h.q('enemy-lineup').querySelectorAll('img').length,5);
  await h.click(h.button('Restart replay'));
  assert.match(h.q('turn-progress').textContent,/0 \/ 24/);
 }finally{h.w.close();}
});



test('authenticated home centers the captain and offers identity editing only to the owner',async()=>{
 const squad={id:'team',name:'Night Shift',owner_user_id:'captain'};
 const roster=['one','two','captain','four','five'].map(id=>({userId:id,displayName:id,signatureHeroes:[1],avatarHeroId:8}));
 for(const id of ['captain','one']){
  const h=await harness({query:'',backend:accountBackend({
   getSession:async()=>({user:{id}}),listTeams:async()=>[squad],
   loadRoster:async()=>roster,listTeamIdentity:async()=>[],setTeamIdentity:async()=>{},
  })});
  try{
   assert.equal(h.q('team-view').hidden,false);
   assert.equal(h.q('team-title').textContent,'Night Shift');
   const cards=h.q('team-home').querySelectorAll('.team-home-card');
   assert.equal(cards.length,5);
   assert.equal(cards[2].dataset.captain,'true');
   assert.match(h.q('team-identity').textContent,/Submit proposal/);
   assert.equal(h.q('team-identity').textContent.includes('Save team identity'),id==='captain');
  }finally{h.w.close();}
 }
 const solo=await harness({query:'',backend:accountBackend()});
 try{
  assert.equal(solo.q('team-home').querySelectorAll('.team-home-card').length,1);
  assert.match(solo.q('team-home').textContent,/Create or join a team/);
 }finally{solo.w.close();}
});


test('first Steam sign-in requires profile setup before Team opens',async()=>{
 let saved;
 const h=await harness({query:'',backend:accountBackend({
  getSession:async()=>({user:{id:'steam-user',user_metadata:{steam_account_id:'123'}}}),
  loadProfile:async()=>({displayName:'Steam nickname',steamAccountId:'123',preferredRoles:[]}),
  saveProfile:async profile=>{saved=profile;return profile;},
 })});
 try{
  const dialog=h.q('profile-dialog');
  assert.equal(dialog.open,true);
  assert.equal(h.q('app-shell').dataset.profileSetup,'true');
  assert.equal(h.q('team-view').hidden,true);
  const submit=h.button('Save profile',dialog);
  await h.click(submit);
  assert.equal(saved,undefined);
  assert.equal(dialog.open,true);
  h.q('profile-role-1').click();
  await h.click(submit);
  assert.deepEqual(Array.from(saved.preferredRoles),[1]);
  assert.equal(dialog.open,false);
  assert.equal(h.q('team-view').hidden,false);
 }finally{h.w.close();}
});

test('captain can remove a teammate from Team home after confirming',async()=>{
 const squad={id:'team',name:'Night Shift',owner_user_id:'owner'};
 let removed;
 const h=await harness({query:'',backend:accountBackend({
  listTeams:async()=>[squad],
  loadRoster:async()=>[{userId:'owner',displayName:'Captain'},{userId:'player',displayName:'Lee'}],
  removeTeamMember:async(...args)=>{removed=args;},
 })});
 try{
  const root=h.q('team-home');
  root.querySelector('details').open=true;
  h.w.confirm=()=>false;
  await h.click(h.button('Remove Lee',root));
  assert.equal(removed,undefined);
  h.w.confirm=()=>true;
  await h.click(h.button('Remove Lee',root));
  assert.deepEqual(removed,['team','player','owner']);
  assert.equal(root.querySelectorAll('.team-home-card').length,1);
  assert.match(root.textContent,/Lee was removed/);
 }finally{h.w.close();}
});
