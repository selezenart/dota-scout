// Team invitation screen, shown in front of the board.
import {demo,forgetInvitation,readInvitation} from './url-state.js';
import {store} from './store.js';
import {$} from './dom.js';
import {ui} from './ui.js';
import {providerName} from './draft-data.js';
import {restorePractice} from './practice-store.js';
import {detachWorkspace,loadTeam} from './draft-sync.js';
import {startProfileSetup,profileDialog} from './profile-dialog.js';
import {navigateTeam,navigateCup} from './router.js';
let invitationView=null;

export function showTeamInvitation(force=false){
 const invitation=store.teamInvitation;if(!invitation||ui.welcome.recovery)return false;
 const account=store.user?.id||null;
 if(force!==true&&invitationView?.invitation===invitation&&invitationView.account===account&&$('team-invite-heading'))return true;
 invitationView={invitation,account};
 for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
 ui.welcome.invitation({
  teamName:invitation.teamName,
  account:store.user&&(store.profile?.displayName||providerName(store.user)||(store.user.email&&!store.user.email.endsWith('.invalid')?store.user.email:'Steam player')),invalid:!invitation.code,
  onAccept:async()=>{
   const gen=store.generation,ready=store.accountReady,eventAtClick=store.authEvent;
   const isCurrent=()=>gen===store.generation&&store.user?.id===account&&invitation===store.teamInvitation
    &&(store.authEvent===eventAtClick||store.observedAuthUser===account);
   if(!account||!isCurrent())throw Error('The active account changed. Open the invitation again.');
   let joined;
   try{joined=await store.backend.joinTeam(invitation.code,account);}catch(error){
    if(!isCurrent())return;
    if(error.code==='22023'){
     forgetInvitation(invitation.code);
     store.teamInvitation=null;
     ui.welcome.invitation({invalid:true,expired:true,onDismiss:()=>store.user?ui.enterGated(()=>navigateCup()):navigateCup()});
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
  onSwitch:async()=>{await store.backend.signOut();if(store.user?.id===account)await ui.authChanged(null);},
  onDismiss:()=>{
   if(store.teamInvitation!==invitation)return;
   forgetInvitation(invitation.code);
   store.teamInvitation=null;
   if(store.user)return ui.enterGated(ui.resumeRoute);
   ui.welcome.home();
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
export function openLinkInvitation(){
 if(demo)return false;
 const invite=readInvitation();if(!invite)return false;
 store.teamInvitation=invite;return showTeamInvitation();
}
