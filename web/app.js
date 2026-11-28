// Board entry: fills the late-bound actions, wires page-wide listeners and starts up
// (config, sign-in state, hero data).
import {showIdentityDownload,demoIdentityBackend} from './team-identity.js';
import {mountBattleCup} from './bcup.js';
import {createWelcome} from './welcome.js';
import {CM_ORDER,nextTurn} from './draft-engine.js';
import {resetAllyEntry} from './war-room.js';
import {publicData,loadHeroes} from './data.js';
import {initialState,demoState,reduceDraft} from './demo.js';
import {createBackend} from './backend.js';
import {DAY_MS,GOOGLE_ATTEMPT_KEY,OAUTH_PROVIDER_KEY} from './constants.js';
import {urlParams,demo,playerDemo,UUID,validDraftId,inlinedConfig,pendingDraft,forgetDraft,forgetInvitation,readInvitation,imageId} from './url-state.js';
import {store} from './store.js';
import {$,el,notice,safe,button,focusDraftView} from './dom.js';
import {ui,render} from './ui.js';
import {providerName,touch,resetDraftData,canWrite,heroName} from './draft-data.js';
import {restorePractice} from './practice-store.js';
import {refreshScouting} from './scouting.js';
import {refreshSightings} from './enemy-intel.js';
import {detachWorkspace,enterPractice,mutate,openDraft,poll,draftRoster,loadTeam} from './draft-sync.js';
import {stopLiveWatch} from './live-watch.js';
import './board-seats.js';
import './board-tree.js';
import {renderHeroes,searchHeroes,heroChoices,highlightSearch} from './board-heroes.js';
import './board-recommendations.js';
import {renderView,renderRoster} from './board-view.js';
import {startProfileSetup,profileDialog} from './profile-dialog.js';
import {lobby} from './setup-dialog.js';
import {teamIdentity,sampleTeam,renderTeamHome} from './team-home.js';
Object.assign(ui,{stopLiveWatch,renderView,lobby,profileDialog,teamIdentity,renderTeamHome,navigateTeam,navigateCup,signOut});
const SYNC_POLL_MS=3000;
const GOOGLE_ATTEMPT_MAX_AGE_MS=600000; // a Google sign-in started longer ago is ignored
// Clears the account loading message after this long. index.html's head script
// lifts its signed-out guard after its own literal 20000 ms (it runs before modules load).
const LOADING_FALLBACK_MS=15000;
const playerDemoHeroes=[1,13,2,26,5,44,29,8,74,11,12,14,23,86,30,25,34,28,36,37,38,39,55,60];
let invitationView=null;
let accountReady=Promise.resolve();
let accountGen=0;
let observedAuthUser;
let authEvent=0;

let steamEnabled=false;
let googleEnabled=false;
const welcome=createWelcome({getBackend:()=>store.backend,steamEnabled:()=>steamEnabled,googleEnabled:()=>googleEnabled,onSession:authChanged,onRegistered:safe(()=>store.shared?welcome.board():enterGated(resumeRoute)),onPractice:()=>{
 forgetDraft();
 if(demo){location.assign('?practice');return false;}
 enterPractice();
},onHome:()=>{
 forgetDraft();
 detachWorkspace();
},hasDraftInvitation:()=>!!pendingDraft(),onInvitation:showTeamInvitation,hasInvitation:()=>!!store.teamInvitation?.code,onOpenTeam:safe(async()=>{
 if(openingTeam)return;
 openingTeam=true;
 try{await enterGated(()=>navigateTeam());}finally{openingTeam=false;}
})});
ui.welcome=welcome;
let openingTeam=false;
let resumingAccount=null;

// Every shortcut into the board passes the same gates as sign-in (authChanged), in order:
// pending team invitation, password recovery, account load, then required profile setup.
// While sign-in is still resuming, authChanged routes from the current URL itself, so
// a shortcut must not race it.
async function enterGated(go){
 if(resumingAccount===store.generation||welcome.recovery||showTeamInvitation())return;
 const gen=store.generation,account=store.user?.id,ready=accountReady;if(!account)return;
 await ready;
 if(gen!==store.generation||store.user?.id!==account||welcome.recovery||showTeamInvitation())return;
 if(store.profileSetupRequired)startProfileSetup(go);else await go();
}
// Opens what the address asks for: a shared draft, Battle Cup, the practice board, or Team.
async function resumeRoute(){
 const params=urlParams();
 const draft=params.get('draft')||pendingDraft();
 if(validDraftId(draft)){
  try{await openDraft(draft);}catch(error){navigateTeam();notice(error.message);}finally{forgetDraft();}
 }else if(params.has('cup'))openCup();
 else if(params.has('practice'))welcome.board();
 else navigateTeam();
}

