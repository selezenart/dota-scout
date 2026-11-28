// Workspace switching and Team / Battle Cup navigation.
import {mountBattleCup} from './bcup.js';
import {demo} from './url-state.js';
import {store} from './store.js';
import {$,safe,focusDraftView} from './dom.js';
import {ui} from './ui.js';
import {loadTeam} from './draft-sync.js';
import {renderRoster} from './board-view.js';
import {profileDialog} from './profile-dialog.js';
import {lobby} from './setup-dialog.js';
import {teamIdentity,sampleTeam,renderTeamHome} from './team-home.js';
export const cup=mountBattleCup({
 root:$('cup-view'),
 getContext:()=>({user:store.user,teams:store.teams,teamId:store.team?.id,backend:store.backend,demo,profileReady:demo||store.profileSaved,profileHasDraftDetails:demo||!!(store.profile.preferredRoles?.length&&(store.profile.signatureHeroes?.length||store.profile.desiredHeroes?.length)),version:store.cupAccountVersion}),
 onSignIn:()=>ui.welcome.home('signin'),
 onSetup:safe(lobby),
 onTeam:safe(async id=>{if(!demo&&id&&await loadTeam(id)===false)return;navigateTeam(id);}),
 onProfile:()=>profileDialog(false,null,true),
 onToday:()=>profileDialog(false,null,true,1),
 onDraft:()=>{focusDraftView();},
});
export function showWorkspace(view){
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
export function leaveCup(){
 const url=new URL(location.href);
 if(url.searchParams.has('cup')){
  url.searchParams.delete('cup');
  // Back from Cup during a shared draft: keep its link so refresh/copy still opens the draft.
  if(store.shared&&!demo&&!url.searchParams.has('draft'))url.searchParams.set('draft',store.shared.id);
  else if(!url.searchParams.has('draft')&&!url.searchParams.has('demo')&&!url.searchParams.has('mock'))url.searchParams.set('practice','');
  history.pushState(null,'',url);
 }
}
export function openCup(){showWorkspace('cup');ui.welcome.board();void cup.refresh();}
export function navigateTeam(id){
 const chosen=demo?sampleTeam:store.teams.find(item=>item.id===(id||store.homeTeamId||store.team?.id))||store.teams[0];
 const request=++store.homeRequest, account=store.user?.id;
 store.homeTeamId=chosen?.id||'';
 store.homeRoster=[];
 const url=new URL(location.href);
 url.searchParams.delete('cup');url.searchParams.delete('practice');url.searchParams.delete('draft');
 url.searchParams.set('team','');
 if(url.href!==location.href)history.pushState(null,'',url);
 showWorkspace('team');ui.welcome.board();renderRoster();
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

export function navigateCup(){
 const url=new URL(location.href);url.searchParams.delete('draft');url.searchParams.delete('team');url.searchParams.set('cup','');
 if(url.href!==location.href)history.pushState(null,'',url);
 openCup();
}
