// Board entry: fills the late-bound actions, wires page-wide listeners and starts up
// (config, sign-in state, hero data).
import {mountTeamIdentity,showIdentityDownload,demoIdentityBackend} from './team-identity.js';
import {mountBattleCup} from './bcup.js';
import {createWelcome} from './welcome.js';
import {CM_ORDER,nextTurn,parseAccountIds} from './draft-engine.js';
import {resetAllyEntry} from './war-room.js';
import {publicData,loadHeroes} from './data.js';
import {initialState,demoState,reduceDraft} from './demo.js';
import {createBackend} from './backend.js';
import {DAY_MS,GOOGLE_ATTEMPT_KEY,LOCAL_HELPER_ORIGIN,OAUTH_PROVIDER_KEY,ROSTER_SIZE} from './constants.js';
import {urlParams,demo,captainDemo,playerDemo,UUID,validDraftId,inlinedConfig,pendingDraft,forgetDraft,teamInviteCode,forgetInvitation,readInvitation,codeFromInvitation,imageId} from './url-state.js';
import {store} from './store.js';
import {$,el,notice,safe,button,field,focusDraftView,showIfClosed} from './dom.js';
import {ui,render} from './ui.js';
import {accountOf,memberId,providerName,touch,resetDraftData,canWrite,heroName,portrait} from './draft-data.js';
import {restorePractice} from './practice-store.js';
import {refreshScouting} from './scouting.js';
import {addEnemyMatches,refreshSightings} from './enemy-intel.js';
import {detachWorkspace,enterPractice,mutate,openDraft,poll,draftRoster,loadTeam,mutateOwner} from './draft-sync.js';
import {stopLiveWatch,checkLiveWatch} from './live-watch.js';
import './board-seats.js';
import './board-tree.js';
import {renderHeroes,searchHeroes,heroChoices,highlightSearch} from './board-heroes.js';
import './board-recommendations.js';
import {renderView,renderRoster} from './board-view.js';
import {startProfileSetup,profileDialog} from './profile-dialog.js';
Object.assign(ui,{stopLiveWatch,renderView,lobby,profileDialog,renderTeamHome,navigateTeam,navigateCup,signOut});
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

