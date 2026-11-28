// Team page: team identity and the team home panel.
import {mountTeamIdentity,demoIdentityBackend} from './team-identity.js';
import {demoState} from './demo.js';
import {demo,captainDemo} from './url-state.js';
import {store} from './store.js';
import {$,el,button,focusDraftView} from './dom.js';
import {ui} from './ui.js';
import {portrait} from './draft-data.js';
import {renderRoster} from './board-view.js';
import {profileDialog} from './profile-dialog.js';
import {lobby} from './setup-dialog.js';

export const teamIdentity=mountTeamIdentity($('team-identity'),()=>demo?{user:{id:captainDemo?'demo-2':'demo-you'},teams:[sampleTeam],backend:demoIdentityBackend,demo:true}:{user:store.user,teams:store.teams,teamId:store.homeTeamId||store.team?.id,backend:store.backend},(id,name,imageId)=>{
 if(demo)Object.assign(sampleTeam,{name,identity_image_id:imageId});
 store.teams=store.teams.map(item=>item.id===id?{...item,name,identity_image_id:imageId}:item);
 if(store.homeTeamId===id)renderTeamHome();
});
export const sampleTeam={id:'demo-team',name:'Night Shift',owner_user_id:'demo-2'};
export function renderTeamHome(message=''){
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
  switcher.value=store.homeTeamId;switcher.onchange=()=>ui.navigateTeam(switcher.value);root.append(switcher);
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
 button('Battle Cup',ui.navigateCup,actions);
 button('Open draft board',focusDraftView,actions,'primary');
 root.append(actions);
}
