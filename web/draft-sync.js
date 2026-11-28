// Shared drafts and team loading: mutate, adopt, open, poll, leave and owner actions.
// Generation counters discard responses that arrive after the account, team or draft changed.
import {resetAllyEntry} from './war-room.js';
import {initialState,demoState,reduceDraft} from './demo.js';
import {ROSTER_SIZE} from './constants.js';
import {demo,playerDemo} from './url-state.js';
import {store} from './store.js';
import {$,notice,safe,focusDraftView} from './dom.js';
import {ui,render} from './ui.js';
import {resetDraftData,canWrite} from './draft-data.js';
import {saveLocal,restorePractice} from './practice-store.js';
import {refreshScouting} from './scouting.js';
const ROSTER_REFRESH_MS=30000;
let draftOpen=0;
export function detachWorkspace(){
 ui.stopLiveWatch();resetAllyEntry();
 ++store.generation;++draftOpen;++store.teamLoad;store.shared=null;store.pending=false;store.healthy=true;store.polling=false;store.selected=null;store.localControl=true;
 store.state=demo?demoState():initialState();
 resetDraftData();store.reviewVisible=true;
}
export function enterPractice({navigate=true}={}){
 detachWorkspace();restorePractice();
 if(navigate){const url=new URL(location.href);url.searchParams.delete('draft');url.searchParams.set('practice','');history.pushState(null,'',url);}
 $('draft-button').click();
 render();refreshScouting();
}


// After a rejected change: adopt the draft as the server has it, unless this view moved on.
async function reloadDraft(id,gen){
 try{const row=await store.backend.getDraft(id);if(gen===store.generation){adopt(row);store.healthy=true;}}catch{if(gen===store.generation)store.healthy=false;}
}
export async function mutate(operation,payload={}){
 if(playerDemo)return;
 if(store.pending) return;
 if(!['claim','release'].includes(operation)&&!canWrite())throw Error('Become the confirmed drafter first.');
 store.pending=true;
 render();
 const gen=store.generation;
 try{
  if(store.shared){
   const id=store.shared.id;
   try{
    const row=await store.backend.mutateDraft(id,store.shared.revision,operation,payload);
    if(gen===store.generation)adopt(row);
   }catch(e){if(gen===store.generation){await reloadDraft(id,gen);throw Error(e.message+' · Current state reloaded where available. Repeat deliberately.');}}
  }else{
   if(operation==='claim')store.localControl=true;else if(operation==='release')store.localControl=false;else if(operation==='set_state'){
    if('firstPick'in payload)store.state=reduceDraft(store.state,'set_first_pick',payload,{canWrite:true});
    store.state={...store.state,...payload};
   }else store.state=reduceDraft(store.state,operation,payload,{canWrite:true,heroes:store.heroes});
   saveLocal();
  }
  store.selected=null;
  $('hero-search').value='';
  store.searchIndex=0;
  refreshScouting();
 }finally{if(gen===store.generation){store.pending=false;render();}}
}

function adopt(row){
 if(!row||store.shared&&row.id!==store.shared.id)return;
 if(store.shared&&row.revision<store.shared.revision)return;
 store.shared=row;
 store.state={...initialState(),...row.state};
 store.healthy=true;
 refreshScouting();
}