let lobbyEdited=false;
function sessionButtons(){
 $('create-session').disabled=!store.user||!store.team||demo;
 $('create-session').textContent=store.team?'Create draft for '+store.team.name:'Create shared draft';
 $('create-session-hint').textContent=demo?'The demo never creates shared drafts.':!store.user?'Sign in to create a shared draft with your team.':!store.team?(store.teams.length?'Select an active team below to create a shared draft.':'Create or join a team below to create a shared draft.'):'';
}
async function lobby(){
 lobbyEdited=false;
 // Default to the team shown on Team home so shared draft creation is not silently disabled.
 // The roster loads in the background so a slow response never blocks Setup.
 if(store.user&&!demo&&!store.team&&store.teams.length){
  const id=(store.teams.find(t=>t.id===store.homeTeamId)||store.teams[0]).id;
  void safe(async()=>{if(!await loadTeam(id)||store.team?.id!==id||!$('session-dialog').open)return;if(lobbyEdited)sessionButtons();else await lobby();})();
 }
 else if(store.team&&!store.teamRoster.length)await loadTeam(store.team.id,{preserveSelection:true});
 const details=document.querySelector('[data-connection-details]'),manual=document.querySelector('[data-manual-entry]');
 details.replaceChildren(el('p',demo?'Invented demonstration - no backend writes.':store.backend?'Shared drafts require sign-in and team membership.':'Public configuration unavailable. Local practice remains available.'));
 const link=el('a','Open legacy live/replay helper');
 link.href=LOCAL_HELPER_ORIGIN;
 link.target='_blank';
 link.rel='noopener';
 if(['localhost','127.0.0.1'].includes(location.hostname))details.append(link);
 const demoLink=el('a','Try the demo');
 demoLink.href='?demo';
 const links=el('div',null,'lobby-links');
 links.append(link,demoLink);
 details.append(links);
 manual.replaceChildren();
 manual.oninput=()=>{lobbyEdited=true;};
 const scouting=el('section',null,'lobby-card');
 scouting.setAttribute('aria-label','Enemy scouting');
 scouting.append(el('h3','Enemy scouting'));
 manual.append(scouting);
 const scoutingActions=el('div',null,'lobby-actions');
 if(!demo){
  const liveStatus=el('p',null,'secondary');
  liveStatus.setAttribute('role','status');
  const liveControl=button('Detect live lineup',()=>{
   if(store.liveWatch){
    stopLiveWatch();liveControl.textContent='Detect live lineup';liveStatus.textContent='Live detection stopped.';return;
   }
   liveControl.textContent='Stop live detection';
   liveStatus.textContent='Waiting for the local Dota helper…';
   store.liveWatch={generation:store.generation,control:liveControl,status:liveStatus};
   void checkLiveWatch(store.liveWatch);
  },scouting);
  liveControl.disabled=!canWrite();
  scouting.append(liveStatus);
  if(store.liveWatch?.generation===store.generation){
   liveStatus.textContent=store.liveWatch.status.textContent;
   liveControl.textContent='Stop live detection';
   liveControl.disabled=false;
   Object.assign(store.liveWatch,{control:liveControl,status:liveStatus});
  }
 }
 const enemies=field(scouting,'Enemy public player IDs or URLs (up to 5)',(store.state.enemyIds||[]).join(' '),'textarea');
 enemies.id='enemy-account-input';
 enemies.placeholder='One player ID or link per line';
 enemies.rows=3;
 scouting.append(scoutingActions);
 const matchIds=field(scouting,'Their earlier Battle Cup matches (IDs or links)','','textarea');
 matchIds.id='enemy-match-input';
 matchIds.placeholder='Match IDs or Dotabuff/OpenDota links from the bracket';
 matchIds.rows=2;
 const matchActions=el('div',null,'lobby-actions');
 scouting.append(matchActions);
 button('Load matches',async()=>{if(!await addEnemyMatches(matchIds.value))return;matchIds.value='';notice('Battle Cup matches loaded.');},matchActions);
 const validateEnemies=()=>{
  const tokens=enemies.value.trim().split(/[\s,;]+/).filter(Boolean);
  const invalid=tokens.filter(token=>parseAccountIds(token).length!==1);
  if(invalid.length){enemies.setAttribute('aria-invalid','true');throw Error('Correct these enemy entries: '+invalid.join(', '));}
  if(!tokens.length)throw Error('Enter enemy IDs, or use Clear enemy scouting to remove them intentionally.');
  const ids=parseAccountIds(enemies.value);if(ids.length>5)throw Error('Maximum five opponents.');enemies.removeAttribute('aria-invalid');return ids;
 };
 button('Save and scout enemies',async()=>{
  await mutate('set_state',{enemyIds:validateEnemies()});
  notice('Enemy scouting saved.');
 },scoutingActions,'primary').disabled=!canWrite();
 button('Clear enemy scouting',async()=>{
  await mutate('set_state',{enemyIds:[]});
  enemies.value='';
  enemies.removeAttribute('aria-invalid');
  notice('Enemy scouting cleared.');
 },scoutingActions).disabled=!canWrite();
 if(!store.shared){
  // Local practice: tick members of the active team and/or add stand-ins by public ID (max five).
  const ours=el('section',null,'lobby-card lobby-local');
  ours.setAttribute('aria-label','Our team');
  ours.append(el('h3','Our team'));
  manual.append(ours);
  const current=Array.isArray(store.state.roster)?store.state.roster.filter(p=>p&&typeof p==='object'):[];
  const members=store.user&&!demo&&store.team?store.teamRoster:[],memberIds=new Set(members.map(p=>p.userId));
  const savedMembers=current.map(p=>memberId(p)).filter(id=>memberIds.has(id));
  let picked=savedMembers.some(id=>id!==store.user?.id)?savedMembers:members.filter(p=>p.availability!=='unavailable').slice(0,ROSTER_SIZE).map(p=>p.userId);
  if(members.length){
   ours.append(el('p','Load players from '+store.team.name+':'));
   const list=el('div',null,'lobby-roster');ours.append(list);
   for(const p of members){
    const label=el('label',p.displayName),check=el('input');
    check.type='checkbox';
    check.checked=picked.includes(p.userId);
    check.onchange=()=>{picked=check.checked?[...new Set([...picked,p.userId])]:picked.filter(id=>id!==p.userId);};
    label.prepend(check);
    list.append(label);
   }
  }else if(store.user&&!demo)ours.append(el('p',store.teams.length?'Select an active team under Team management to load your teammates.':'Create or join a team to load your teammates.','secondary'));
  const manualIds=current.filter(p=>!memberIds.has(memberId(p))).map(p=>accountOf(p)).filter(Boolean);
  const ownIds=field(ours,members.length?'Add other players by public ID or URL':'Teammate public player IDs or URLs (up to 5)',manualIds.join(' '),'textarea');
  ownIds.rows=3;
  ownIds.placeholder='One player ID or link per line';
  const ourActions=el('div',null,'lobby-actions');
  ours.append(ourActions);
  button('Save our team',async()=>{
   if(!canWrite())throw Error('Become local drafter first.');
   const tokens=ownIds.value.trim().split(/[\s,;]+/).filter(Boolean);
   if(tokens.some(token=>parseAccountIds(token).length!==1)){
    ownIds.setAttribute('aria-invalid','true');
    throw Error('Correct invalid teammate account entries first.');
   }
   const chosen=members.filter(p=>picked.includes(p.userId)).map(p=>({...p,id:p.userId}));
   const extra=parseAccountIds(ownIds.value).map(id=>({id:String(id),name:String(id),steamAccountId:String(id)}));
   const rows=[...chosen,...extra];
   if(!rows.length||rows.length>5)throw Error('Choose one to five players for our team.');
   const accounts=rows.map(p=>String(p.steamAccountId||'')).filter(Boolean);
   if(new Set(accounts).size!==accounts.length)throw Error('A player is listed twice. Remove the duplicate public ID.');
   ownIds.removeAttribute('aria-invalid');
   await mutate('set_state',{roster:rows});notice('Our team saved.');
  },ourActions,'primary').disabled=!canWrite();
 }
 if(store.user&&!demo){
  const section=el('section',null,'team-management lobby-card');
  section.setAttribute('aria-label','Team management');
  section.append(el('h3','Team management'));
  manual.append(section);
  const teamActions=el('div',null,'lobby-team-actions');
  const create=el('div',null,'lobby-team-action'),join=el('div',null,'lobby-team-action');
  teamActions.append(create,join);
  section.append(teamActions);
  const teamName=field(create,'New team name'),invite=field(join,'Team invitation code (separate from draft ID)');
  teamName.placeholder='Your team name';
  invite.placeholder='Paste invite link or code';
  button('Create team',async()=>{
   const result=await store.backend.createTeam(teamName.value);
   store.teams=await store.backend.listTeams();
   store.team=store.teams.find(t=>t.id===result.id)||result;
   await loadTeam(store.team.id);
   await lobby();
   notice('Created team '+store.team.name+'.');
  },create);
  button('Join team',async()=>{
   const gen=store.generation,joined=await store.backend.joinTeam(codeFromInvitation(invite.value),store.user.id);
   if(gen!==store.generation)return;
   const refreshed=await store.backend.listTeams();
   if(gen!==store.generation)return;
   store.teams=refreshed;
   store.team=store.teams.find(t=>t.id===joined?.id);
   if(!store.team)throw Error('Team joined. Reopen Setup to select it.');
   if(!await loadTeam(store.team.id))return;
   await lobby();
   notice('Joined '+store.team.name+'. This team is now selected.');
  },join);
  const select=el('select');
  select.setAttribute('aria-label','Team');
  select.append(new Option('Select a team',''));
  for(const t of store.teams)select.append(new Option(t.name,t.id));
  select.value=store.team?.id||'';
  select.onchange=safe(async()=>{await loadTeam(select.value);await lobby();});
  const teamLabel=el('label','Active team');
  teamLabel.append(select);
  section.append(teamLabel);
  if(store.team){
   section.append(el('p','Selected team: '+store.team.name),el('p','Select up to five players for the draft roster:'));
   const rosterList=el('div',null,'lobby-roster');
   section.append(rosterList);
   for(const p of store.teamRoster){
    const label=el('label',p.displayName+' - '+p.availability),check=el('input');
    check.type='checkbox';
    check.checked=store.selectedTeamIds.includes(p.userId);
    check.onchange=()=>{store.selectedTeamIds=check.checked?[...new Set([...store.selectedTeamIds,p.userId])]:store.selectedTeamIds.filter(id=>id!==p.userId);};
    label.prepend(check);
    rosterList.append(label);
   }
   if(store.team.owner_user_id===store.user.id&&teamInviteCode.test(store.team.invite_code)){
    const inviteTeam=store.team,expiry=Date.parse(inviteTeam.invite_expires_at);
    if(expiry<=Date.now())section.append(el('p','This team invite link has expired.'));
    else{
     if(Number.isFinite(expiry))section.append(el('p','Team invite link expires '+new Date(expiry).toLocaleDateString()+'.'));
     button('Copy team invite link',async()=>{
      if(expiry<=Date.now())throw Error('This team invite link has expired.');
      if(store.user?.id!==inviteTeam.owner_user_id||store.team?.id!==inviteTeam.id)return;
      const url=new URL('/',location.origin);url.hash=new URLSearchParams({invite:inviteTeam.invite_code}).toString();
      try{await navigator.clipboard.writeText(url.href);}catch{
       if(!section.isConnected)return;
       let manualLink=section.querySelector('[data-copy-invite]');
       if(!manualLink){manualLink=field(section,'Team invite link',url.href);manualLink.readOnly=true;manualLink.dataset.copyInvite='';}
       manualLink.focus();manualLink.select();notice('Copy the selected link and share it only with intended teammates.');return;
      }
      if(section.isConnected)notice('Invite link copied for '+inviteTeam.name+'. Share only with intended teammates.');
     },section);
    }
   }
   if(store.team.owner_user_id===store.user.id){
    // Renewing issues a new code server-side, so the old link stops working.
    const renewing=store.team,account=store.user.id,current=Date.parse(renewing.invite_expires_at)>Date.now()&&teamInviteCode.test(renewing.invite_code);
    const renew=button('Renew link',async()=>{
     if(renew.disabled||store.team?.id!==renewing.id||store.user?.id!==account)return;
     if(current&&!confirm('Renew the invite link for '+renewing.name+'? The current link stops working.'))return;
     renew.disabled=true;let fresh;try{fresh=await store.backend.renewTeamInvite(renewing.id,account);}finally{renew.disabled=false;}
     if(store.user?.id!==account)return;
     if(!teamInviteCode.test(fresh?.invite_code))throw Error('Could not renew the team invite link. Reload the page and try again.');
     const renewed=t=>t.id===renewing.id?{...t,invite_code:fresh.invite_code,invite_expires_at:fresh.invite_expires_at}:t;
     store.teams=store.teams.map(renewed);if(store.team?.id===renewing.id)store.team=renewed(store.team);
     if(section.isConnected&&store.team?.id===renewing.id)await lobby();
     if(store.user?.id===account)notice('New invite link ready. The old link no longer works.');
    },section);
   }
   if(store.shared&&store.team.id===store.shared.team_id)button('Refresh draft roster snapshot',async()=>{
    if(!await loadTeam(store.shared.team_id,{preserveSelection:true}))return;
    const roster=draftRoster(),removed=(store.state.roster||[]).filter(p=>p&&!roster.some(current=>current.id===memberId(p)));
    section.querySelector('.roster-refresh-preview')?.remove();
    if(removed.length){
     const preview=el('div',null,'roster-refresh-preview snapshot-preview');
     preview.setAttribute('role','status');
     preview.append(el('p','This refresh will remove: '+removed.map(p=>p.displayName||p.name||p.id).join(', ')+'.'));
     button('Apply roster refresh',async()=>{await mutate('set_state',{roster});preview.remove();notice('Roster snapshot refreshed.');},preview);
     button('Cancel roster refresh',()=>preview.remove(),preview);
     section.append(preview);
    }
    else{await mutate('set_state',{roster});notice('Roster snapshot refreshed.');}
   },section).disabled=!canWrite();
   if(store.shared&&store.teams.find(t=>t.id===store.shared.team_id)?.owner_user_id===store.user.id)button('Owner reclaim drafter',()=>mutateOwner(),section);
   const ownsTeam=store.team.owner_user_id===store.user.id,leaving=store.team,account=store.user.id;
   const exit=button(ownsTeam?'Delete team':'Leave team',async()=>{
    if(exit.disabled||store.team?.id!==leaving.id||store.user?.id!==account)return;
    if(!confirm(ownsTeam?'Delete '+leaving.name+' for everyone? Its drafts, scouting notes, Battle Cup spots and members are removed permanently.':'Leave '+leaving.name+'? You lose access to its drafts and release any draft control you hold.'))return;
    exit.disabled=true;try{await (ownsTeam?store.backend.deleteTeam(leaving.id,account):store.backend.leaveTeam(leaving.id,account));}finally{exit.disabled=false;}
    if(store.user?.id!==account)return;
    if(store.shared?.team_id===leaving.id)enterPractice();
    ++store.teamLoad;store.team=null;store.teamRoster=[];store.selectedTeamIds=[];
    if(store.homeTeamId===leaving.id){teamIdentity.clear();store.homeRequest++;store.homeTeamId='';store.homeRoster=[];renderTeamHome();}
    store.teams=await store.backend.listTeams();if(store.user?.id!==account)return;
    await lobby();notice(ownsTeam?'Deleted team '+leaving.name+'.':'You left '+leaving.name+'.');
   },section,ownsTeam?'danger':undefined);
   const results=el('div',null,'team-draft-results');
   results.setAttribute('aria-live','polite');
   button('List team drafts',async()=>{
    const teamId=store.team.id,drafts=await store.backend.listDrafts(teamId);
    if(store.team?.id!==teamId)return;
    results.replaceChildren();
    for(const d of drafts)button(`${d.id.slice(0,8)} - ${d.status} - revision ${d.revision}`,()=>openDraft(d.id),results);
    if(!drafts.length)results.append(el('p','No drafts yet.'));
   },section);
   section.append(results);
  }
 }
 sessionButtons();
 $('join-session').disabled=!store.user||demo;
 showIfClosed('session-dialog');
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

const teamIdentity=mountTeamIdentity($('team-identity'),()=>demo?{user:{id:captainDemo?'demo-2':'demo-you'},teams:[sampleTeam],backend:demoIdentityBackend,demo:true}:{user:store.user,teams:store.teams,teamId:store.homeTeamId||store.team?.id,backend:store.backend},(id,name,imageId)=>{
 if(demo)Object.assign(sampleTeam,{name,identity_image_id:imageId});
 store.teams=store.teams.map(item=>item.id===id?{...item,name,identity_image_id:imageId}:item);
 if(store.homeTeamId===id)renderTeamHome();
});
ui.teamIdentity=teamIdentity;
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
const sampleTeam={id:'demo-team',name:'Night Shift',owner_user_id:'demo-2'};
function renderTeamHome(message=''){
 const root=$('team-home');
 const active=demo?sampleTeam:store.teams.find(item=>item.id===store.homeTeamId);
 const me=demo?(captainDemo?'demo-2':'demo-0'):store.user?.id||'local-player';
 const current={...store.profile,userId:me,displayName:store.profile.displayName||'You'};
 const source=demo?demoState().roster.map(item=>({...item.selfReport,userId:item.id,displayName:item.name})):store.homeRoster;
 const players=active?source.map(item=>item.userId===me?{...item,...current}:item):[current];
 if(active&&!players.some(item=>item.userId===me)&&me)players.push(current);
 const title=el('h1',active?.name||'Your player home');title.id='team-title';title.tabIndex=-1;
 root.replaceChildren(title);
 if(active?.identity_image_id&&(demo||store.backend)){
  const request=store.homeRequest;
  void (demo?demoIdentityBackend:store.backend).getTeamIdentityImage(active.identity_image_id).then(image=>{
   if(request!==store.homeRequest||!title.isConnected||!['image/png','image/jpeg','image/webp'].includes(image?.mime))return;
   const logo=el('img',null,'team-home-emblem');logo.alt='Team emblem';logo.src='data:'+image.mime+';base64,'+image.data;title.before(logo);
  }).catch(()=>{});
 }
 if(!demo&&store.teams.length>1){
  const switcher=el('select');switcher.setAttribute('aria-label','Choose team');
  for(const item of store.teams)switcher.append(new Option(item.name,item.id));
  switcher.value=store.homeTeamId;switcher.onchange=()=>navigateTeam(switcher.value);root.append(switcher);
 }
 if(message){const status=el('p',message);status.setAttribute('role','status');root.append(status);}
 const stage=el('div',null,'team-home-stage');
 const captain=players.find(item=>item.userId===active?.owner_user_id);
 const others=players.filter(item=>item!==captain);
 const starters=others.slice(0,captain?4:5);
 if(captain)starters.splice(Math.floor(starters.length/2),0,captain);
 stage.dataset.count=String(starters.length);
 function card(player){
  const captainCard=player===captain;
  const node=el('article',null,'team-home-card');
  node.dataset.captain=String(captainCard);
  const choices=(player.signatureHeroes||[]).filter(id=>store.heroes[id]);
  const seed=Array.from(String(player.userId||'solo')).reduce((sum,ch)=>(sum*31+ch.charCodeAt(0))>>>0,0);
  const hero=store.heroes[player.avatarHeroId]?player.avatarHeroId:choices[seed%choices.length];
  if(hero)node.append(portrait(hero));else node.append(el('div',(player.displayName||'Player').slice(0,1).toUpperCase(),'team-home-placeholder'));
  node.append(el('h2',player.displayName||'Teammate'));
  const label=[captainCard?'Captain':null,player.userId===me?'You':null,...(player.preferredRoles||[]).map(role=>'P'+role)].filter(Boolean);
  if(label.length)node.append(el('p',label.join(' · ')));
  return node;
 }
 stage.append(...starters.map(card));root.append(stage);
 if(others.length>starters.filter(item=>item!==captain).length){
  const extra=el('details',null,'team-home-extra');
  extra.append(el('summary','More teammates'),...others.slice(captain?4:5).map(player=>el('p',player.displayName||'Teammate')));
  root.append(extra);
 }
 if(!demo&&active?.owner_user_id===me&&store.homeRoster.length>1){
  const manage=el('details',null,'team-roster-details');
  manage.append(el('summary','Manage teammates'));
  const status=el('p');status.setAttribute('role','status');
  const account=store.user.id, request=store.homeRequest;
  let removing=false;
  for(const member of store.homeRoster.filter(item=>item.userId!==account)){
   const row=el('div',null,'team-member-management');
   const label=member.displayName||'Teammate';
   row.append(el('strong',label));
   const remove=button('Remove '+label,async()=>{
    if(removing||request!==store.homeRequest||store.user?.id!==account)return;
    if(!confirm('Remove '+label+' from '+active.name+'? This also releases their team Battle Cup spot and draft control, and resets the team invite link.'))return;
    removing=true;remove.disabled=true;
    try{
     await store.backend.removeTeamMember(active.id,member.userId,account);
     if(request!==store.homeRequest||store.user?.id!==account)return;
     if(store.team?.id===active.id){
      ++store.teamLoad;
      store.teamRoster=store.teamRoster.filter(item=>item.userId!==member.userId);
      store.selectedTeamIds=store.selectedTeamIds.filter(id=>id!==member.userId);
     }
     store.homeRoster=store.homeRoster.filter(item=>item.userId!==member.userId);
     // Removal resets the invite code server-side; reload teams so Copy invite link uses the new one.
     let reloaded=true;
     try{const fresh=await store.backend.listTeams();if(request===store.homeRequest&&store.user?.id===account){store.teams=fresh;if(store.team)store.team=store.teams.find(t=>t.id===store.team.id)||store.team;}}
     catch{reloaded=false;store.teams=store.teams.map(t=>t.id===active.id?{...t,invite_code:undefined}:t);if(store.team?.id===active.id)store.team={...store.team,invite_code:undefined};}
     if(request!==store.homeRequest||store.user?.id!==account)return;
     renderTeamHome(label+' was removed from the team. The team invite link was reset'+(reloaded?': share the new one with players who have not joined yet.':'. Reload the page to get the new link.'));
     renderRoster();
     root.querySelector('summary')?.focus();
    }catch(error){status.textContent=error.code==='PGRST202'?'Team removal is not available yet.':'Could not remove this player. Try again.';}
    finally{removing=false;remove.disabled=false;}
   },row);
   manage.append(row);
  }
  manage.append(status);root.append(manage);
 }
 const actions=el('div',null,'team-home-actions');
 button('Edit my profile',()=>profileDialog(),actions);
 if(!active&&store.user)button('Create or join a team',lobby,actions);
 button('Battle Cup',navigateCup,actions);
 button('Open draft board',focusDraftView,actions,'primary');
 root.append(actions);
}
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