function showTeamInvitation(force=false){
 const invitation=store.teamInvitation;if(!invitation||welcome.recovery)return false;
 const account=store.user?.id||null;
 if(force!==true&&invitationView?.invitation===invitation&&invitationView.account===account&&$('team-invite-heading'))return true;
 invitationView={invitation,account};
 for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
 welcome.invitation({
  teamName:invitation.teamName,
  account:store.user&&(store.profile?.displayName||providerName(store.user)||(store.user.email&&!store.user.email.endsWith('.invalid')?store.user.email:'Steam player')),invalid:!invitation.code,
  onAccept:async()=>{
   const gen=store.generation,ready=accountReady,eventAtClick=authEvent;
   const isCurrent=()=>gen===store.generation&&store.user?.id===account&&invitation===store.teamInvitation
    &&(authEvent===eventAtClick||observedAuthUser===account);
   if(!account||!isCurrent())throw Error('The active account changed. Open the invitation again.');
   let joined;
   try{joined=await store.backend.joinTeam(invitation.code,account);}catch(error){
    if(!isCurrent())return;
    if(error.code==='22023'){
     forgetInvitation(invitation.code);
     store.teamInvitation=null;
     welcome.invitation({invalid:true,expired:true,onDismiss:()=>store.user?enterGated(()=>navigateCup()):navigateCup()});
     return;
    }
    throw error;
   }
   if(!joined?.id)throw Error('The team could not be confirmed. Try joining again.');
   await ready;
   if(!isCurrent())return;
   if(!store.teams.some(t=>t.id===joined.id))store.teams=[...store.teams,joined];
   forgetInvitation(invitation.code);store.teamInvitation=null;
   if(store.shared){detachWorkspace();restorePractice();}
   const url=new URL(location.href);url.searchParams.delete('draft');url.searchParams.delete('practice');history.replaceState(history.state,'',url);
   const roster=loadTeam(joined.id);
   if(store.profileSetupRequired)startProfileSetup(()=>navigateTeam(joined.id),joined);
   else{navigateTeam(joined.id);profileDialog(false,joined);}
   void roster.catch(()=>{}); // Setup can retry loading the selected roster independently.
  },
  onSwitch:async()=>{await store.backend.signOut();if(store.user?.id===account)await authChanged(null);},
  onDismiss:()=>{
   if(store.teamInvitation!==invitation)return;
   forgetInvitation(invitation.code);
   store.teamInvitation=null;
   if(store.user)return enterGated(resumeRoute);
   welcome.home();
  },
 });
 if(invitation.code&&store.backend?.previewTeamInvitation&&!invitation.previewRequested){
  invitation.previewRequested=true;
  void store.backend.previewTeamInvitation(invitation.code).then(name=>{
   if(store.teamInvitation!==invitation||!name)return;
   invitation.teamName=name;
   const heading=$('team-invite-heading');
   if(heading)heading.textContent='Join '+name;
  }).catch(()=>{}); // Older databases can still accept the invite.
 }
 return true;
}

