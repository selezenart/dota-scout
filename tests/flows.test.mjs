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
async function harness({query='?practice',backend,saved,local={},session={},clipboard,beforeRun}={}){
 const dom=new JSDOM(markup,{url:'https://board.example/'+query,runScripts:'outside-only'}),w=dom.window;
 w.__backend=backend;w.fetch=async()=>({ok:true,json:async()=>backend?{url:'https://example.supabase.co',anonKey:'public'}:{}});
 w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const [key,value] of Object.entries(local))w.localStorage.setItem(key,value);
 for(const [key,value] of Object.entries(session))w.sessionStorage.setItem(key,value);
 if(clipboard)Object.defineProperty(w.navigator,'clipboard',{value:{writeText:clipboard}});
 if(saved)w.localStorage.setItem('captain-practice-v1',saved);
 beforeRun?.(w);
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
 const checks=[...manual.querySelectorAll('.team-management input[type=checkbox]')];assert.deepEqual(checks.map(c=>c.checked),[true,true,false]);checks[1].click();checks[2].click();await h.click(h.q('create-session'));
 assert.deepEqual(created.roster.map(p=>p.id),['owner','away']);assert.equal(h.q('session-code').textContent,'aaaaaaaa');
 }finally{h.dom.window.close();}
});

test('Setup preselects the signed-in team so shared draft creation is available',async()=>{
 const squad={id:'team',name:'Night Shift',owner_user_id:'owner'};
 const h=await harness({backend:accountBackend({listTeams:async()=>[squad],loadRoster:async()=>[{userId:'owner',displayName:'Captain',availability:'available'}]})});
 try{
  await h.click(h.q('setup-button'));
  assert.equal(h.q('create-session').disabled,false);
  assert.equal(h.q('create-session').textContent,'Create draft for Night Shift');
  assert.equal(h.w.document.querySelector('[data-manual-entry] select[aria-label=Team]').value,'team');
 }finally{h.w.close();}
});

test('Setup keeps typed text when the preselected team roster arrives late',async()=>{
 let release;const slow=new Promise(r=>release=r);
 const h=await harness({backend:accountBackend({listTeams:async()=>[{id:'team',name:'Night Shift',owner_user_id:'owner'}],loadRoster:()=>slow})});
 try{
  await h.click(h.q('setup-button'));
  const enemies=h.q('enemy-account-input');enemies.value='12345';enemies.dispatchEvent(new h.w.Event('input',{bubbles:true}));
  release([{userId:'owner',displayName:'Captain',availability:'available'}]);await flush();
  assert.equal(h.q('enemy-account-input').value,'12345');
  assert.equal(h.q('create-session').disabled,false);
 }finally{h.w.close();}
});