export async function openDraft(id,{navigate=true}={}){
 if(!store.user||demo)throw Error('Sign in to open a shared draft.');
 const currentUser=store.user.id,gen=store.generation,request=++draftOpen;
 let row;
 try{
  row=await store.backend.getDraft(id);
 }catch(error){if(error.code==='PGRST116')throw Error('This draft is available to team members only. Ask the captain for a team invitation.');throw error;}
 if(store.user?.id!==currentUser||gen!==store.generation||request!==draftOpen)return;
 ++store.generation;
 store.shared=null;
 resetDraftData();
 store.pending=false;
 store.polling=false;
 store.shared=row;
 store.team=store.teams.find(t=>t.id===row.team_id);
 store.teamRoster=[];
 store.selectedTeamIds=(row.state.roster||[]).filter(p=>p&&typeof p==='object').map(p=>p.userId||p.id);
 adopt(row);
 store.selected=null;
 store.reviewVisible=true;
 if(navigate){
  const url=new URL(location.href);
  url.searchParams.delete('practice');
  url.searchParams.delete('cup');
  url.searchParams.set('draft',id);
  if(url.href!==location.href)history.pushState(null,'',url);
 }
 render();
 $('session-dialog').close();
 ui.welcome.board();
 focusDraftView();
}
export async function poll(){
 if(!store.shared||store.polling||store.pending||!store.user)return;
 store.polling=true;const gen=store.generation,id=store.shared.id;let changed=false,leaving=false;
 try{
  const row=await store.backend.getDraft(id);if(gen!==store.generation)return;
  // Every server-side draft update bumps revision; drafter is compared too as a cheap guard.
  changed=!store.healthy||row.revision!==store.shared.revision||row.drafter_user_id!==store.shared.drafter_user_id;
  if(changed)adopt(row);
  if(Date.now()-store.lastRoster>ROSTER_REFRESH_MS){
   const fresh=await store.backend.loadRoster(row.team_id);
   if(gen===store.generation&&store.team?.id===row.team_id){store.lastRoster=Date.now();store.teamRoster=fresh;}
  }
 }catch(e){
  // The draft is no longer visible: the team was deleted or this account left / was removed.
  if(gen===store.generation&&e.code==='PGRST116'){leaving=true;void safe(()=>leaveVanishedDraft(gen))().finally(()=>{if(gen===store.generation)store.polling=false;});return;}
  if(gen===store.generation){changed=store.healthy;store.healthy=false;notice('Shared state unavailable. Writes paused: '+e.message);}
 }
 finally{if(gen===store.generation){if(!leaving)store.polling=false;if(changed)render();}}
}
async function leaveVanishedDraft(gen){
 const teamId=store.shared?.team_id,name=store.teams.find(t=>t.id===teamId)?.name||'This team',account=store.user?.id;
 let fresh=null;try{fresh=await store.backend.listTeams();}catch{}
 if(gen!==store.generation||store.user?.id!==account)return;
 if(fresh)store.teams=fresh;
 const message=!fresh?'This draft is no longer available to you. Switched to local practice.':fresh.some(t=>t.id===teamId)?'This draft is no longer available. Switched to local practice.':name+' was deleted, or you are no longer a member. Switched to local practice.';
 if(store.team?.id===teamId){++store.teamLoad;store.team=null;store.teamRoster=[];store.selectedTeamIds=[];}
 if(store.homeTeamId===teamId){ui.teamIdentity.clear();store.homeRequest++;store.homeTeamId='';store.homeRoster=[];ui.renderTeamHome();}
 enterPractice();notice(message);
}

export function draftRoster(){
 const rows=store.teamRoster.filter(p=>store.selectedTeamIds.includes(p.userId));
 if(rows.length>5)throw Error('Select at most five players.');
 const accounts=rows.map(p=>p.steamAccountId).filter(Boolean);
 if(new Set(accounts).size!==accounts.length)throw Error('Duplicate public account IDs in selected roster. Resolve profiles or deselect a duplicate.');
 return rows.map(p=>({...p,id:p.userId}));
}

export async function loadTeam(id,{preserveSelection=false}={}){

 const request=++store.teamLoad,gen=store.generation;

 const previous=preserveSelection&&store.team?.id===id?[...store.selectedTeamIds]:null;

 store.team=store.teams.find(t=>t.id===id);

 // Clear stale rows while another team's roster is loading.

 store.teamRoster=[];store.selectedTeamIds=[];

 const rows=id?await store.backend.loadRoster(id):[];

 if(gen!==store.generation||request!==store.teamLoad)return false;

 store.teamRoster=rows;

 store.selectedTeamIds=previous?previous.filter(id=>rows.some(p=>p.userId===id)):rows.filter(p=>p.availability!=='unavailable').slice(0,ROSTER_SIZE).map(p=>p.userId);

 return true;

}

export async function mutateOwner(){
 if(!store.shared||store.pending)return;
 store.pending=true;
 render();
 const gen=store.generation,id=store.shared.id;
 try{
  const row=await store.backend.mutateDraft(id,store.shared.revision,'assign',{userId:store.user.id});
  if(gen===store.generation)adopt(row);
 }catch(e){if(gen===store.generation)await reloadDraft(id,gen);throw e;}finally{if(gen===store.generation){store.pending=false;render();}}
}