let cupAccountVersion=0;
async function authChanged(session,event){

 const recovery=event==='PASSWORD_RECOVERY';
 if(recovery)welcome.recover();

 // Only a sign-in may open the board here: USER_UPDATED (password saved) and TOKEN_REFRESHED
 // must not replace "Continue to board" or skip its gates.
 const id=session?.user?.id||null;
 if(id===(store.user?.id||null)){if(store.user&&!recovery&&!store.teamInvitation&&(!event||event==='SIGNED_IN'||event==='INITIAL_SESSION'))welcome.signedIn();return;}

 stopLiveWatch();
 resetAllyEntry();
 teamIdentity.clear();
 store.homeRequest++;
 store.homeTeamId='';
 store.homeRoster=[];
 $('team-home').replaceChildren();
 store.profileSaved=false;
 store.profileSetupRequired=false;
 delete $('app-shell').dataset.profileSetup;
 const gen=++store.generation,acct=++accountGen;
 store.user=session?.user||null;
 welcome.setAccount(!!store.user,recovery);
 store.shared=null;
 store.team=null;
 store.teams=[];
 store.teamRoster=[];
 store.selectedTeamIds=[];
 store.profile={};
 store.state=initialState();
 ++cupAccountVersion;
 cup.sync();
 const inviteOnEntry=!!store.teamInvitation;

 if(!store.user)restorePractice();

 resetDraftData();
 store.selected=null;
 store.pending=false;
 store.polling=false;
 store.healthy=true;
 store.localControl=true;
 store.lastRoster=0;

 $('profile-content').replaceChildren();
 $('notice').textContent='';
 $('session-input').value='';
 document.querySelector('[data-manual-entry]')?.replaceChildren();
 for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();

 if(!store.user){
  accountReady=Promise.resolve();
  const url=new URL(location.href);
  url.searchParams.delete('draft');
  history.replaceState(null,'',url);
  if(!showTeamInvitation())welcome.home(pendingDraft()?'signin':undefined);
 }else{
  const activeUser=store.user;
  accountReady=Promise.allSettled([store.backend.loadProfile(),store.backend.listTeams()]).then(([p,t])=>{
   // Account data belongs to the account, not the workspace: Home or Practice mid-load
   // must not leave profile setup and teams unloaded.
   if(acct!==accountGen)return;
   store.profileSaved=p.status==='fulfilled'&&!!p.value;
   store.profile=(p.status==='fulfilled'&&p.value)||{displayName:providerName(activeUser)||'',steamAccountId:activeUser.user_metadata?.steam_account_id||''};
   store.profileSetupRequired=p.status==='fulfilled'&&(!p.value||!!activeUser.user_metadata?.steam_account_id&&!p.value.preferredRoles?.length);
   if(t.status==='fulfilled')store.teams=t.value;
   if(gen===store.generation){restorePractice();refreshScouting();}
   if(p.status==='rejected'||t.status==='rejected')notice('Some team account information could not be loaded. Reload the page to try again.');
  });
  if(!recovery&&!showTeamInvitation()){
   $('app-shell').dataset.profileSetup='pending';
   welcome.signedIn();
  }
 }
 render();
 if(store.user){
  // Recovery and a pending invitation never resume here: "Continue to board" and
  // declining the invitation do, through enterGated.
  if(!recovery&&!inviteOnEntry)resumingAccount=gen;
  try{
  await accountReady;
  // Clear the loading marker even if Home/Practice changed the workspace meanwhile;
  // left set, it hides the whole board.
  if(acct===accountGen&&$('app-shell').dataset.profileSetup==='pending')delete $('app-shell').dataset.profileSetup;
  if(gen!==store.generation)return;
  if(!inviteOnEntry&&!store.teamInvitation&&!recovery&&!welcome.recovery){
   if(store.profileSetupRequired)startProfileSetup(resumeRoute);
   else await resumeRoute();
  }
  }finally{if(resumingAccount===gen)resumingAccount=null;}
 }
 render();

}

if(playerDemo){
 const replay=el('section',null,'player-demo-controls');
 replay.setAttribute('aria-label','Player demo replay');
 replay.append(el('strong','Watching as Alex · Carry'),el('p','Follow a sample Captain’s Mode draft. Replay controls advance the captain’s actions.'));
 const advance=button('Show next captain action',()=>{
  const turn=nextTurn(store.state.actions,store.state.firstPick);
  if(!turn)return;
  const heroId=playerDemoHeroes[store.state.actions.length];
  const action={mode:turn.mode,heroId};
  if(turn.mode==='ourPick'){
   const playerIndex=store.state.actions.filter(item=>item.mode==='ourPick').length;
   action.playerId=store.state.roster[playerIndex].id;
   action.position=playerIndex+1;
  }
  store.state=reduceDraft(store.state,'append',action,{canWrite:true,heroes:store.heroes});
  store.selected=null;
  render();
  result.textContent=(turn.side==='our'?'Our team':'Enemy team')+' '+(turn.action==='pick'?'picked ':'banned ')+heroName(heroId)+'.';
  advance.disabled=store.state.actions.length===CM_ORDER.length;
 },replay,'primary');
 button('Restart replay',()=>{
  store.state=demoState();
  store.selected=null;
  advance.disabled=false;
  result.textContent='Replay restarted.';
  render();
 },replay);
 const result=el('p',null,'player-demo-result');
 result.setAttribute('role','status');
 replay.append(result);
 document.querySelector('#draft-view .seat-strip').before(replay);
}

