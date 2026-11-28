// Setup dialog: team, roster, enemies, live lobby and draft sessions.
import {parseAccountIds} from './draft-engine.js';
import {LOCAL_HELPER_ORIGIN,ROSTER_SIZE} from './constants.js';
import {demo,teamInviteCode,codeFromInvitation} from './url-state.js';
import {store} from './store.js';
import {$,el,notice,safe,button,field,showIfClosed} from './dom.js';
import {ui} from './ui.js';
import {accountOf,memberId,canWrite} from './draft-data.js';
import {addEnemyMatches} from './enemy-intel.js';
import {enterPractice,mutate,openDraft,draftRoster,loadTeam,mutateOwner} from './draft-sync.js';
import {stopLiveWatch,checkLiveWatch} from './live-watch.js';

let lobbyEdited=false;
function sessionButtons(){
 $('create-session').disabled=!store.user||!store.team||demo;
 $('create-session').textContent=store.team?'Create draft for '+store.team.name:'Create shared draft';
 $('create-session-hint').textContent=demo?'The demo never creates shared drafts.':!store.user?'Sign in to create a shared draft with your team.':!store.team?(store.teams.length?'Select an active team below to create a shared draft.':'Create or join a team below to create a shared draft.'):'';
}
export async function lobby(){
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
    if(store.homeTeamId===leaving.id){ui.teamIdentity.clear();store.homeRequest++;store.homeTeamId='';store.homeRoster=[];ui.renderTeamHome();}
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