test('Setup explains why shared draft creation is unavailable',async()=>{
 const signedOut=await harness();
 try{
  await signedOut.click(signedOut.q('setup-button'));
  assert.equal(signedOut.q('create-session').disabled,true);
  assert.match(signedOut.q('create-session-hint').textContent,/Sign in/);
 }finally{signedOut.w.close();}
 const noTeam=await harness({backend:accountBackend()});
 try{
  await noTeam.click(noTeam.q('setup-button'));
  assert.equal(noTeam.q('create-session').disabled,true);
  assert.match(noTeam.q('create-session-hint').textContent,/Create or join a team/);
 }finally{noTeam.w.close();}
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


test('a follower whose team was deleted is told why and moved to local practice',async()=>{
 let gone=false,teams=[{id:'team',name:'Night Shift',owner_user_id:'captain'}];
 const row={id:draftId,team_id:'team',revision:0,drafter_user_id:'captain',state:{actions:[],firstPick:true,roster:[]}};
 const backend=accountBackend({listTeams:async()=>teams,loadRoster:async()=>[],getDraft:async()=>{if(gone){const e=Error('JSON object requested, multiple (or no) rows returned');e.code='PGRST116';throw e;}return structuredClone(row);}});
 const h=await harness({query:'?draft='+draftId,backend});
 try{
  assert.equal(h.q('session-code').textContent,'aaaaaaaa');
  gone=true;teams=[];
  h.w.dispatchEvent(new h.w.Event('focus'));await flush();await flush();
  assert.equal(h.q('session-code').textContent,'Local');
  assert.match(h.q('notice').textContent,/Night Shift was deleted, or you are no longer a member/);
  assert.ok(new URLSearchParams(h.w.location.search).has('practice'));
 }finally{h.w.close();}
});

test('local practice saves teammates by public ID from a visible Our team card',async()=>{
 const h=await harness();
 try{
  await h.click(h.q('setup-button'));
  const card=h.w.document.querySelector('[data-manual-entry] section[aria-label="Our team"]');
  assert.ok(card,'Our team card is visible');
  const ids=card.querySelector('textarea');ids.value='111 222';
  await h.click(h.button('Save our team',card));
  const saved=JSON.parse(h.w.localStorage.getItem('captain-practice-v1')).state.roster;
  assert.deepEqual(saved.map(p=>p.steamAccountId),['111','222']);
  ids.value='1 2 3 4 5 6';await h.click(h.button('Save our team',card));
  assert.equal(JSON.parse(h.w.localStorage.getItem('captain-practice-v1')).state.roster.length,2);
 }finally{h.w.close();}
});

test('signed-in local practice mixes ticked team members with manual stand-ins',async()=>{
 const squad={id:'team',name:'Night Shift',owner_user_id:'owner'};
 const members=[{userId:'owner',displayName:'Captain',steamAccountId:'100',availability:'available'},{userId:'mid',displayName:'Mid',steamAccountId:'200',availability:'available'},{userId:'away',displayName:'Away',steamAccountId:'300',availability:'unavailable'}];
 const h=await harness({backend:accountBackend({listTeams:async()=>[squad],loadRoster:async()=>members})});
 try{
  await h.click(h.q('setup-button'));
  const select=h.w.document.querySelector('[data-manual-entry] select[aria-label=Team]');
  if(select.value!=='team'){select.value='team';select.dispatchEvent(new h.w.Event('change'));await flush();}
  const card=h.w.document.querySelector('[data-manual-entry] section[aria-label="Our team"]');
  const checks=[...card.querySelectorAll('input[type=checkbox]')];
  assert.deepEqual(checks.map(c=>c.parentElement.textContent.trim()),['Captain','Mid','Away']);
  assert.deepEqual(checks.map(c=>c.checked),[true,true,false],'available members ticked by default');
  checks[2].click();
  card.querySelector('textarea').value='200';
  await h.click(h.button('Save our team',card));
  assert.equal(h.w.localStorage.getItem('captain-practice-v1:owner'),null,'duplicate public ID rejected');
  card.querySelector('textarea').value='999';
  await h.click(h.button('Save our team',card));
  const saved=JSON.parse(h.w.localStorage.getItem('captain-practice-v1:owner')).state.roster;
  assert.deepEqual(saved.map(p=>p.id),['owner','mid','away','999']);
  assert.deepEqual(saved.map(p=>p.steamAccountId),['100','200','300','999']);
 }finally{h.w.close();}
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

test('captain deletes a team from Setup only after confirming',async()=>{
 let teams=[{id:'team',name:'Night Shift',owner_user_id:'owner'}],deleted;
 const h=await harness({backend:accountBackend({listTeams:async()=>teams,loadRoster:async()=>[{userId:'owner',displayName:'Captain',availability:'available'}],deleteTeam:async(...args)=>{deleted=args;teams=[];}})});
 try{
  await h.click(h.q('setup-button'));
  const select=h.w.document.querySelector('[data-manual-entry] select[aria-label=Team]');
  if(select.value!=='team'){select.value='team';select.dispatchEvent(new h.w.Event('change'));await flush();}
  const section=()=>h.w.document.querySelector('[data-manual-entry] .team-management');
  assert.equal(h.button('Leave team',section()),undefined,'captain cannot leave');
  h.w.confirm=()=>false;await h.click(h.button('Delete team',section()));assert.equal(deleted,undefined);
  h.w.confirm=()=>true;await h.click(h.button('Delete team',section()));
  assert.deepEqual(deleted,['team','owner']);
  assert.equal(h.w.document.querySelector('[data-manual-entry] select[aria-label=Team]').value,'');
  assert.doesNotMatch(section().textContent,/Night Shift/);
  assert.equal(h.q('create-session').disabled,true);
 }finally{h.w.close();}
});

test('team member leaves a team from Setup and cannot delete it',async()=>{
 let teams=[{id:'team',name:'Night Shift',owner_user_id:'captain'}],left;
 const h=await harness({backend:accountBackend({listTeams:async()=>teams,loadRoster:async()=>[{userId:'captain',displayName:'Captain'},{userId:'owner',displayName:'Me'}],leaveTeam:async(...args)=>{left=args;teams=[];}})});
 try{
  await h.click(h.q('setup-button'));
  const select=h.w.document.querySelector('[data-manual-entry] select[aria-label=Team]');
  if(select.value!=='team'){select.value='team';select.dispatchEvent(new h.w.Event('change'));await flush();}
  const section=()=>h.w.document.querySelector('[data-manual-entry] .team-management');
  assert.equal(h.button('Delete team',section()),undefined,'members cannot delete');
  await h.click(h.button('Leave team',section()));
  assert.deepEqual(left,['team','owner']);
  assert.doesNotMatch(section().textContent,/Night Shift/);
 }finally{h.w.close();}
});

test('removing a teammate refreshes the team so the captain copies the new invite link',async()=>{
 const oldCode='a'.repeat(64),newCode='b'.repeat(64),expires=new Date(Date.now()+864e5).toISOString();
 let code=oldCode,copied;
 const h=await harness({query:'',clipboard:async text=>{copied=text;},backend:accountBackend({
  listTeams:async()=>[{id:'team',name:'Night Shift',owner_user_id:'owner',invite_code:code,invite_expires_at:expires}],
  loadRoster:async()=>[{userId:'owner',displayName:'Captain'},{userId:'player',displayName:'Lee'}],
  removeTeamMember:async()=>{code=newCode;},
 })});
 try{
  const root=h.q('team-home');root.querySelector('details').open=true;
  await h.click(h.button('Remove Lee',root));
  assert.match(root.textContent,/invite link was reset/i);
  await h.click(h.q('setup-button'));
  const select=h.w.document.querySelector('[data-manual-entry] select[aria-label=Team]');
  if(select.value!=='team'){select.value='team';select.dispatchEvent(new h.w.Event('change'));await flush();}
  await h.click(h.button('Copy team invite link',h.w.document.querySelector('[data-manual-entry]')));
  assert.ok(copied?.includes(newCode),'copied link uses the new code: '+copied);
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

test('a restored session shows a loading state instead of the signed-out welcome page',async()=>{
 let resolveSession,resolveTeams;
 const backend=accountBackend({getSession:()=>new Promise(r=>resolveSession=r),listTeams:()=>new Promise(r=>resolveTeams=r),loadRoster:async()=>[]});
 const h=await harness({query:'',backend,local:{'sb-example-auth-token':'{}'}});
 try{
  const signin=h.q('welcome-signin'),seen=[];
  const observer=new h.w.MutationObserver(()=>seen.push(signin.hidden?'(hidden)':signin.textContent.trim()));observer.observe(signin,{childList:true,characterData:true,subtree:true,attributes:true});
  assert.equal(signin.hidden,true,'no sign-in button while the session loads');
  assert.equal(h.q('welcome-register').hidden,true);
  assert.equal(h.q('welcome-loading').hidden,false);
  assert.match(h.q('welcome-loading').textContent,/Loading your account/);
  resolveSession({user:{id:'owner'}});await flush();
  resolveTeams([]);await flush();
  assert.equal(h.q('welcome-loading').hidden,true);
  assert.equal(h.w.document.body.dataset.view,'board');
  assert.ok(!seen.includes('Sign in'),'Sign in never appeared: '+seen.join(','));
  observer.disconnect();
 }finally{h.w.close();}
});

test('an OAuth or Steam callback says it is signing in until the session resolves',async()=>{
 let resolveSession;
 const h=await harness({query:'#access_token=abc&type=signup',backend:accountBackend({getSession:()=>new Promise(r=>resolveSession=r)})});
 try{
  assert.equal(h.q('welcome-signin').hidden,true);
  assert.match(h.q('welcome-loading').textContent,/Signing you in/);
  resolveSession(null);await flush();
  assert.equal(h.q('welcome-loading').hidden,true);
  assert.equal(h.q('welcome-signin').hidden,false);
  assert.equal(h.q('welcome-signin').textContent.trim(),'Sign in');
 }finally{h.w.close();}
});

test('a link error clears the loading state and a stalled session restores Sign in after 15 seconds',async()=>{
 const errored=await harness({query:'#error=access_denied',backend:accountBackend({getSession:()=>new Promise(()=>{})}),local:{'sb-example-auth-token':'{}'}});
 try{assert.equal(errored.q('welcome-loading').hidden,true);assert.ok(errored.q('welcome-auth').querySelector('form'));}finally{errored.w.close();}
 const timers=[];const h=await harness({query:'',backend:accountBackend({getSession:()=>new Promise(()=>{})}),local:{'sb-example-auth-token':'{}'},beforeRun:w=>{const real=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...a)=>{if(ms===15000){timers.push(fn);return 0;}return real(fn,ms,...a);};}});
 try{
  assert.equal(h.q('welcome-signin').hidden,true);
  assert.equal(timers.length,1);timers[0]();
  assert.equal(h.q('welcome-signin').hidden,false);
  assert.equal(h.q('welcome-loading').hidden,true);
 }finally{h.w.close();}
});

test('the page hides signed-out controls from the first paint when a session is stored',async()=>{
 const inline=[...new JSDOM(markup).window.document.querySelectorAll('head script:not([src])')].map(n=>n.textContent).join('\n');
 assert.ok(inline.includes('authPending'),'head marks auth pending before app code runs');
 const css=await readFile('web/styles.css','utf8');
 assert.match(css,/html\[data-auth-pending\] body\[data-view="welcome"\] #welcome-view/);
 assert.ok(inline.includes('20000'),'head script clears the mark if the app never loads');
 const first=new JSDOM(markup,{url:'https://board.example/',runScripts:'outside-only'});
 first.window.localStorage.setItem('sb-example-auth-token','{}');first.window.eval(inline);
 assert.equal(first.window.document.documentElement.dataset.authPending,'');
 const fresh=new JSDOM(markup,{url:'https://board.example/',runScripts:'outside-only'});fresh.window.eval(inline);
 assert.equal(fresh.window.document.documentElement.dataset.authPending,undefined);
 first.window.close();fresh.window.close();
 let resolveSession;
 const h=await harness({query:'',backend:accountBackend({getSession:()=>new Promise(r=>resolveSession=r),loadRoster:async()=>[]}),local:{'sb-example-auth-token':'{}'},beforeRun:w=>w.document.documentElement.dataset.authPending=''});
 try{
  assert.equal(h.w.document.documentElement.dataset.authPending,'','still pending while the session loads');
  resolveSession({user:{id:'owner'}});await flush();
  assert.equal(h.w.document.documentElement.dataset.authPending,undefined,'cleared once the account is known');
 }finally{h.w.close();}
});

test('while the account loads a full loading screen replaces the welcome page',async()=>{
 const doc=new JSDOM(markup).window.document;
 const screen=doc.getElementById('auth-loading');
 assert.ok(screen,'a dedicated loading screen exists');
 assert.ok(screen.contains(doc.getElementById('welcome-loading')),'the status text lives on the loading screen');
 assert.ok(!doc.getElementById('welcome-view').contains(screen),'the loading screen is outside the welcome page');
 const css=await readFile('web/styles.css','utf8');
 assert.match(css,/html\[data-auth-pending\] body\[data-view="welcome"\] #welcome-view/,'welcome page hidden while pending');
 assert.match(css,/html\[data-auth-pending\] body\[data-view="welcome"\] #auth-loading/,'loading screen only over the welcome view');
 let resolveSession;
 const h=await harness({query:'#access_token=abc&type=signup',backend:accountBackend({getSession:()=>new Promise(r=>resolveSession=r),loadRoster:async()=>[]})});
 try{
  assert.equal(h.w.document.documentElement.dataset.authPending,'','a callback marks the page pending even without the head script');
  resolveSession({user:{id:'owner'}});await flush();
  assert.equal(h.w.document.documentElement.dataset.authPending,undefined);
  assert.equal(h.w.document.body.dataset.view,'board');
 }finally{h.w.close();}
});

test('views fade in briefly when they appear and never animate with reduced motion',async()=>{
 const css=await readFile('web/styles.css','utf8');
 const block=css.match(/\/\* View fade[\s\S]*?\n\/\* end view fade \*\//)?.[0]||'';
 assert.ok(block,'a dedicated view-fade block exists');
 for(const selector of ['#welcome-view','#app-shell','#draft-view','#team-view','#cup-view','dialog[open]'])assert.ok(block.includes(selector),selector+' fades in');
 const ms=+(block.match(/animation:\s*view-in\s+(\d+)ms/)||[])[1];
 assert.ok(ms>=120&&ms<=220,'short fade, got '+ms+'ms');
 assert.match(block,/@keyframes view-in\s*\{\s*from\s*\{[^}]*opacity/);
 assert.match(block,/prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none/);
 assert.doesNotMatch(block,/transition-delay|animation-delay/,'content is never delayed');
});

test('without a stored session the sign-in button shows immediately',async()=>{
 const h=await harness({query:'',backend:accountBackend({getSession:()=>new Promise(()=>{})})});
 try{
  assert.equal(h.q('welcome-signin').hidden,false);
  assert.equal(h.q('welcome-loading').hidden,true);
 }finally{h.w.close();}
});

test('clicking the logo while signed in never shows the signed-out Sign in button',async()=>{
 const h=await harness({query:'',backend:accountBackend({loadRoster:async()=>[]}),local:{'sb-example-auth-token':'{}'}});
 try{
  const signin=h.q('welcome-signin'),seen=[];
  const observer=new h.w.MutationObserver(()=>seen.push(signin.hidden?'(hidden)':signin.textContent.trim()));observer.observe(signin,{childList:true,characterData:true,subtree:true,attributes:true});
  await h.click(h.q('home-button'));
  assert.equal(h.w.document.body.dataset.view,'welcome');
  assert.equal(signin.textContent.trim(),'Open my team');
  assert.ok(!seen.includes('Sign in'),'Sign in never appeared: '+seen.join(','));
  observer.disconnect();
 }finally{h.w.close();}
});

test('signed-in home page offers the team instead of sign in and keeps the session',async()=>{
 let signIns=0;
 const h=await harness({query:'',backend:accountBackend({signIn:async()=>{signIns++;return {session:{user:{id:'owner'}}};},loadRoster:async()=>[]})});
 try{
  assert.equal(h.w.document.body.dataset.view,'board');
  await h.click(h.q('home-button'));
  assert.equal(h.w.document.body.dataset.view,'welcome');
  assert.equal(h.q('welcome-signin').textContent.trim(),'Open my team');
  assert.equal(h.q('welcome-register').hidden,true);
  await h.click(h.q('welcome-signin'));
  assert.equal(h.w.document.body.dataset.view,'board');
  assert.equal(h.q('welcome-auth').querySelector('form'),null);
  assert.equal(h.q('signout-button').hidden,false);
  assert.equal(signIns,0);
 }finally{h.w.close();}
});

test('signing out restores the home page sign-in controls',async()=>{
 const h=await harness({query:'',backend:accountBackend({signOut:async()=>{}})});
 try{
  await h.click(h.q('signout-button'));
  assert.equal(h.w.document.body.dataset.view,'welcome');
  assert.equal(h.q('welcome-signin').textContent.trim(),'Sign in');
  assert.equal(h.q('welcome-register').hidden,false);
 }finally{h.w.close();}
});

test('Open my team keeps a signed-in invitee on the pending invitation',async()=>{
 let navigated=0;
 const h=await harness({query:'#invite='+inviteCode,backend:accountBackend({getSession:async()=>guestSession,loadProfile:async()=>null,previewTeamInvitation:async()=>invitedTeam,loadRoster:async()=>{navigated++;return [];}})});
 try{
  assert.ok(h.q('team-invite-heading'),'invitation shown');
  await h.click(h.q('welcome-signin'));
  assert.equal(h.w.document.body.dataset.view,'welcome');
  assert.ok(h.q('team-invite-heading'),'invitation still shown');
  assert.equal(h.q('team-view').hidden,true);
  assert.equal(navigated,0);
 }finally{h.w.close();}
});

test('Open my team resumes required profile setup instead of Team home',async()=>{
 const h=await harness({query:'',backend:accountBackend({getSession:async()=>guestSession,loadProfile:async()=>null,loadRoster:async()=>[]})});
 try{
  assert.equal(h.q('app-shell').dataset.profileSetup,'true');
  h.q('profile-dialog').close();
  await h.click(h.q('home-button'));
  await h.click(h.q('welcome-signin'));
  assert.equal(h.q('app-shell').dataset.profileSetup,'true');
  assert.equal(h.q('profile-dialog').open,true);
 }finally{h.w.close();}
});

for(const setup of [false,true])test('Open my team during sign-in keeps the shared draft link'+(setup?' through profile setup':''),async()=>{
 let finishProfile;const drafts=[];
 const backend=accountBackend({getSession:async()=>null,signIn:async()=>({session:guestSession}),loadProfile:()=>new Promise(r=>{finishProfile=r;}),
  getDraft:async id=>{drafts.push(id);return {id,team_id:'team',revision:0,state:{actions:[],roster:[]}};},loadRoster:async()=>[],saveProfile:async p=>p});
 const h=await harness({query:'?draft='+draftId,backend});
 try{
  const form=h.q('welcome-auth').querySelector('form');
  form.querySelector('[type=email]').value='captain@example.com';form.querySelector('[type=password]').value='example-password';
  form.requestSubmit();await flush();
  assert.equal(h.q('welcome-signin').textContent.trim(),'Open my team');
  await h.click(h.q('welcome-signin'));
  finishProfile(setup?null:{displayName:'Captain',preferredRoles:[1]});await flush();
  if(setup){
   const dialog=h.q('profile-dialog');dialog.querySelector('input').value='Captain';h.q('profile-role-1').click();
   await h.click(h.button('Save profile',dialog));
  }
  assert.deepEqual(drafts,[draftId]);
  assert.equal(h.q('team-view').hidden,true);
 }finally{h.w.close();}
});

test('double clicking Open my team navigates once',async()=>{
 let rosters=0;
 const h=await harness({query:'',backend:accountBackend({listTeams:async()=>[invitedTeam],loadRoster:async()=>{rosters++;return [];}})});
 try{
  await h.click(h.q('home-button'));
  rosters=0;
  h.q('welcome-signin').click();h.q('welcome-signin').click();
  await flush();
  assert.equal(rosters,1);
 }finally{h.w.close();}
});

test('signing out while Open my team waits for the account never opens the team',async()=>{
 let callback,finishProfile,rosters=0;
 const backend=accountBackend({getSession:async()=>null,onAuthChange:fn=>{callback=fn;},loadProfile:()=>new Promise(r=>{finishProfile=r;}),listTeams:async()=>[invitedTeam],loadRoster:async()=>{rosters++;return [];},signOut:async()=>{}});
 const h=await harness({query:'',backend});
 try{
  callback(guestSession,'SIGNED_IN');await flush();
  await h.click(h.q('welcome-signin'));
  await h.click(h.q('signout-button'));
  finishProfile({displayName:'Captain',preferredRoles:[1]});await flush();
  assert.equal(h.w.document.body.dataset.view,'welcome');
  assert.equal(h.q('team-view').hidden,true);
  assert.equal(rosters,0);
 }finally{h.w.close();}
});

test('Open my team cannot replace the password recovery form or open the board',async()=>{
 let callback,rosters=0;
 const h=await harness({query:'',backend:accountBackend({onAuthChange:fn=>{callback=fn;},listTeams:async()=>[invitedTeam],loadRoster:async()=>{rosters++;return [];}})});
 try{
  await h.click(h.q('home-button'));rosters=0;
  callback({user:{id:'owner'}},'PASSWORD_RECOVERY');await flush();
  const heading=()=>h.q('welcome-auth').querySelector('h2')?.textContent;
  assert.equal(heading(),'Choose a new password');
  await h.click(h.q('welcome-signin'));
  assert.equal(h.w.document.body.dataset.view,'welcome');
  assert.equal(heading(),'Choose a new password');
  assert.equal(rosters,0);
 }finally{h.w.close();}
});

test('Home during sign-in still loads the account so Open my team requires profile setup',async()=>{
 let callback,finishProfile;
 const backend=accountBackend({getSession:async()=>null,onAuthChange:fn=>{callback=fn;},loadProfile:()=>new Promise(r=>{finishProfile=r;}),listTeams:async()=>[invitedTeam],loadRoster:async()=>[]});
 const h=await harness({query:'',backend});
 try{
  callback(guestSession,'SIGNED_IN');await flush();
  await h.click(h.q('home-button'));
  finishProfile(null);await flush();
  await h.click(h.q('welcome-signin'));await flush();
  assert.equal(h.q('profile-dialog').open,true);
  assert.equal(h.q('app-shell').dataset.profileSetup,'true');
 }finally{h.w.close();}
});

test('password recovery keeps a visible way back to the new-password form',async()=>{
 let callback;
 const h=await harness({query:'',backend:accountBackend({onAuthChange:fn=>{callback=fn;}})});
 try{
  await h.click(h.q('home-button'));
  callback({user:{id:'owner'}},'PASSWORD_RECOVERY');await flush();
  await h.click(h.button('Back to welcome',h.q('welcome-auth')));
  const control=h.q('welcome-signin');
  assert.equal(control.hidden,false);
  await h.click(control);
  assert.equal(h.q('welcome-auth').querySelector('h2')?.textContent,'Choose a new password');
 }finally{h.w.close();}
});

test('Home during sign-in does not leave the board hidden behind the pending setup marker',async()=>{
 let callback,finishProfile;
 const backend=accountBackend({getSession:async()=>null,onAuthChange:fn=>{callback=fn;},loadProfile:()=>new Promise(r=>{finishProfile=r;}),listTeams:async()=>[invitedTeam],loadRoster:async()=>[]});
 const h=await harness({query:'',backend});
 try{
  callback(guestSession,'SIGNED_IN');await flush();
  await h.click(h.q('home-button'));
  finishProfile({displayName:'Guest',preferredRoles:[1]});await flush();
  await h.click(h.q('welcome-signin'));await flush();
  assert.equal(h.w.document.body.dataset.view,'board');
  assert.equal(h.q('app-shell').dataset.profileSetup,undefined);
 }finally{h.w.close();}
});

test('password recovery does not carry over to another account',async()=>{
 let callback;
 const h=await harness({query:'',backend:accountBackend({onAuthChange:fn=>{callback=fn;}})});
 try{
  await h.click(h.q('home-button'));
  callback({user:{id:'owner'}},'PASSWORD_RECOVERY');await flush();
  callback(null,'SIGNED_OUT');await flush();
  callback(guestSession,'SIGNED_IN');await flush();
  assert.notEqual(h.q('welcome-signin').textContent.trim(),'Choose new password');
  assert.equal(h.w.document.body.dataset.view,'board');
 }finally{h.w.close();}
});

test('home sign-in button drops aria-controls while it opens the team and restores it after sign-out',async()=>{
 const h=await harness({query:'',backend:accountBackend({signOut:async()=>{}})});
 try{
  assert.equal(h.q('welcome-signin').hasAttribute('aria-controls'),false);
  await h.click(h.q('signout-button'));
  assert.equal(h.q('welcome-signin').getAttribute('aria-controls'),'welcome-auth');
 }finally{h.w.close();}
});