for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();

for(const id of ['setup-button','connection-status'])$(id).onclick=safe(lobby);
$('profile-button').onclick=safe(()=>profileDialog());
let signingOut=false;
async function signOut(){
 if(signingOut||!store.user||!store.backend)return;
 const control=$('signout-button'),account=store.user.id;
 signingOut=true;control.disabled=true;control.textContent='Signing out…';control.setAttribute('aria-busy','true');
 try{await store.backend.signOut();forgetDraft();if(store.user?.id===account)await authChanged(null,'SIGNED_OUT');}
 finally{signingOut=false;control.disabled=false;control.textContent='Sign out';control.removeAttribute('aria-busy');}
}
$('signout-button').onclick=safe(signOut);
const cup=mountBattleCup({
 root:$('cup-view'),
 getContext:()=>({user:store.user,teams:store.teams,teamId:store.team?.id,backend:store.backend,demo,profileReady:demo||store.profileSaved,profileHasDraftDetails:demo||!!(store.profile.preferredRoles?.length&&(store.profile.signatureHeroes?.length||store.profile.desiredHeroes?.length)),version:cupAccountVersion}),
 onSignIn:()=>welcome.home('signin'),
 onSetup:safe(lobby),
 onTeam:safe(async id=>{if(!demo&&id&&await loadTeam(id)===false)return;navigateTeam(id);}),
 onProfile:()=>profileDialog(false,null,true),
 onToday:()=>profileDialog(false,null,true,1),
 onDraft:()=>{focusDraftView();},
});
function showWorkspace(view){
 $('app-shell').dataset.workspace=view;
 if(view!=='team'){teamIdentity.clear();store.homeRequest++;}
 const skip=document.querySelector('.skip-link');
 skip.href=view==='team'?'#team-title':view==='cup'?'#cup-view':'#hero-search';
 skip.textContent=view==='team'?'Skip to team':view==='cup'?'Skip to Battle Cup signup':'Skip to hero search';
 for(const [key,panel] of [['draft','draft-view'],['team','team-view'],['cup','cup-view']]){
  $(panel).hidden=key!==view;
  if(key===view)$(key+'-button').setAttribute('aria-current','page');
  else $(key+'-button').removeAttribute('aria-current');
 }
}
function leaveCup(){
 const url=new URL(location.href);
 if(url.searchParams.has('cup')){
  url.searchParams.delete('cup');
  // Back from Cup during a shared draft: keep its link so refresh/copy still opens the draft.
  if(store.shared&&!demo&&!url.searchParams.has('draft'))url.searchParams.set('draft',store.shared.id);
  else if(!url.searchParams.has('draft')&&!url.searchParams.has('demo')&&!url.searchParams.has('mock'))url.searchParams.set('practice','');
  history.pushState(null,'',url);
 }
}
function openCup(){showWorkspace('cup');welcome.board();void cup.refresh();}
$('draft-button').onclick=()=>{
 leaveCup();
 const url=new URL(location.href);
 if(url.searchParams.has('team')){
  url.searchParams.delete('team');
  if(!demo)url.searchParams.set(store.shared?'draft':'practice',store.shared?.id||'');
  history.pushState(null,'',url);
 }
 showWorkspace('draft');
};
$('team-button').onclick=()=>navigateTeam();
$('cup-button').onclick=()=>navigateCup();
function navigateTeam(id){
 const chosen=demo?sampleTeam:store.teams.find(item=>item.id===(id||store.homeTeamId||store.team?.id))||store.teams[0];
 const request=++store.homeRequest, account=store.user?.id;
 store.homeTeamId=chosen?.id||'';
 store.homeRoster=[];
 const url=new URL(location.href);
 url.searchParams.delete('cup');url.searchParams.delete('practice');url.searchParams.delete('draft');
 url.searchParams.set('team','');
 if(url.href!==location.href)history.pushState(null,'',url);
 showWorkspace('team');welcome.board();renderRoster();
 renderTeamHome(chosen&&!demo?'Loading team roster…':'');
 teamIdentity.open(store.homeTeamId);
 if(chosen&&!demo&&store.backend?.loadRoster){
  void store.backend.loadRoster(chosen.id).then(rows=>{
   if(request!==store.homeRequest||account!==store.user?.id||$('team-view').hidden)return;
   store.homeRoster=rows;renderTeamHome();renderRoster();
  }).catch(()=>{
   if(request===store.homeRequest&&account===store.user?.id&&!$('team-view').hidden)renderTeamHome('Could not load the roster. Reopen Team to retry.');
  });
 }
}

