// Sign-in flow: welcome screen, the gate chain into the board, account changes, sign-out.
// Every shortcut into the board passes, in order: pending team invitation, password
// recovery, `accountReady`, then profile setup. enterGated applies them; authChanged is the reference flow.
import {createWelcome} from './welcome.js';
import {resetAllyEntry} from './war-room.js';
import {initialState} from './demo.js';
import {urlParams,demo,validDraftId,pendingDraft,forgetDraft} from './url-state.js';
import {store} from './store.js';
import {$,notice,safe} from './dom.js';
import {render} from './ui.js';
import {providerName,resetDraftData} from './draft-data.js';
import {restorePractice} from './practice-store.js';
import {refreshScouting} from './scouting.js';
import {detachWorkspace,enterPractice,openDraft} from './draft-sync.js';
import {stopLiveWatch} from './live-watch.js';
import {startProfileSetup} from './profile-dialog.js';
import {teamIdentity} from './team-home.js';
import {cup,openCup,navigateTeam} from './router.js';
import {showTeamInvitation} from './invitation-view.js';
let accountGen=0;
export const welcome=createWelcome({getBackend:()=>store.backend,steamEnabled:()=>store.steamEnabled,googleEnabled:()=>store.googleEnabled,onSession:authChanged,onRegistered:safe(()=>store.shared?welcome.board():enterGated(resumeRoute)),onPractice:()=>{
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
let openingTeam=false;
let resumingAccount=null;

// Every shortcut into the board passes the same gates as sign-in (authChanged), in order:
// pending team invitation, password recovery, account load, then required profile setup.
// While sign-in is still resuming, authChanged routes from the current URL itself, so
// a shortcut must not race it.
export async function enterGated(go){
 if(resumingAccount===store.generation||welcome.recovery||showTeamInvitation())return;
 const gen=store.generation,account=store.user?.id,ready=store.accountReady;if(!account)return;
 await ready;
 if(gen!==store.generation||store.user?.id!==account||welcome.recovery||showTeamInvitation())return;
 if(store.profileSetupRequired)startProfileSetup(go);else await go();
}
// Opens what the address asks for: a shared draft, Battle Cup, the practice board, or Team.
export async function resumeRoute(){
 const params=urlParams();
 const draft=params.get('draft')||pendingDraft();
 if(validDraftId(draft)){
  try{await openDraft(draft);}catch(error){navigateTeam();notice(error.message);}finally{forgetDraft();}
 }else if(params.has('cup'))openCup();
 else if(params.has('practice'))welcome.board();
 else navigateTeam();
}
export async function authChanged(session,event){

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
 ++store.cupAccountVersion;
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
  store.accountReady=Promise.resolve();
  const url=new URL(location.href);
  url.searchParams.delete('draft');
  history.replaceState(null,'',url);
  if(!showTeamInvitation())welcome.home(pendingDraft()?'signin':undefined);
 }else{
  const activeUser=store.user;
  store.accountReady=Promise.allSettled([store.backend.loadProfile(),store.backend.listTeams()]).then(([p,t])=>{
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
  await store.accountReady;
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
let signingOut=false;
export async function signOut(){
 if(signingOut||!store.user||!store.backend)return;
 const control=$('signout-button'),account=store.user.id;
 signingOut=true;control.disabled=true;control.textContent='Signing out…';control.setAttribute('aria-busy','true');
 try{await store.backend.signOut();forgetDraft();if(store.user?.id===account)await authChanged(null,'SIGNED_OUT');}
 finally{signingOut=false;control.disabled=false;control.textContent='Sign out';control.removeAttribute('aria-busy');}
}