function navigateCup(){
 const url=new URL(location.href);url.searchParams.delete('draft');url.searchParams.delete('team');url.searchParams.set('cup','');
 if(url.href!==location.href)history.pushState(null,'',url);
 openCup();
}
;
$('session-dialog').addEventListener('close',()=>{if(!$('cup-view').hidden)void cup.refresh();});
for(const event of ['focus','online'])window.addEventListener(event,()=>{
 if(!$('cup-view').hidden&&document.body.dataset.view==='board')void cup.refresh();
});
if(!store.teamInvitation&&urlParams().has('cup'))openCup();
if(demo&&urlParams().has('team'))navigateTeam();


$('hero-search').oninput=searchHeroes;
$('claim-drafter').onclick=safe(()=>mutate('claim'));
$('release-drafter').onclick=safe(()=>mutate('release'));
$('undo').onclick=safe(()=>mutate('undo'));
$('first-pick').onchange=safe(()=>mutate('set_state',{firstPick:$('first-pick').checked}));
$('reset-draft').onclick=safe(async()=>{if(confirm('Reset all draft actions?'))await mutate('reset');});

$('create-session').onclick=safe(async()=>{
 if(!store.user||!store.team||demo)throw Error('Select a team first.');
 const teamId=store.team.id;
 if(!await loadTeam(teamId,{preserveSelection:true}))return;
 const row=await store.backend.createDraft(teamId,{actions:[],firstPick:true,enemyIds:[],roster:draftRoster(),assignments:{},source:'manual'});
 await openDraft(row.id);
});

$('join-session').onclick=safe(async()=>{
 let id=$('session-input').value.trim();
 try{id=new URL(id).searchParams.get('draft')||id;}catch{}
 if(!validDraftId(id)){$('session-input').setAttribute('aria-invalid','true');throw Error('Enter a valid draft UUID or full session URL.');}
 $('session-input').removeAttribute('aria-invalid');
 await openDraft(id);
});
$('copy-session').onclick=safe(async()=>{
 if(!store.shared)return;
 const url=new URL(location.origin+location.pathname);
 url.searchParams.set('draft',store.shared.id);
 await navigator.clipboard.writeText(url.href);
 notice('Session link copied. Team membership is required.');
});

document.addEventListener('keydown',e=>{
 if(document.body.dataset.view==='welcome'||$('draft-view').hidden||document.querySelector('dialog[open]'))return;
 const editing=e.target.closest('input,textarea,select,fieldset,[contenteditable]');
 if(e.target===$('hero-search')&&['ArrowDown','ArrowUp'].includes(e.key)){
  e.preventDefault();
  const count=heroChoices().length;
  store.searchIndex=count?(store.searchIndex+(e.key==='ArrowDown'?1:-1)+count)%count:0;
  highlightSearch();
  return;
 }
 if(e.key==='Escape'){store.selected=null;$('hero-search').value='';render();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!editing){e.preventDefault();if(canWrite()&&store.state.actions.length)void safe(()=>mutate('undo'))();return;}
 if(e.key==='Enter'&&e.target===$('hero-search')){e.preventDefault();const first=heroChoices()[store.searchIndex];first?.click();return;}
 if(!editing&&!e.target.closest('button,a')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.length===1){
  e.preventDefault();
  $('hero-search').focus();
  $('hero-search').value+=e.key==='/'?'':e.key;
  renderHeroes();
 }
});

for(const control of document.querySelectorAll('[data-hero-filter]'))control.onclick=()=>{
 store.heroFilter=control.dataset.heroFilter;
 store.searchIndex=0;
 for(const other of document.querySelectorAll('[data-hero-filter]'))other.setAttribute('aria-pressed',String(other===control));
 renderHeroes();
};
$('clear-hero-search').onclick=()=>{$('hero-search').value='';searchHeroes();$('hero-search').focus();};
$('drafter-seat').onclick=()=>{
 const action=!$('claim-drafter').disabled?$('claim-drafter'):$('release-drafter');
 action.scrollIntoView?.({block:'center'});
 if(!action.hidden)action.focus();
};
const skip=document.querySelector('.skip-link');
if(skip)skip.onclick=e=>{
 e.preventDefault();
 if(!$('cup-view').hidden)$('cup-view').focus();else if(!$('team-view').hidden)$('team-title')?.focus();else focusDraftView();
};
function openLinkInvitation(){
 if(demo)return false;
 const invite=readInvitation();if(!invite)return false;
 store.teamInvitation=invite;return showTeamInvitation();
}
window.addEventListener('hashchange',openLinkInvitation);
window.addEventListener('popstate',()=>void safe(async()=>{
 if(openLinkInvitation())return;
 // Back/Forward is another shortcut into the board: the recovery form and a pending
 // invitation stay in front, and signed-in routes pass the sign-in gates.
 if(welcome.recovery||showTeamInvitation())return;
 const params=urlParams();
 if(params.has('cup')){if(store.user)await enterGated(openCup);else openCup();return;}
 if(params.has('team')&&(store.user||demo)){if(store.user)await enterGated(()=>navigateTeam());else navigateTeam();return;}
 showWorkspace('draft');
 if(params.has('demo')||params.has('mock')){if(demo){detachWorkspace();welcome.board();render();}else location.reload();return;}
 const draft=params.get('draft');
 if(draft){
  if(store.user)await enterGated(()=>openDraft(draft,{navigate:false}));else{detachWorkspace();welcome.home('signin');}
 }else if(params.has('practice')){enterPractice({navigate:false});welcome.board();}else if(!showTeamInvitation()){detachWorkspace();welcome.home();}
})());
// A hidden tab skips its sync ticks and catches up once when shown again; poll() ignores
// overlapping calls, so a focus event arriving with the visibility change cannot double it.
const syncTick=()=>{if(document.hidden)return;void poll();refreshSightings();};
setInterval(syncTick,SYNC_POLL_MS);
document.addEventListener('visibilitychange',syncTick);
window.addEventListener('focus',()=>void poll());
window.addEventListener('online',()=>void poll());

if(imageId!==null){
 $('welcome-view').hidden=true;
 $('app-shell').hidden=true;
 $('identity-download').hidden=false;
} else {showTeamInvitation();render();refreshScouting();if(demo&&urlParams().has('profile'))profileDialog();}

if(imageId===null)void loadHeroes().then(value=>{
 store.heroes=Object.fromEntries(Object.entries(value).map(([id,h])=>[id,{...store.heroes[id],...h,pub_pick:store.heroes[id]?.pub_pick??h.pub_pick}]));
 touch();
 render();
}).catch(()=>{});

if(imageId===null)void publicData.request('/heroStats',{priority:0,ttl:DAY_MS}).then(rows=>{
 for(const h of rows)if(store.heroes[h.id])store.heroes[h.id]={...store.heroes[h.id],...h};
 touch();
 render();
}).catch(()=>{});

if(imageId!==null)void (async()=>{
 const root=$('identity-download');
 try{
  if(!UUID.test(imageId))throw Error();
  if(demo){await showIdentityDownload(root,demoIdentityBackend,imageId);return;}
  const config=inlinedConfig()||await (await fetch('/api/config',{cache:'no-store'})).json();
  await showIdentityDownload(root,createBackend({supabaseUrl:config.url,supabaseAnonKey:config.anonKey}),imageId);
 }catch{root.textContent='This image is unavailable.';}
})();
else if(!demo)void (async()=>{
 try{

 const authFragment=new URLSearchParams(location.hash.slice(1));
 let oauthProvider;
  try{oauthProvider=sessionStorage.getItem(OAUTH_PROVIDER_KEY);sessionStorage.removeItem(OAUTH_PROVIDER_KEY);}catch{}
 const steamToken=authFragment.get('steam_token');
 // Direct Google sign-in returns #id_token&state. Remove it from the address at once, use the saved
 // attempt once, and only accept a matching state from the last 10 minutes.
 const googleToken=authFragment.get('id_token');
  let googleAttempt=null,googleRejected=false;
 if(googleToken||(authFragment.has('state')&&!authFragment.has('access_token'))){
  let saved=null;try{saved=JSON.parse(sessionStorage.getItem(GOOGLE_ATTEMPT_KEY)||'null');sessionStorage.removeItem(GOOGLE_ATTEMPT_KEY);}catch{}
  const clean=new URL(location.href);clean.hash='';history.replaceState(null,'',clean);
  if(googleToken&&saved?.state&&saved.state===authFragment.get('state')&&Date.now()-saved.at<GOOGLE_ATTEMPT_MAX_AGE_MS)googleAttempt=saved;
  else if(googleToken)googleRejected=true;
 }
 // Show progress instead of a signed-out home while a callback or a stored session resolves.
 const callback=!googleRejected&&!!(steamToken||googleAttempt||oauthProvider||authFragment.has('access_token')||urlParams().has('code'));
 let storedSession=false;
  try{storedSession=Object.keys(localStorage).some(key=>/^sb-.+-auth-token$/.test(key));}catch{}
 if(callback||storedSession||'authPending' in document.documentElement.dataset){
  welcome.loading(callback?'Signing you in…':'Loading your account…');
  setTimeout(()=>welcome.loading(),LOADING_FALLBACK_MS);
 }
 // A rejected Google return shows its error after the loading state is set, so nothing covers it.
 if(googleRejected)welcome.linkError('google');
 if(steamToken){const clean=new URL(location.href);clean.hash='';history.replaceState(null,'',clean);}

 if(authFragment.has('error')||authFragment.has('error_code')){

  const clean=new URL(location.href);

  clean.hash='';

  history.replaceState(null,'',clean);

  welcome.linkError(oauthProvider);

 }

 // Use the config baked in at build time; fall back to /api/config when the build had none.
 const inlined=inlinedConfig();
  let config=inlined;
 if(!config){
  const response=await fetch('/api/config',{cache:'no-store'});
  if(!response.ok){welcome.setConnection('unavailable');return;}
  config=await response.json();
  if(!config.url||!config.anonKey){welcome.setConnection('unavailable');return;}
 }
  steamEnabled=config.steamAuth===true;
  googleEnabled=config.googleAuth===true;
  store.backend=createBackend({supabaseUrl:config.url,supabaseAnonKey:config.anonKey,googleClientId:config.googleClientId||''});
 if(store.teamInvitation&&!store.user&&$('team-invite-heading'))showTeamInvitation(true);
 if(urlParams().has('steam-error')){
  welcome.home('signin');
  const message=$('welcome-auth').querySelector('.auth-message[role=status]');
  if(message){message.dataset.state='error';message.textContent='Steam sign-in did not finish. Try again.';}
 }
 if(steamToken){
  try {await store.backend.verifySteam(steamToken);}
  catch {history.replaceState(null,'','/?steam-error');location.reload();return;}
 }
 if(googleAttempt){try{await store.backend.finishGoogle(googleToken,googleAttempt.nonce);}catch{welcome.linkError('google');}}
 store.backend.onAuthChange((session,event)=>{
  observedAuthUser=session?.user?.id||null;++authEvent;
  setTimeout(()=>void safe(()=>authChanged(session,event))(),0);
 });
  const initialSession=await store.backend.getSession();
 if(!initialSession&&pendingDraft()&&!store.teamInvitation&&!authFragment.has('error')&&!authFragment.has('error_code')&&!urlParams().has('steam-error'))welcome.home('signin');
 await authChanged(initialSession);
  welcome.loading();
  welcome.setConnection('available');
  render();
 // Sign-in provider flags can change without a rebuild; refresh them in the background.
 if(inlined)void fetch('/api/config',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(fresh=>{
  if(!fresh?.url)return;
  steamEnabled=fresh.steamAuth===true;
  googleEnabled=fresh.googleAuth===true;
  welcome.setConnection('available');
 }).catch(()=>{});
 }catch{welcome.setConnection('unavailable');notice('Sign-in service unavailable. Local practice remains available.');}
})();
