import {signupProgress} from './signup-progress.js';
import {mountTeamIdentity, showIdentityDownload, demoIdentityBackend} from './team-identity.js';
import {liveLineup} from './live-roster.js';
import {mountBattleCup} from './bcup.js';
import {createWelcome} from './welcome.js';

import snapshot from './heroes.json';

import {CM_ORDER,nextTurn,recommend,parseAccountIds,normalizeProfile,enemySummary,enemyMatchReport,relevantEnemyMatches,enemySightings,diverseTop,reviewLineup} from './draft-engine.js';
import {comfortRows,enemyBanTarget,allyCounterBans,recentCupGames,tileMark,heroStatRows,sourceStatus,MIN_GAMES} from './draft-stats.js';
import {renderPlayerRail} from './war-room.js';

import {publicData,loadPlayer,loadHeroes} from './data.js';
// Namespace import keeps optional scouting helpers off the strict named-import list.
import * as matchData from './data.js';

import {initialState,demoState,reduceDraft} from './demo.js';

import {createBackend} from './backend.js';



const $=id=>document.getElementById(id);

const demo=new URLSearchParams(location.search).has('demo')||new URLSearchParams(location.search).has('mock');

const captainDemo=demo&&new URLSearchParams(location.search).has('captain');
const playerDemo=demo&&new URLSearchParams(location.search).has('player');
const playerDemoHeroes=[1,13,2,26,5,44,29,8,74,11,12,14,23,86,30,25,34,28,36,37,38,39,55,60];
const draftIntentKey='captain-pending-draft';
const validDraftId=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||'');
function pendingDraft(){try{const value=sessionStorage.getItem(draftIntentKey);return validDraftId(value)?value:null;}catch{return null;}}
function forgetDraft(){try{sessionStorage.removeItem(draftIntentKey);}catch{}}
const entryDraft=new URLSearchParams(location.search).get('draft');
if(validDraftId(entryDraft)&&!demo){try{sessionStorage.setItem(draftIntentKey,entryDraft);}catch{}}

const teamInviteKey='captain-team-invite-v1',teamInviteCode=/^[a-f0-9]{64}$/;
let teamInvitation=null,invitationView=null,accountReady=Promise.resolve(),accountGen=0,observedAuthUser,authEvent=0;

function saveInvitation(code){
 // Storage is shared by same-origin tabs so the confirmation email can open a new tab.
 // Never attach the invitation credential to an auth redirect or request URL.
 const record=JSON.stringify({code,until:Date.now()+30*86400000});
 try{localStorage.setItem(teamInviteKey,record);}catch{try{sessionStorage.setItem(teamInviteKey,record);}catch{}}
}

function forgetInvitation(code){
 if(!code)return;
 for(const store of ['localStorage','sessionStorage'])try{
  const storage=window[store];
  if(JSON.parse(storage.getItem(teamInviteKey)||'null')?.code===code)storage.removeItem(teamInviteKey);
 }catch{}
}

function readInvitation({restore=false}={}){
 const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1));
 const codes=[...fragment.getAll('invite'),...url.searchParams.getAll('invite')];
 if(codes.length){
  const code=codes.length===1&&teamInviteCode.test(codes[0])?codes[0]:null;
  if(fragment.has('invite')){fragment.delete('invite');url.hash=fragment.toString();}
  url.searchParams.delete('invite');history.replaceState(history.state,'',url);
  if(code)saveInvitation(code);
  return {code};
 }
 if(!restore||url.searchParams.has('draft')||url.searchParams.has('practice'))return null;
 let raw;
 try{raw=localStorage.getItem(teamInviteKey);}catch{try{raw=sessionStorage.getItem(teamInviteKey);}catch{}}
 try{
  const saved=JSON.parse(raw||'null');
  if(saved&&saved.until>Date.now()&&teamInviteCode.test(saved.code))return {code:saved.code};
  if(saved)forgetInvitation(saved.code);
 }catch{}
 return null;
}

if(!demo)teamInvitation=readInvitation({restore:true});

const storageKey=demo?'captain-demo-v1':'captain-practice-v1';

let heroes=snapshot,state=demo?demoState():initialState(),profile=captainDemo?{displayName:'Lee',preferredRoles:[3],signatureHeroes:[2,29],desiredHeroes:[29]}:demo?{displayName:'Alex',preferredRoles:[1,2],roleComfort:{1:4,2:3},signatureHeroes:[1,8,44],desiredHeroes:[8],avoidHeroes:[]}: {},backend,user,shared,teams=[],team,selected=null,pending=false,localControl=true,generation=0,polling=false,healthy=true,lastRoster=0;

// STRATZ Divine+ counters/synergy per picked hero; hero-level, so kept across drafts.
let stratz={},stratzRequested=new Set();
let observations=new Map(),matchups={},requestedMatchups=new Set(),draftOpen=0,reviewVisible=true;
// Optional seat data: kept apart from `matchups`, which recommend() reads.
let allyCounterMatchups={},focusedPlayer=null,suggestionCache={key:'',pick:new Set(),ban:new Set()};
const matchupErrors=new Set(),allyCounterRequests=new Set(),allyCounterFailures=new Set();

try {const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved&&!demo){state={...initialState(),...saved.state};profile=saved.profile||{};}}catch{}

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};

const notice=text=>{
 const dialog=document.querySelector('dialog[open]');
 let target=dialog?.querySelector('[data-dialog-notice]');
 if(dialog&&!target){target=el('p',null,'session-feedback');target.dataset.dialogNotice='';target.setAttribute('role','status');dialog.append(target);}
 (target||$('notice')).textContent=text;
 if(dialog?.id==='session-dialog'){$('session-input').setAttribute('aria-describedby',target.id||(target.id='session-notice'));}
};

const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>notice(e.message||'Operation failed'));

function button(text,fn,parent,cls){const b=el('button',text,cls);b.type='button';b.onclick=safe(fn);parent?.append(b);return b;}

function field(parent,label,value='',type='text'){const l=el('label',label),i=el(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;i.value=value;l.append(i);parent.append(l);return i;}

function practiceKey(){return user?'captain-practice-v1:'+user.id:storageKey;}
function saveLocal(){if(!shared&&!demo)try{localStorage.setItem(practiceKey(),JSON.stringify({state,profile}));}catch{}}
function restorePractice(){
 state=initialState();
 try{const saved=JSON.parse(localStorage.getItem(practiceKey())||'null');if(saved){state={...initialState(),...saved.state};if(!user)profile=saved.profile||{};return;}}catch{}
 if(user)state.roster=[{...profile,id:user.id}];
}
function resetDraftData(){observations.clear();matchups={};requestedMatchups.clear();matchupErrors.clear();allyCounterMatchups={};allyCounterRequests.clear();allyCounterFailures.clear();suggestionCache={key:'',pick:new Set(),ban:new Set()};focusedPlayer=null;}
function detachWorkspace(){
 stopLiveWatch();
 ++generation;++draftOpen;++teamLoad;shared=null;pending=false;healthy=true;polling=false;selected=null;localControl=true;
 state=demo?demoState():initialState();
 resetDraftData();reviewVisible=true;
}
function enterPractice({navigate=true}={}){
 detachWorkspace();restorePractice();
 if(navigate){const url=new URL(location.href);url.searchParams.delete('draft');url.searchParams.set('practice','');history.pushState(null,'',url);}
 $('draft-button').click();
 render();refreshScouting();
}
function focusDraftView(){ $('draft-button').click();$('surface-heroes').checked=true;$('hero-search').focus(); }
function matchupCoverage(){
 const ours=state.actions.filter(a=>a.mode==='ourPick'),enemies=state.actions.filter(a=>a.mode==='enemyPick');
 let observed=0;
 for(const ally of ours)for(const enemy of enemies){if((matchups[ally.heroId]||[]).some(row=>+row.hero_id===+enemy.heroId&&+row.games_played>0)||(matchups[enemy.heroId]||[]).some(row=>+row.hero_id===+ally.heroId&&+row.games_played>0))observed++;}
 return {observed,total:ours.length*enemies.length};
}

const canWrite=()=>!playerDemo&&!pending&&healthy&&(shared?!!user&&shared.drafter_user_id===user.id:localControl);

const roleNames=['Carry','Mid','Offlane','Soft support','Hard support'];

const heroName=id=>heroes[id]?.localized_name||'Unknown hero';

function portrait(id){const h=heroes[id],img=el('img');img.alt=heroName(id);img.loading='lazy';img.src='https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/'+String(h?.name||'').replace('npc_dota_hero_','')+'.png';return img;}

function roster(){return (Array.isArray(state.roster)?state.roster:[]).filter(p=>p&&typeof p==='object'&&!Array.isArray(p)).map(p=>normalizeProfile({...observations.get(String(p.steamAccountId||p.accountId||'')),...p,name:p.displayName||p.name||observations.get(String(p.steamAccountId||p.accountId||''))?.name,id:p.id||p.userId,selfReport:p.selfReport||p}));}

function opponents(){return demo?(state.opponents||[]).map(p=>normalizeProfile(p)):(state.enemyIds||[]).map(id=>normalizeProfile(observations.get(String(id))||{id,name:String(id)}));}

// Failed loads (often OpenDota's per-IP rate limit, shared by every open board) are
// retried a few times per draft; meanwhile the card says it is waiting.
const scoutRetries=new Map();
function scout(ids){const gen=generation;for(const id of ids.filter(Boolean)){const key=String(id);if(observations.has(key))continue;observations.set(key,{id:key,sources:{profile:{status:'fetching'}}});void loadPlayer(id,p=>{if(gen!==generation)return;observations.set(key,{...p,sources:{...p.sources}});render();}).then(p=>{
 if(gen!==generation)return;
 const failed=Object.values(p.sources||{}).filter(s=>s?.status==='error');if(!failed.length)return;
 const tries=scoutRetries.get(gen+':'+key)||0;if(tries>=3)return;
 scoutRetries.set(gen+':'+key,tries+1);
 const sources=Object.fromEntries(Object.entries(p.sources).map(([k,s])=>[k,s?.status==='error'?{...s,retrying:true}:s]));
 observations.set(key,{...p,sources});render();
 // Re-scout through refreshScouting so a player removed meanwhile is not fetched again.
 setTimeout(()=>{if(gen!==generation||observations.get(key)?.sources!==sources)return;observations.delete(key);refreshScouting();},failed.some(s=>s.rateLimited)?20000:8000);
}).catch(e=>{if(gen===generation)notice(e.message);});}}

// Credit for STRATZ counter and synergy data, shown once whenever it is in use.
function appendStratzCredit(){
 const root=$('suggestions');if(!root||root.querySelector('.stratz-credit')||!state.actions.some(a=>stratz[a.heroId]))return;
 const credit=el('a','Powered by STRATZ','stratz-credit');credit.href='https://stratz.com';credit.target='_blank';credit.rel='noopener noreferrer';root.append(credit);
}
const stratzFailures=new Map();
function requestStratz(id){
 if(demo||stratzRequested.has(String(id)))return;
 stratzRequested.add(String(id));
 void Promise.resolve().then(()=>matchData.loadStratz(id)).then(data=>{if(Array.isArray(data?.vs)&&Array.isArray(data?.with)){stratz[id]=data;render();}})
  // Back off 1, 2, 4… minutes (at most 15), then retry on its own while the hero is still picked.
  .catch(()=>{const n=(stratzFailures.get(String(id))||0)+1;stratzFailures.set(String(id),n);setTimeout(()=>{stratzRequested.delete(String(id));if(state.actions.some(a=>a.mode.endsWith('Pick')&&String(a.heroId)===String(id)))requestStratz(id);},Math.min(900000,60000*2**(n-1)));});
}
function requestMatchup(id){
 if(demo||requestedMatchups.has(id)||matchupErrors.has(id))return;
 requestedMatchups.add(id);
 const gen=generation;
 void publicData.request('/heroes/'+id+'/matchups',{priority:5,ttl:86400000}).then(rows=>{
  if(gen!==generation)return;
  if(!Array.isArray(rows))throw Error('Invalid matchup response');
  matchups[id]=rows;
  render();
 }).catch(()=>{
  if(gen!==generation)return;
  requestedMatchups.delete(id);
  matchupErrors.add(id);
  render();
 });
}
function requestAllyCounters(id){
 if(demo||allyCounterRequests.has(id)||allyCounterFailures.has(id))return;
 allyCounterRequests.add(id);
 const gen=generation;
 void publicData.request('/heroes/'+id+'/matchups',{priority:5,ttl:86400000}).then(rows=>{
  if(gen!==generation)return;
  if(!Array.isArray(rows))throw Error('Invalid matchup response');
  allyCounterMatchups[id]=rows;
  render();
 }).catch(()=>{
  if(gen!==generation)return;
  allyCounterRequests.delete(id);
  allyCounterFailures.add(id);
 });
}
function refreshScouting(){
 if(demo)return;
 const members=(Array.isArray(state.roster)?state.roster:[]).filter(p=>p&&typeof p==='object');
 scout([...(state.enemyIds||[]),...members.map(p=>p.steamAccountId||p.accountId)]);
 for(const action of state.actions.filter(a=>a.mode.endsWith('Pick'))){requestMatchup(action.heroId);requestStratz(action.heroId);}
}

let searchIndex=0,rankedIds=new Set();

let steamEnabled=false,googleEnabled=false,profileSaved=false,profileSetupRequired=false;
const welcome=createWelcome({getBackend:()=>backend,steamEnabled:()=>steamEnabled,googleEnabled:()=>googleEnabled,onSession:authChanged,onRegistered:()=>{if(!shared&&!profileSetupRequired)navigateTeam();},onPractice:()=>{
 forgetDraft();
 if(demo){location.assign('?practice');return false;}
 enterPractice();
},onHome:()=>{forgetDraft();detachWorkspace();},hasDraftInvitation:()=>!!pendingDraft(),onInvitation:showTeamInvitation,hasInvitation:()=>!!teamInvitation?.code,onOpenTeam:safe(async()=>{
 // Same gates as sign-in. While sign-in is still finishing, authChanged resumes the
 // draft, Battle Cup or team itself, so a click must not race it.
 if(openingTeam||resumingAccount===generation||welcome.recovery||showTeamInvitation())return;
 const gen=generation,account=user?.id,ready=accountReady;if(!account)return;
 openingTeam=true;
 try{
  await ready;
  if(gen!==generation||user?.id!==account||welcome.recovery||showTeamInvitation())return;
  if(profileSetupRequired)startProfileSetup(()=>navigateTeam());else navigateTeam();
 }finally{openingTeam=false;}
})});
let openingTeam=false,resumingAccount=null;

function showTeamInvitation(force=false){
 const invitation=teamInvitation;if(!invitation||welcome.recovery)return false;
 const account=user?.id||null;
 if(force!==true&&invitationView?.invitation===invitation&&invitationView.account===account&&$('team-invite-heading'))return true;
 invitationView={invitation,account};
 for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
 welcome.invitation({
  teamName:invitation.teamName,
  account:user&&(profile?.displayName||user.user_metadata?.display_name||user.user_metadata?.full_name||user.user_metadata?.name||(user.email&&!user.email.endsWith('.invalid')?user.email:'Steam player')),invalid:!invitation.code,
  onAccept:async()=>{
   const gen=generation,ready=accountReady,eventAtClick=authEvent;
   const isCurrent=()=>gen===generation&&user?.id===account&&invitation===teamInvitation
    &&(authEvent===eventAtClick||observedAuthUser===account);
   if(!account||!isCurrent())throw Error('The active account changed. Open the invitation again.');
   let joined;
   try{joined=await backend.joinTeam(invitation.code,account);}catch(error){
    if(!isCurrent())return;
    if(error.code==='22023'){
     forgetInvitation(invitation.code);
     teamInvitation=null;
     welcome.invitation({invalid:true,expired:true,onDismiss:()=>navigateCup()});
     return;
    }
    throw error;
   }
   if(!joined?.id)throw Error('The team could not be confirmed. Try joining again.');
   await ready;
   if(!isCurrent())return;
   if(!teams.some(t=>t.id===joined.id))teams=[...teams,joined];
   forgetInvitation(invitation.code);teamInvitation=null;
   if(shared){detachWorkspace();restorePractice();}
   const url=new URL(location.href);url.searchParams.delete('draft');url.searchParams.delete('practice');history.replaceState(history.state,'',url);
   const roster=loadTeam(joined.id);
   if(profileSetupRequired)startProfileSetup(()=>navigateTeam(joined.id),joined);
   else{navigateTeam(joined.id);profileDialog(false,joined);}
   void roster.catch(()=>{}); // Setup can retry loading the selected roster independently.
  },
  onSwitch:async()=>{await backend.signOut();if(user?.id===account)await authChanged(null);},
  onDismiss:()=>{if(teamInvitation!==invitation)return;forgetInvitation(invitation.code);teamInvitation=null;if(user)welcome.board();else welcome.home();},
 });
 if(invitation.code&&backend?.previewTeamInvitation&&!invitation.previewRequested){
  invitation.previewRequested=true;
  void backend.previewTeamInvitation(invitation.code).then(name=>{
   if(teamInvitation!==invitation||!name)return;
   invitation.teamName=name;
   const heading=$('team-invite-heading');
   if(heading)heading.textContent='Join '+name;
  }).catch(()=>{}); // Older databases can still accept the invite.
 }
 return true;
}

function codeFromInvitation(input){
 const value=input.trim();
 let url;try{url=new URL(value);}catch{return value;}
 const fragment=new URLSearchParams(url.hash.slice(1));
 const codes=[...fragment.getAll('invite'),...url.searchParams.getAll('invite')];
 if(url.origin!==location.origin||codes.length!==1||!teamInviteCode.test(codes[0]))throw Error('Enter a team invite link from this site or paste the invitation code.');
 return codes[0];
}

function stage(id,rec){
 selected={id,...rec};
 render();
 const confirm=$('suggestions').querySelector('button.primary');
 if(!confirm||confirm.disabled)return;
 confirm.focus({preventScroll:true});
 const bounds=confirm.getBoundingClientRect();
 if(bounds.top<0||bounds.bottom>window.innerHeight)confirm.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}

function render(){
 const active=document.activeElement;
 let selector=active?.id?'#'+active.id:active?.dataset.heroId?'[data-hero-id="'+active.dataset.heroId+'"]':active?.name?'[name="'+active.name+'"][value="'+active.value+'"]':active?.classList.contains('primary')&&active.closest('#suggestions')?'#suggestions button.primary':null;
 const value=active?.value;
 renderView();
 if(selector&&!active.isConnected){const replacement=document.querySelector(selector);if(replacement){if(replacement.tagName==='SELECT'&&[...replacement.options].some(o=>o.value===value))replacement.value=value;replacement.focus({preventScroll:true});}}
}
function renderView(){
 $('signout-button').hidden=!user||demo;

 const turn=nextTurn(state.actions,state.firstPick),write=canWrite();

 $('connection-status').textContent=demo?'Demo · sample data':shared?(healthy?'Shared · synced':'Shared · reconnecting'):'Practice · this device';

 $('session-code').textContent=shared?shared.id.slice(0,8):'Local';$('copy-session').disabled=!shared;

 $('session-status').textContent=shared&&!write?'Following draft · updates sync automatically. Become drafter to make changes.':demo?'Demo never writes to the backend.':user?'Signed in · select a team and draft.':'Local practice. Sign in for shared drafts.';

 $('draft-owner').textContent=playerDemo?'Sam · captain controls the draft':shared?(shared.drafter_user_id?(roster().find(p=>p.id===shared.drafter_user_id)?.name||'Team member')+' controls the draft':'Seat available'):(localControl?'You · local practice':'Local seat available');

 $('claim-drafter').disabled=pending||!healthy||!!(shared?.drafter_user_id)||(!shared&&localControl);$('release-drafter').hidden=shared?!user||!(shared.drafter_user_id===user.id||teams.find(t=>t.id===shared.team_id)?.owner_user_id===user.id):!localControl;

 if(playerDemo){
  $('claim-drafter').hidden=true;
  $('release-drafter').hidden=true;
  $('drafter-seat').hidden=true;
  $('session-status').textContent='Player demo · follow the captain’s picks and bans.';
 }
 $('turn-label').textContent=turn?(turn.side==='our'?'Our ':'Enemy ')+turn.action:'Draft complete';$('turn-progress').textContent=`${state.actions.length} / 24 actions · ${demo?'Invented demo':shared?'Shared team draft':'Manual practice'}`;

 $('undo').disabled=!write||!state.actions.length;$('reset-draft').disabled=!write;$('first-pick').checked=state.firstPick;$('first-pick').disabled=!write||!!state.actions.length;

 renderSeats();renderDraftTree();

 for(const side of ['our','enemy']){const list=$(side+'-lineup');list.replaceChildren();const picks=state.actions.filter(a=>a.mode===side+'Pick');for(let i=0;i<5;i++){const li=el('li',null,'lineup-slot'),a=picks[i];if(a)li.append(portrait(a.heroId));else li.append(el('span',String(i+1).padStart(2,'0'),'slot-portrait'));li.append(el('span',a?heroName(a.heroId)+(a.position?' · P'+a.position:''):'Empty','slot-name'));list.append(li);}}

 renderRecommendations(turn,write);appendStratzCredit();renderHeroes();renderRoster();renderDraftEnemies();

 $('analysis').hidden=!!turn||!reviewVisible;if(turn)$('analysis').replaceChildren();if(!turn){const n=$('analysis');n.replaceChildren(el('h2','Draft review'),el('p','Heuristic composition review; ranking indices are not win probabilities. Missing public history remains unknown.'));const review=reviewLineup({draft:state.actions,stratz,heroes});for(const side of ['our','enemy']){const picks=state.actions.filter(a=>a.mode===side+'Pick'),info=review[side];n.append(el('h3',side==='our'?'Our lineup':'Enemy lineup'));for(const a of picks){const row=el('div',null,'review-player');row.append(portrait(a.heroId),el('p',heroName(a.heroId)+(a.position?' · Position '+a.position:' · Position unassigned')+(a.playerId?' · '+(roster().find(p=>p.id===a.playerId)?.name||a.playerId):'')));n.append(row);const notes=el('ul',null,'review-notes');for(const note of info.heroes.find(h=>h.heroId===+a.heroId)?.notes||[])notes.append(el('li',note.text,'review-note-'+note.tone));n.append(notes);}n.append(el('p','Matchup edge (Divine+): '+(info.edge===null?'no data':`${info.edge>=0?'+':''}${info.edge.toFixed(1)} per matchup across ${info.pairs} matchups`)));}if([...review.our.heroes,...review.enemy.heroes].some(h=>h.notes.some(x=>x.tone!=='info'))){const credit=el('a','Powered by STRATZ','stratz-credit');credit.href='https://stratz.com';credit.target='_blank';credit.rel='noopener noreferrer';n.append(credit);}n.append(el('p',`Observed matchup coverage: ${matchupCoverage().observed} / ${matchupCoverage().total} opposing pairs observed; missing pairs have no matchup evidence. Bans: `+state.actions.filter(a=>a.mode.endsWith('Ban')).map(a=>heroName(a.heroId)).join(', ')));button('Show hero board',()=>{reviewVisible=false;render();},n);}
 if(!turn&&!$('analysis').hidden)renderEnemyAssignment($('analysis'));

}

const SEAT_STATUS={loading:'Loading…',waiting:'Waiting for OpenDota…',closed:'Closed account',error:'Stats unavailable'};
function seatData(player,side,taken,now){
 const hasAccount=side==='enemy'||player.steamAccountId||player.accountId;
 const summary=enemySummary(player,{now,heroes:Object.values(heroes)}),state=hasAccount?summary.state:'ready';
 const usable=state==='ready'||(side==='ally'&&!hasAccount);
 const stats={topHeroes:heroStatRows(player.heroes)};
 // An absence label is only true once the sources behind it have answered.
 const absence=(keys,empty)=>{
  if(!hasAccount)return empty;
  if(state!=='ready')return SEAT_STATUS[state];
  const status=sourceStatus(player,keys);
  return status==='ok'?empty:SEAT_STATUS[status];
 };
 const heroesKnown=!hasAccount||sourceStatus(player,['heroes'])==='ok';
 const comfort=usable?comfortRows({player,summary:stats,side}).map(row=>heroesKnown||row.games?row:{...row,unavailable:true}):[];
 let banLabel='Ban suggestions',bans='No counter data',banIds=[];
 if(side==='enemy'){
  banLabel='Ban first';
  const target=usable?enemyBanTarget(stats,taken):null;
  bans=target?`${heroName(target.heroId)} · ${target.winRate}%`:absence(['heroes'],'No clear ban');
  if(target)banIds=[+target.heroId];
 }else if(comfort[0]){
  requestAllyCounters(comfort[0].heroId);
  const counters=allyCounterBans(comfort[0].heroId,allyCounterMatchups[comfort[0].heroId],taken);
  if(counters.length){bans=counters.map(row=>heroName(row.heroId)).join(', ');banIds=counters.map(row=>+row.heroId);}
 }
 const cup=usable?recentCupGames(player,now):[];
 const position=side==='enemy'?summary.positions?.[0]?.position:player.selfReport.preferredRoles?.[0];
 return {id:String(player.id),name:player.name,side,position,state,comfort,banLabel,bans,cup,cupEmpty:absence(['recent','matches'],'No recent cups'),heroIds:[...new Set([...comfort.map(row=>+row.heroId),...cup.map(game=>+game.heroId),...banIds])]};
}
function renderSeats(){
 const taken=new Set(state.actions.map(action=>+action.heroId)),now=Math.floor(Date.now()/1000);
 renderPlayerRail($('player-rail'),{
  allies:roster().slice(0,5).map(player=>seatData(player,'ally',taken,now)),
  enemies:opponents().slice(0,5).map(player=>seatData(player,'enemy',taken,now)),
  focusId:focusedPlayer,portrait,heroName,
  onToggle:id=>{focusedPlayer=focusedPlayer===id?null:id;render();},
  onAddEnemy:safe(lobby)
 });
}
let freshActionIndex=-1;
function renderDraftTree(){
 const tree=$('timeline');tree.replaceChildren();$('history-inspect').textContent='Select a recorded hero to inspect the action.';
 CM_ORDER.forEach((step,index)=>{
  const ours=step.team===(state.firstPick?'A':'B');
  const recorded=state.actions[index],current=index===state.actions.length;
  const row=el('div',null,'tree-turn');row.dataset.side=ours?'our':'enemy';row.dataset.action=step.action.toLowerCase();
  row.classList.toggle('phase-start',[0,7,9,12,18,22].includes(index));
  const slot=el('button',null,'tree-row');slot.type='button';slot.id='draft-turn-'+index;
  slot.dataset.action=step.action.toLowerCase();slot.dataset.turn=index;
  slot.classList.toggle('is-recorded',!!recorded);slot.classList.toggle('is-fresh',index===freshActionIndex&&!!recorded);slot.classList.toggle('is-current',current);
  const label=`Turn ${index+1}, ${ours?'our':'enemy'} ${step.action.toLowerCase()}${recorded?', '+heroName(recorded.heroId):current?', select a hero':', waiting'}`;
  slot.setAttribute('aria-label',label);slot.title=label;
  if(current)slot.setAttribute('aria-current','step');
  const preview=current&&selected&&heroes[selected.id]&&!state.actions.some(a=>+a.heroId===+selected.id)?selected.id:null;
  if(preview!=null){const text=label+', previewing '+heroName(preview);slot.setAttribute('aria-label',text);slot.title=text;const img=portrait(preview);img.className='tree-hero tree-preview';slot.append(img);}
  else if(recorded){const img=portrait(recorded.heroId);img.className='tree-hero';slot.append(img);}
  else{const placeholder=el('span',null,'tree-placeholder'),icon=el('span',current?step.action.toUpperCase():'');icon.setAttribute('aria-hidden','true');placeholder.append(icon);slot.append(placeholder);}
  slot.disabled=!recorded&&!current;
  slot.onclick=()=>{
   if(current){focusDraftView();return;}
   $('history-inspect').replaceChildren(portrait(recorded.heroId),el('strong',heroName(recorded.heroId)),el('span',(ours?'Our ':'Enemy ')+step.action.toLowerCase()+' · turn '+(index+1)+(recorded.position?' · P'+recorded.position:'')));
  };
  const number=el('span',String(index+1),'tree-number');number.setAttribute('aria-hidden','true');
  row.append(slot,number);tree.append(row);
 });
}

let heroFilter='all';
function focusedHeroIds(taken){
 if(focusedPlayer==null)return null;
 const now=Math.floor(Date.now()/1000);
 const seat=[...roster().slice(0,5).map(p=>[p,'ally']),...opponents().slice(0,5).map(p=>[p,'enemy'])].find(([p])=>String(p.id)===focusedPlayer);
 return seat?new Set(seatData(seat[0],seat[1],taken,now).heroIds):null;
}

function suggestionSets(){
 const seats=[...roster(),...opponents()].map(p=>[p.id,p.availability,p.selfReport,p.heroes,p.recent,p.matches]);
 const key=JSON.stringify([state.actions,state.firstPick,seats,matchups,Object.keys(stratz),Object.keys(heroes).length]);
 if(key===suggestionCache.key)return suggestionCache;
 const input={heroes,draft:state.actions,allies:roster(),opponents:opponents(),matchups,stratz,firstPick:state.firstPick};
 const top=mode=>new Set(recommend({...input,mode}).slice(0,8).map(row=>+row.heroId));
 suggestionCache={key,pick:top('ourPick'),ban:top('ourBan')};
 return suggestionCache;
}
function enemyWinChips(){
 const chips=new Map();
 for(const player of opponents())for(const row of heroStatRows(player.heroes)){
  if(row.winRate==null||row.games<MIN_GAMES||row.winRate<55)continue;
  const current=chips.get(row.heroId);
  if(!current||row.winRate>current.winRate)chips.set(row.heroId,{...row,player:player.name});
 }
 return chips;
}
function renderHeroes(){
 const root=$('hero-groups');root.replaceChildren();
 const ourPick=nextTurn(state.actions,state.firstPick)?.mode==='ourPick';
 const assigned=new Set(state.actions.filter(action=>action.mode==='ourPick').map(action=>action.playerId).filter(Boolean));
 const available=roster().filter(player=>!assigned.has(player.id)&&player.selfReport.availability!=='unavailable');
 const wanted=new Set(ourPick?available.flatMap(player=>player.selfReport.desiredHeroes):[]);
 root.setAttribute('aria-label','Heroes by attribute, A to Z');
 const query=$('hero-search').value.toLowerCase();
 const takenBy=new Map(state.actions.map(action=>[+action.heroId,action.mode])),suggestions=suggestionSets(),chips=enemyWinChips(),playerHeroes=focusedHeroIds(new Set(takenBy.keys()));
 const matches=hero=>hero.localized_name.toLowerCase().includes(query);
 let matched=0;
 const popularity=hero=>Number.isFinite(hero.pub_pick)&&hero.pub_pick>=0?hero.pub_pick:-1;
 for(const [attribute,label] of [['str','Strength'],['agi','Agility'],['int','Intelligence'],['all','Universal']]){
  const attributeFilter=heroFilter==='all-attr'?'all':heroFilter;
  const visibleGroup=heroFilter==='all'||heroFilter==='recommended'||attributeFilter===attribute;
  if(!visibleGroup)continue;
  const list=Object.values(heroes).filter(hero=>hero.primary_attr===attribute&&(heroFilter!=='recommended'||(!takenBy.has(+hero.id)&&rankedIds.has(+hero.id)&&matches(hero))));
  matched+=list.filter(matches).length;
  list.sort((a,b)=>a.localized_name.localeCompare(b.localized_name));
  if(!list.length)continue;
  const section=el('section',null,'hero-group'),grid=el('div',null,'hero-grid'),heading=el('div',null,'attribute-heading');
  section.dataset.attribute=attribute;
  const mark=el('span',null,'attribute-mark');mark.setAttribute('aria-hidden','true');
  heading.append(mark,el('h3',label),el('span',String(list.length),'attribute-count'));section.append(heading,grid);
  for(const hero of list){
   const tile=button('',()=>stage(+hero.id),grid,'hero-tile');tile.dataset.heroId=hero.id;
   tile.classList.toggle('is-wanted',wanted.has(+hero.id));tile.classList.toggle('is-recommended',rankedIds.has(+hero.id));
   tile.setAttribute('aria-label',hero.localized_name);tile.setAttribute('aria-pressed',String(selected?.id===+hero.id));
   tile.title=(wanted.has(+hero.id)?'Teammate wants to play · ':'')+(popularity(hero)>=0?'Public picks: '+hero.pub_pick.toLocaleString():'Public picks unavailable');
   const image=portrait(hero.id),takenMode=takenBy.get(+hero.id),mark=tileMark({takenMode,pick:suggestions.pick.has(+hero.id),ban:suggestions.ban.has(+hero.id)}),chip=takenMode?null:chips.get(+hero.id),state_=takenMode?(takenMode.endsWith('Ban')?', banned':', picked'):mark?.kind==='contested'?', contested':mark?.kind==='sug-pick'?', suggested pick':mark?.kind==='sug-ban'?', suggested ban':'';
   image.alt='';image.onerror=()=>tile.classList.add('is-image-missing');
   tile.title=hero.localized_name+' · '+tile.title+(chip?' · '+chip.player+' '+chip.winRate+'% over '+chip.games+' games':'');
   tile.setAttribute('aria-label',hero.localized_name+state_+(chip?', '+chip.player+' '+chip.winRate+'% over '+chip.games+' games':''));
   tile.disabled=!!takenMode;tile.classList.toggle('is-taken',!!takenMode);tile.classList.toggle('is-search-miss',!!query&&!matches(hero));
   if(playerHeroes){const own=playerHeroes.has(+hero.id);tile.classList.toggle('is-player-hero',own);tile.classList.toggle('is-player-dim',!own&&!takenMode);}
   if(mark)tile.classList.add(mark.kind==='banned'?'is-banned':mark.kind==='picked'?'is-picked':'is-'+mark.kind);
   tile.append(image,el('span',hero.localized_name));
   if(mark){const badge=el('b',mark.text,'tile-mark');badge.setAttribute('aria-hidden','true');tile.append(badge);}
   if(chip){const win=el('b',chip.winRate+'%','tile-win');win.setAttribute('aria-hidden','true');tile.append(win);}
  }
  root.append(section);
 }
 if(!root.children.length||(query&&!matched)){root.replaceChildren();const empty=el('p','No heroes match your search or filters. Try another name or All heroes.');empty.setAttribute('role','status');root.append(empty);}
 highlightSearch();
}

function heroChoices(){return [...$('hero-groups').querySelectorAll('.hero-tile:not(:disabled):not(.is-search-miss)')];}
function highlightSearch(){const all=[...$('hero-groups').querySelectorAll('.hero-tile')],tiles=heroChoices();searchIndex=Math.max(0,Math.min(searchIndex,tiles.length-1));all.forEach(b=>{b.classList.remove('is-highlighted');b.id='hero-result-'+b.dataset.heroId;});tiles[searchIndex]?.classList.add('is-highlighted');const search=$('hero-search');if(tiles[searchIndex])search.setAttribute('aria-activedescendant',tiles[searchIndex].id);else search.removeAttribute('aria-activedescendant');}

function evidenceSummaries(turn){
 const mode=turn.mode,sum=(players,enemy)=>players.map(player=>({player,enemy,stats:heroStatRows(player.heroes)}));
 return {ally:mode==='ourPick'||mode==='enemyBan'?sum(roster(),false):[],enemy:mode==='ourBan'||mode==='enemyPick'?sum(opponents(),true):[]};
}
function heroEvidence(heroId,sources,playerId){
 const rows=[];
 for(const {player,enemy,stats} of [...sources.enemy,...sources.ally]){
  const row=stats.find(item=>item.heroId===+heroId);
  if(row&&row.winRate!=null&&row.games>=MIN_GAMES)rows.push({...row,player,enemy});
 }
 const pick=list=>list.sort((a,b)=>b.winRate-a.winRate||b.games-a.games)[0],own=playerId!=null&&playerId!==''?rows.filter(r=>String(r.player.id)===String(playerId)):[],top=pick(own.length?own:rows);
 return top?`${top.enemy?'Enemy ':''}${top.player.name} · ${top.winRate}% · ${top.games} games`:'';
}

function renderRecommendations(turn,write){const root=$('suggestions');root.replaceChildren();if(!turn){rankedIds.clear();const done=el('div',null,'decision-dock');root.append(done);done.append(el('p','All 24 actions recorded.'));button('Show draft review',()=>{reviewVisible=true;render();},done);return;}const best=el('div',null,'best-now'),dock=el('div',null,'decision-dock');const evidenceSources=evidenceSummaries(turn);root.append(best,dock);const ranked=recommend({heroes,draft:state.actions,allies:roster(),opponents:opponents(),matchups,stratz,firstPick:state.firstPick});rankedIds=new Set(ranked.slice(0,8).map(r=>r.heroId));const rec=selected?ranked.find(r=>r.heroId===selected.id):null;if(selected&&!state.actions.some(a=>+a.heroId===selected.id)){

 const feature=el('div',null,'rec-feature'),body=el('div',null,'rec-body');feature.append(portrait(selected.id),body);body.append(el('h3',heroName(selected.id)),el('p',rec?`Original recommendation: ranking index ${rec.score} · ${rec.playerName||'Unassigned player'}`:'Manual selection · evidence unavailable'));const reasons=[...(rec?.reasons||[]),...(rec?.evidence||[])];
 if(reasons.length)body.append(el('p',reasons[0],'decision-reason'));
 if(reasons.length>1){const details=el('details',null,'decision-reasons');details.append(el('summary','Why this hero'));for(const reason of reasons.slice(1))details.append(el('p',reason));body.append(details);}

 let player,position;if(turn.mode==='ourPick'){const used=state.actions.filter(a=>a.mode==='ourPick'),playerLabel=el('label','Assign allied player','player-assignment');player=el('select');player.id='assigned-player';playerLabel.htmlFor=player.id;player.append(new Option('Unassigned',''));for(const p of roster().filter(p=>!used.some(a=>a.playerId===p.id)))player.append(new Option(p.name,p.id));player.value=selected.playerId??rec?.playerId??'';player.onchange=()=>{selected.playerId=player.value;};playerLabel.append(player);const picker=el('fieldset',null,'position-picker'),options=el('div',null,'position-options'),status=el('p',null,'position-status');status.setAttribute('role','status');position=Object.hasOwn(selected,'position')?selected.position:rec?.position??'';if(used.some(a=>+a.position===+position))position='';const update=()=>{status.textContent=position?'P'+position+' · '+roleNames[+position-1]:'Unassigned';};picker.append(el('legend','Assign position'),options);for(let i=1;i<=5;i++){const label=el('label',null,'position-option'),radio=el('input'),copy=el('span',null,'position-copy');radio.type='radio';radio.name='assigned-position';radio.value=String(i);radio.checked=+position===i;radio.disabled=used.some(a=>+a.position===i);radio.onchange=()=>{if(radio.checked){selected.position=position=radio.value;update();}};copy.append(el('strong','P'+i),el('small',roleNames[i-1]));label.append(radio,copy);options.append(label);}button('Unassigned',()=>{selected.position=position='';for(const radio of options.querySelectorAll('input'))radio.checked=false;update();},picker,'position-auto');update();picker.append(status);body.append(playerLabel,picker);}

 const confirm=button(`${turn.side==='enemy'?'Enemy ':''}${turn.action==='pick'?'Pick':'Ban'} ${heroName(selected.id)}`,async()=>{const a={mode:turn.mode,heroId:selected.id};if(player?.value)a.playerId=player.value;if(position&&!state.actions.some(a=>a.mode==='ourPick'&&+a.position===+position))a.position=+position;const before=state.actions.length;await mutate('append',a);if(state.actions.length===before+1){freshActionIndex=before;render();freshActionIndex=-1;}},feature,'primary');confirm.disabled=!write;
 button('Clear selection',()=>{selected=null;render();$('hero-search').focus();},feature,'clear-staged');
 if(!write)feature.append(el('p',playerDemo?'Only the captain can confirm picks and bans.':shared?'Become drafter to confirm this action.':'Take the drafter seat to confirm this action.','decision-readonly'));
 dock.append(feature);

 }else dock.append(el('p','Choose a suggested hero or browse the pool. Review your selection here before confirming.','decision-empty'));

 const candidates=el('div',null,'decision-candidates');candidates.append(el('h3',turn.action==='ban'?'Best bans now':'Best picks now'));best.append(candidates);const more=el('details',null,'more-candidates');more.append(el('summary','More suggestions'));let candidateIndex=0;const visibleCandidates=diverseTop(ranked.filter(candidate=>candidate.heroId!==selected?.id),8,2);
 if(turn.mode==='ourPick'&&visibleCandidates.length){const legend=el('div',null,'rec-legend');legend.setAttribute('aria-label','Suggestion categories');for(const [cls,label] of [['team','Team'],['counter','Counter'],['meta','Meta'],['all','All three']])legend.append(el('span',label,'rec-badge rec-badge-'+cls));candidates.before(legend);}for(const r of visibleCandidates){const b=button('',()=>stage(r.heroId,r),candidateIndex++<6?candidates:more,'rec-row');const summary=el('span',null,'rec-summary');summary.append(el('strong',heroName(r.heroId)),el('span',[r.playerName,r.position?'P'+r.position:null].filter(Boolean).join(' · ')),el('small',r.reasons[0]||r.evidence[0]||'Limited data'));b.append(portrait(r.heroId),summary);
 const win=heroEvidence(r.heroId,evidenceSources,r.playerId);if(win)summary.append(el('span',win,'rec-win'));const tags=r.tags||[];if(tags.length){const badges=el('span',null,'rec-badges');if(tags.length===3){b.classList.add('rec-all-three');badges.append(el('span','All three','rec-badge rec-badge-all'));}for(const t of tags){b.classList.add('rec-tag-'+t);badges.append(el('span',{team:'Team',counter:'Counter',meta:'Meta'}[t],'rec-badge rec-badge-'+t));}summary.append(badges);}b.title=[...r.reasons,...r.evidence].join('\n');}if(!ranked.length)best.append(el('p','No evidence-backed recommendations for this turn. Manual selection is available.'));
 if(visibleCandidates.length>6)best.append(more);
 const coverage=matchupCoverage(),evidence=el('details',null,'decision-evidence');evidence.append(el('summary',`Matchup evidence · ${coverage.observed} / ${coverage.total} pairs`),el('p','Heuristic rankings · public coverage varies. Enemy assignments stay unconfirmed.'));dock.append(evidence);
 if(matchupErrors.size){evidence.append(el('p','Some matchup requests are unavailable.'));button('Retry unavailable matchup data',()=>{for(const id of matchupErrors)requestedMatchups.delete(id);matchupErrors.clear();allyCounterFailures.clear();refreshScouting();render();},dock);}


}

// Public OpenDota history for one enemy: what to ban against them.
function enemyDetails(card,p){
 const s=enemySummary(p,{now:Math.floor(Date.now()/1000),heroes:Object.values(heroes)});
 const seen=seenAgainstUs(p);if(seen)card.append(el('p',seen,'enemy-seen'));
 if(s.state!=='ready'){card.append(el('p',{loading:'Loading public stats…',waiting:'Waiting for OpenDota…',closed:'Closed account — no public match history.',error:'Public stats unavailable (OpenDota error).'}[s.state],'enemy-status'));return;}
 card.append(el('p',s.positions.length?'Likely '+s.positions.slice(0,2).map(r=>'Pos '+r.position).join(' · '):'Position unknown','player-role-summary'));
 const strip=(title,cls,rows,label,empty)=>{
  card.append(el('h4',title));const root=el('div',null,'roster-hero-strip '+cls);
  for(const h of rows){const item=el('div');item.append(portrait(h.heroId),el('small',heroName(h.heroId)),el('small',label(h)));root.append(item);}
  if(!rows.length)root.append(el('span',empty,'secondary'));card.append(root);
 };
 strip('Most played · 180 days','enemy-top-heroes',s.topHeroes,h=>h.winRate==null?`${h.games} games`:`${h.games} games · ${h.winRate}%`,'No hero data');
 const total=s.recent.wins+s.recent.losses;
 card.append(el('h4','Recent'),el('p',total?`${s.recent.wins}W ${s.recent.losses}L (last ${total})`:'No recent matches','enemy-recent'));
 strip('Battle Cup','enemy-cup',s.cup,h=>`${h.games} games · ${h.wins}W`,'No Battle Cup games found');
}
// Earlier Battle Cup matches pasted to scout the enemy team. Shared through the team
// database inside a team draft; stored on this device otherwise or until the owner
// applies migration 010.
const enemyMatchKey='captain-enemy-matches-v1';
let enemyMatches=[],enemyMatchScope=null,enemyMatchRemote=false,enemyMatchState='ready',enemyMatchLoad=0;
function enemyMatchTeam(){return typeof backend?.listEnemyMatches==='function'&&shared?.team_id&&user?shared.team_id:null;}
// Device storage is per account so another local user does not see this scouting.
const localMatchKey=()=>enemyMatchKey+':'+(user?.id||'practice');
function readLocalMatches(){try{const rows=JSON.parse(localStorage.getItem(localMatchKey())||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}}
function writeLocalMatches(){try{localStorage.setItem(localMatchKey(),JSON.stringify(enemyMatches.slice(0,200)));}catch{}}
const missingRpc=error=>error?.code==='PGRST202'||/Could not find the function/i.test(error?.message||'');
function syncEnemyMatches(){
 const teamId=enemyMatchTeam(),scope=(teamId||'device')+':'+(user?.id||'');if(scope===enemyMatchScope)return;
 // Every scope change invalidates in-flight team loads, including team → device.
 enemyMatchScope=scope;enemyMatchRemote=false;const load=++enemyMatchLoad;
 if(!teamId){enemyMatchState='ready';enemyMatches=readLocalMatches();return;}
 // Team scope never mixes in device rows; adding waits until the team list settles.
 enemyMatchState='loading';enemyMatches=[];
 void Promise.resolve().then(()=>backend.listEnemyMatches(teamId)).then(rows=>{
  if(load!==enemyMatchLoad)return;enemyMatchRemote=true;enemyMatchState='ready';
  enemyMatches=(Array.isArray(rows)?rows:[]).map(r=>({matchId:String(r.match_id),enemySide:r.enemy_side,contextIds:r.context_enemy_ids||[],summary:r.summary,addedAt:Date.parse(r.added_at)}));render();
 }).catch(error=>{
  if(load!==enemyMatchLoad)return;
  if(missingRpc(error)){enemyMatchState='ready';enemyMatches=readLocalMatches();notice('Team match storage is not set up yet. Battle Cup matches are kept on this device.');render();}
  else{enemyMatchState='failed';notice('Could not load team Battle Cup matches: '+(error.message||'try again later.'));}
 });
}
async function addEnemyMatches(text){
 const ids=matchData.parseMatchIds(text);if(!ids.length)throw Error('Enter match IDs or match links.');if(ids.length>10)throw Error('Load at most 10 matches at a time.');
 syncEnemyMatches();
 if(enemyMatchState==='loading')throw Error('Team matches are still loading. Try again in a moment.');
 // A failed team load is retried on the next attempt instead of needing a reload.
 if(enemyMatchState==='failed'){enemyMatchScope=null;syncEnemyMatches();throw Error('Team matches could not be loaded. Retrying now; try again in a moment.');}
 const teamId=enemyMatchRemote?enemyMatchTeam():null,scope=enemyMatchScope,contextIds=(state.enemyIds||[]).map(String),failed=[],unsaved=[];
 for(const id of ids){
  let summary;
  try{summary=await matchData.loadMatch(id);}catch{}
  if(scope!==enemyMatchScope)return false;
  if(!Array.isArray(summary?.players)||!summary.players.length){failed.push(id);continue;}
  const row={matchId:id,summary,enemySide:enemyMatches.find(r=>r.matchId===id)?.enemySide||null,contextIds,addedAt:Date.now()};
  if(teamId){try{await backend.saveEnemyMatch(teamId,id,summary,row.enemySide,contextIds);}catch{unsaved.push(id);continue;}}
  if(scope!==enemyMatchScope)return false;
  enemyMatches=[row,...enemyMatches.filter(r=>r.matchId!==id)];
 }
 if(!teamId)writeLocalMatches();render();
 const problems=[];
 if(failed.length)problems.push('Could not load match '+failed.join(', ')+'. Check the ID, or try again if OpenDota is busy.');
 if(unsaved.length)problems.push('Could not save match '+unsaved.join(', ')+' to the team. Check your team access and try again.');
 if(problems.length)throw Error(problems.join(' '));
 return true;
}
async function setEnemyMatchSide(matchId,side){
 const teamId=enemyMatchRemote?enemyMatchTeam():null,scope=enemyMatchScope;
 if(teamId)await backend.setEnemyMatchSide(teamId,matchId,side);
 if(scope!==enemyMatchScope)return;
 enemyMatches=enemyMatches.map(r=>r.matchId===matchId?{...r,enemySide:side}:r);if(!teamId)writeLocalMatches();render();
}
function renderEnemyMatches(section){
 section.querySelector('.draft-enemy-matches')?.remove();
 const rows=relevantEnemyMatches(enemyMatches,state.enemyIds||[],Date.now());if(!rows.length)return false;
 const r=enemyMatchReport(rows,state.enemyIds||[]),root=el('div',null,'draft-enemy-matches');
 const resolved=r.matches.filter(m=>m.side),wins=resolved.filter(m=>m.won).length;
 root.append(el('h4','Their Battle Cup matches'),el('p',`${rows.length} match${rows.length===1?'':'es'} · ${wins}W ${resolved.filter(m=>m.won===false).length}L${r.anonymous?` · ${r.anonymous} anonymous picks`:''}`,'draft-enemy-match-summary'));
 const list=(cls,items,label)=>{if(!items.length)return;const box=el('div',null,'draft-enemy-match-list');for(const h of items.slice(0,8))box.append(el('span',label(h),cls));root.append(box);};
 list('draft-enemy-match-pick',r.picks,h=>`${heroName(h.heroId)} ×${h.games}${h.wins?` (${h.wins}W)`:''}`);
 if(r.bans.length)root.append(el('p','They banned:','draft-enemy-match-label'));
 list('draft-enemy-match-ban',r.bans,h=>`${heroName(h.heroId)} ×${h.count}`);
 for(const id of r.unresolved){
  const box=el('div',null,'draft-enemy-match-side');box.append(el('span',`Match ${id}: which side was the enemy?`));
  for(const [label,side] of [['Enemy was Radiant','radiant'],['Enemy was Dire','dire']])button(label,()=>setEnemyMatchSide(id,side),box);
  root.append(box);
 }
 // A wrongly chosen or inferred side can be corrected; kept collapsed so the panel stays short.
 const resolvedSides=r.matches.filter(m=>m.side);
 if(resolvedSides.length){
  const sides=el('details',null,'draft-enemy-match-sides');sides.append(el('summary',`Enemy side in ${resolvedSides.length} match${resolvedSides.length===1?'':'es'}`));
  for(const m of resolvedSides.slice(0,10)){
   const box=el('div',null,'draft-enemy-match-side');box.append(el('span',`Match ${m.matchId}: enemy was ${m.side==='radiant'?'Radiant':'Dire'}`));
   button('Switch side for match '+m.matchId,()=>setEnemyMatchSide(m.matchId,m.side==='radiant'?'dire':'radiant'),box);
   sides.append(box);
  }
  root.append(sides);
 }
 section.append(root);return true;
}
// Who played what against us: recorded by the team after its own games, so it also
// covers closed accounts. Team database in team drafts, this device otherwise.
const sightingKey='captain-enemy-sightings-v1';
let sightings=[],sightingScope=null,sightingRemote=false,sightingState='ready',sightingLoad=0,sightingLoadedAt=0,assignment={key:null,map:{},result:''};
const localSightingKey=()=>sightingKey+':'+(user?.id||'practice');
function sightingTeam(){return typeof backend?.listEnemySightings==='function'&&shared?.team_id&&user?shared.team_id:null;}
function readLocalSightings(){try{const rows=JSON.parse(localStorage.getItem(localSightingKey())||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}}
function writeLocalSightings(){try{localStorage.setItem(localSightingKey(),JSON.stringify(sightings.slice(-2000)));}catch{}}
function syncSightings(){
 const teamId=sightingTeam(),scope=(teamId||'device')+':'+(user?.id||'');if(scope===sightingScope)return;
 sightingScope=scope;sightingRemote=false;
 if(!teamId){++sightingLoad;sightingState='ready';sightings=readLocalSightings();return;}
 sightingState='loading';sightings=[];listSightings(teamId);
}
// Re-reads the team list; current rows stay visible until the new ones arrive.
function listSightings(teamId){
 const load=++sightingLoad;
 void Promise.resolve().then(()=>backend.listEnemySightings(teamId)).then(rows=>{
  if(load!==sightingLoad)return;sightingRemote=true;sightingState='ready';sightingLoadedAt=Date.now();
  sightings=(Array.isArray(rows)?rows:[]).map(r=>({accountId:String(r.account_id),heroId:+r.hero_id,enemyWon:r.enemy_won??null,sourceKey:r.source_key,seenAt:Date.parse(r.seen_at)}));render();
 }).catch(error=>{
  if(load!==sightingLoad)return;
  if(missingRpc(error)){sightingState='ready';sightings=readLocalSightings();render();}
  else if(sightingState==='loading'){sightingState='failed';notice('Could not load the team scouting list: '+(error.message||'try again later.'));}
 });
}
// Called from the draft poll so idle teammates also see a newly saved assignment.
function refreshSightings(){
 const teamId=sightingTeam();
 if(teamId&&sightingRemote&&sightingState==='ready'&&state.actions.length>=24&&Date.now()-sightingLoadedAt>15000){sightingLoadedAt=Date.now();listSightings(teamId);}
}
// One key per game. Reset keeps the draft id, so the key also uses the opening bans
// and the enemy accounts; a later Undo and re-pick stays the same game.
function draftFingerprint(){let h=0x811c9dc5;const text=state.actions.slice(0,4).map(a=>a.mode[0]+a.heroId).join(',')+'|'+[...(state.enemyIds||[])].map(String).sort().join(',');for(const ch of text){h^=ch.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
const sightingDraftBase=()=>shared?.id?'draft:'+shared.id:'draft:practice';
const sightingGameKey=()=>sightingDraftBase()+':'+draftFingerprint();
// Key last saved per draft in this session, so a corrected enemy list or opening replaces it.
const lastSightingKey=new Map();
async function saveSightings(entries){
 if(new Set(entries.map(e=>e.accountId)).size!==entries.length)throw Error('Assign each enemy account only once.');
 if(shared&&!canWrite())throw Error('Only the current drafter can save who played what.');
 syncSightings();
 if(sightingState==='loading')throw Error('The team scouting list is still loading. Try again in a moment.');
 if(sightingState==='failed'){sightingScope=null;syncSightings();throw Error('The team scouting list could not be loaded. Retrying now; try again in a moment.');}
 const teamId=sightingRemote?sightingTeam():null,scope=sightingScope,key=sightingGameKey(),slot=scope+'|'+sightingDraftBase();
 const previous=lastSightingKey.get(slot)!==key?lastSightingKey.get(slot):null;
 if(teamId)await backend.recordEnemySightings(teamId,key,entries,'manual');
 if(scope!==sightingScope)return false;
 let staleKept=false;
 if(teamId&&previous)try{await backend.recordEnemySightings(teamId,previous,[],'manual');}catch{staleKept=true;}
 if(scope!==sightingScope)return false;
 // Remembered only once the earlier version is gone, so saving again retries the cleanup.
 if(!staleKept)lastSightingKey.set(slot,key);
 // A list request started before this save must not drop the new rows.
 if(teamId)++sightingLoad;
 sightings=[...sightings.filter(r=>r.sourceKey!==key&&r.sourceKey!==previous),...entries.map(e=>({...e,sourceKey:key,seenAt:Date.now()}))];
 // Invented demo opponents never reach the real list.
 if(!teamId&&!demo)writeLocalSightings();render();
 if(staleKept)notice('Saved. The earlier version of this game could not be removed; save again to retry.');
 return true;
}
function seenAgainstUs(p){
 const seen=enemySightings(sightings,String(p.id));
 return seen.length?'Seen vs us: '+seen.slice(0,4).map(h=>`${heroName(h.heroId)} ×${h.games}${h.wins?` (${h.wins}W)`:''}`).join(', '):'';
}
function renderEnemyAssignment(root){
 const picks=state.actions.filter(a=>a.mode==='enemyPick'),enemies=opponents();
 if(!picks.length||!enemies.length)return;
 syncSightings();const key=sightingScope+'|'+sightingGameKey(),readOnly=!!shared&&!canWrite();
 // Teammates outside the drafter seat always see the saved assignment (refreshed by the poll);
 // the drafter's unsaved edits survive a failed poll or a pending action.
 const viewer=!!shared&&shared.drafter_user_id!==user?.id;
 if(assignment.key!==key||viewer){
  const saved=sightings.filter(r=>r.sourceKey===sightingGameKey());
  assignment={key,map:Object.fromEntries(saved.map(r=>[r.heroId,r.accountId])),result:saved.some(r=>r.enemyWon===true)?'lost':saved.some(r=>r.enemyWon===false)?'won':''};
 }
 const box=el('section',null,'enemy-assignment');
 box.append(el('h3','Who played what?'),el('p','Saved for your team. When these accounts show up again, the board shows what they played against you.','secondary'));
 for(const a of picks){
  const row=el('label',null,'enemy-assignment-row'),select=el('select');select.dataset.hero=String(a.heroId);
  select.setAttribute('aria-label','Enemy player for '+heroName(a.heroId));select.append(new Option('Unknown',''));
  for(const p of enemies)select.append(new Option(p.name,String(p.id)));
  select.value=assignment.map[a.heroId]||'';select.disabled=readOnly;select.onchange=()=>{assignment.map[a.heroId]=select.value;};
  row.append(el('span',heroName(a.heroId)),select);box.append(row);
 }
 const resultLabel=el('label',null,'enemy-assignment-row'),result=el('select');result.setAttribute('aria-label','Our result');
 for(const [value,label] of [['','Result unknown'],['won','We won'],['lost','We lost']])result.append(new Option(label,value));
 result.value=assignment.result;result.disabled=readOnly;result.onchange=()=>{assignment.result=result.value;};resultLabel.append(el('span','Our result'),result);box.append(resultLabel);
 const saveButton=button('Save who played what',async()=>{
  assignment.result=result.value;
  for(const select of box.querySelectorAll('select[data-hero]'))assignment.map[select.dataset.hero]=select.value;
  const enemyWon=assignment.result==='lost'?true:assignment.result==='won'?false:null;
  const entries=picks.filter(a=>assignment.map[a.heroId]).map(a=>({accountId:assignment.map[a.heroId],heroId:a.heroId,enemyWon}));
  if(await saveSightings(entries))notice('Saved who played what.');
 },box,'primary');
 if(readOnly){saveButton.disabled=true;box.append(el('p','Only the current drafter can save this.','secondary'));}
 root.append(box);
}
// Compact enemy scouting in the Next decision panel, so it is visible while drafting.
function renderDraftEnemies(){
 const section=$('draft-enemy-scouting'),list=$('draft-enemy-list');if(!section||!list)return;
 syncEnemyMatches();syncSightings();
 // An empty draft is a Reset or a new game: later saves must not replace the earlier game.
 // While someone else holds the drafter seat this tab may miss their Reset, so forget too.
 if(!state.actions.length||shared&&shared.drafter_user_id!==user?.id)lastSightingKey.delete(sightingScope+'|'+sightingDraftBase());
 const enemies=opponents();list.replaceChildren();section.classList.toggle('is-detail-open',enemies.some(p=>String(p.id)===focusedPlayer));const hasReport=renderEnemyMatches(section);section.classList.toggle('has-match-report',hasReport);section.hidden=!hasReport&&!enemies.length;
 const heroList=Object.values(heroes),now=Math.floor(Date.now()/1000);
 for(const p of enemies){
  const s=enemySummary(p,{now,heroes:heroList}),row=el('div',null,'draft-enemy');row.dataset.playerId=String(p.id);row.classList.toggle('is-focused',String(p.id)===focusedPlayer);
  const meta={loading:'Loading…',waiting:'Waiting for OpenDota…',closed:'Closed account',error:'Stats unavailable'}[s.state]
   ||(s.positions.length?s.positions.slice(0,2).map(r=>'Pos '+r.position).join(' · '):'Position unknown');
  row.append(el('strong',p.name,'draft-enemy-name'),el('span',meta,'draft-enemy-meta'));
  if(s.state==='ready'){
   const heroesRow=el('div',null,'draft-enemy-heroes');
   for(const h of s.topHeroes.slice(0,3)){const item=el('span',null,'draft-enemy-hero'),img=portrait(h.heroId);img.alt='';item.append(img,el('small',`${heroName(h.heroId)} ${h.winRate==null?h.games+' games':`${h.winRate}% · ${h.games}`}`));heroesRow.append(item);}
   row.append(heroesRow);
   if(s.cup.length)row.append(el('p','Battle Cup: '+s.cup.slice(0,3).map(h=>heroName(h.heroId)).join(', '),'draft-enemy-cup'));
  }
  const seen=seenAgainstUs(p);if(seen)row.append(el('p',seen,'draft-enemy-seen'));
  list.append(row);
 }
}
function renderRoster(){
 const root=$('team-roster');root.replaceChildren();
 const homeActive=!$('team-view').hidden&&user;
 const allies=homeActive?(homeTeamId?homeRoster:[{...profile,userId:user.id}]).map(item=>normalizeProfile({...item,id:item.userId,name:item.displayName||'Teammate'},item)):roster();
 for(const [label,players] of [['Our team',allies],['Enemy scouting',opponents()]]){
  if(!players.length)continue;
  const heading=el('h2',label,'roster-group-heading');root.append(heading);
  for(const p of players){
   const card=el('article',null,'player-card');
   card.append(el('h3',p.name));
   if(label==='Enemy scouting')enemyDetails(card,p);
   else card.append(el('p',p.selfReport.preferredRoles.map(role=>roleNames[role-1]||role).join(' · ')||'Role preferences not set','player-role-summary'));
   if(label!=='Enemy scouting')for(const [title,ids] of [['Signatures',p.selfReport.signatureHeroes],['Wants',p.selfReport.desiredHeroes]]){
    card.append(el('h4',title));const strip=el('div',null,'roster-hero-strip');
    for(const id of ids){const item=el('div');item.append(portrait(id),el('small',heroName(id)));strip.append(item);}
    if(!ids.length)strip.append(el('span','Not set','secondary'));card.append(strip);
   }
   const sources=Object.entries(p.sources||{}).filter(([,source])=>source&&typeof source==='object');
   if(sources.length){const details=el('details',null,'roster-sources');details.append(el('summary','Public data and freshness'));for(const [source,status] of sources)details.append(el('p',`${source}: ${status.status}${status.cached?' - cached':''}${status.at?' · '+new Date(status.at).toLocaleString():''}${status.message?' · '+status.message:''}`));card.append(details);}
   root.append(card);
  }
 }
 if(!root.children.length){root.append(el('p','Your team starts here. Add your profile or invite teammates from Setup.'));button('Edit my profile',()=>profileDialog(),root,'primary');button('Invite or import players',lobby,root);}
}


async function mutate(operation,payload={}){if(playerDemo)return;if(pending) return;if(!['claim','release'].includes(operation)&&!canWrite())throw Error('Become the confirmed drafter first.');pending=true;render();const gen=generation;try{if(shared){const id=shared.id;try{const row=await backend.mutateDraft(id,shared.revision,operation,payload);if(gen===generation)adopt(row);}catch(e){if(gen===generation){try{const row=await backend.getDraft(id);if(gen===generation){adopt(row);healthy=true;}}catch{if(gen===generation)healthy=false;}throw Error(e.message+' · Current state reloaded where available. Repeat deliberately.');}}}else{if(operation==='claim')localControl=true;else if(operation==='release')localControl=false;else if(operation==='set_state'){if('firstPick'in payload)state=reduceDraft(state,'set_first_pick',payload,{canWrite:true});state={...state,...payload};}else state=reduceDraft(state,operation,payload,{canWrite:true,heroes});saveLocal();}selected=null;$('hero-search').value='';searchIndex=0;refreshScouting();}finally{if(gen===generation){pending=false;render();}}}

function adopt(row){if(!row||shared&&row.id!==shared.id)return;if(shared&&row.revision<shared.revision)return;shared=row;state={...initialState(),...row.state};healthy=true;refreshScouting();}

async function openDraft(id,{navigate=true}={}){
 if(!user||demo)throw Error('Sign in to open a shared draft.');
 const currentUser=user.id,gen=generation,request=++draftOpen;
 let row;try{row=await backend.getDraft(id);}catch(error){if(error.code==='PGRST116')throw Error('This draft is available to team members only. Ask the captain for a team invitation.');throw error;}
 if(user?.id!==currentUser||gen!==generation||request!==draftOpen)return;
 ++generation;shared=null;resetDraftData();pending=false;polling=false;
 shared=row;team=teams.find(t=>t.id===row.team_id);teamRoster=[];
 selectedTeamIds=(row.state.roster||[]).filter(p=>p&&typeof p==='object').map(p=>p.userId||p.id);
 adopt(row);selected=null;reviewVisible=true;
 if(navigate){const url=new URL(location.href);url.searchParams.delete('practice');url.searchParams.delete('cup');url.searchParams.set('draft',id);if(url.href!==location.href)history.pushState(null,'',url);}
 render();$('session-dialog').close();welcome.board();focusDraftView();
}
async function poll(){
 if(!shared||polling||pending||!user)return;
 polling=true;const gen=generation,id=shared.id;let changed=false;
 try{
  const row=await backend.getDraft(id);if(gen!==generation)return;
  changed=!healthy||JSON.stringify(row)!==JSON.stringify(shared);
  if(changed)adopt(row);
  if(Date.now()-lastRoster>30000){const fresh=await backend.loadRoster(row.team_id);if(gen===generation&&team?.id===row.team_id){lastRoster=Date.now();teamRoster=fresh;}}
 }catch(e){if(gen===generation){changed=healthy;healthy=false;notice('Shared state unavailable. Writes paused: '+e.message);}}
 finally{if(gen===generation){polling=false;if(changed)render();}}
}
let teamRoster=[],selectedTeamIds=[],teamLoad=0;

function draftRoster(){const rows=teamRoster.filter(p=>selectedTeamIds.includes(p.userId));if(rows.length>5)throw Error('Select at most five players.');const accounts=rows.map(p=>p.steamAccountId).filter(Boolean);if(new Set(accounts).size!==accounts.length)throw Error('Duplicate public account IDs in selected roster. Resolve profiles or deselect a duplicate.');return rows.map(p=>({...p,id:p.userId}));}

function show(id){$(id).showModal();}

function heroPicker(parent,label,values,{kind,getRoles,getAccountId,onError}={}){

 const selected=new Set(values||[]),wrap=el('section',null,'profile-hero-picker');

 wrap.dataset.kind=kind;

 const heading=el('div',null,'profile-section-heading'),count=el('span');

 heading.append(el('h3',label),count);

 const search=field(wrap,'Find a hero'),chips=el('div',null,'profile-hero-chips'),hint=el('p',null,'profile-help'),list=el('div',null,'profile-hero-suggestions');

 wrap.prepend(heading);wrap.append(chips,hint,list);parent.append(wrap);

 function toggle(id){

  if(selected.has(id))selected.delete(id);

  else{

   if(selected.size>=12){onError('Choose up to 12 heroes in each list. Remove one first.');return;}

   selected.add(id);

  }

  const focused=document.activeElement,source=focused?.classList.contains('profile-hero-chip')?'chip':'choice';
  onError('');draw();
  const replacement=wrap.querySelector(`[data-hero-id="${id}"][data-source="${source}"]`)||wrap.querySelector(`[data-hero-id="${id}"]`);
  (replacement||search).focus();

 }

 function draw(){

  count.textContent=selected.size+' / 12 selected';chips.replaceChildren();

  for(const id of selected){

   const b=button('',()=>toggle(id),chips,'profile-hero-chip');

   b.dataset.heroId=id;b.dataset.source='chip';
   b.append(portrait(id),el('span',heroName(id)),el('span','×'));

   b.setAttribute('aria-label','Remove '+heroName(id));

  }

  search.placeholder='Search all heroes';
  const played=new Map((observations.get(getAccountId?.()||String(profile.steamAccountId||''))?.heroes||[]).filter(h=>h.games>0).map(h=>[+h.hero_id,h.games]));

  const query=search.value.trim().toLowerCase(),roles=getRoles(),support=roles.length&&roles.every(role=>role>=4);

  const core=roles.length&&roles.every(role=>role<=3);

  hint.textContent=query?'Matching heroes · click to toggle.':support?'Popular support suggestions · choose heroes you actually play.':core?'Popular core suggestions · choose heroes you actually play.':'Popular suggestions · choose heroes you actually play.';

  if(!query&&played.size)hint.textContent='Selected heroes first, then your public match history. Import can suggest heroes in empty lists; review before saving.';

  let choices=Object.values(heroes).filter(h=>h.localized_name.toLowerCase().includes(query));

  if(!query&&support)choices=choices.filter(h=>selected.has(+h.id)||(h.roles||[]).includes('Support'));

  else if(!query&&core)choices=choices.filter(h=>selected.has(+h.id)||!(h.roles||[]).includes('Support')||(h.roles||[]).includes('Carry'));

  choices.sort((a,b)=>Number(selected.has(+b.id))-Number(selected.has(+a.id))||(played.get(+b.id)||0)-(played.get(+a.id)||0)||(b.pub_pick||0)-(a.pub_pick||0)||a.localized_name.localeCompare(b.localized_name));

  list.replaceChildren();

  for(const h of choices.slice(0,Math.max(12,selected.size))){

   const b=button('',()=>toggle(+h.id),list,'profile-hero-choice');

   b.dataset.heroId=h.id;b.dataset.source='choice';
   const image=portrait(h.id);image.alt='';b.append(image,el('span',h.localized_name));b.setAttribute('aria-pressed',String(selected.has(+h.id)));

  }

  if(!list.children.length)list.append(el('p','No matching heroes.'));

 }

 search.oninput=draw;draw();

 return {values:()=>[...selected],draw,replace(values){if(values.length>12){onError('This list has more than 12 heroes. Choose up to 12 before copying it to Today.');return false;}selected.clear();for(const id of values)selected.add(id);draw();return true;}};

}

function startProfileSetup(continueAfterSave,joinedTeam=null){
 welcome.board();
 $('app-shell').dataset.profileSetup='true';
 profileDialog(false,joinedTeam,false,0,continueAfterSave);
}

function profileDialog(local=false,joinedTeam=null,continueToCup=false,initialHeroTab=0,continueAfterSave=null){

 if(backend&&!user&&!demo&&!local){welcome.home('signin');return;}

 const root=$('profile-content');root.replaceChildren();
 $('profile-title').textContent=continueAfterSave?'Set up your player profile':'Your profile';
 $('profile-dialog').querySelector('[data-close]').hidden=!!continueAfterSave;
 $('profile-dialog').oncancel=continueAfterSave?event=>event.preventDefault():null;
 $('profile-dialog').querySelector('.profile-footer')?.remove();

 if(continueAfterSave)root.append(el('p','Choose a display name and at least one position to continue. You can add or change heroes anytime.','profile-help'));
 if(joinedTeam||continueToCup)root.append(signupProgress(2));
 if(joinedTeam)root.append(el('p',`You joined ${joinedTeam.name}. Add the roles and heroes you want your team to see, then save your profile.`,'profile-help'));

 if(!backend||!user||demo)root.append(el('p',demo?'Demo preferences are invented and local.':'Local preference profile · no authentication or sync.','profile-help'));

 root.append(el('p','Build your player card. Choose your roles, then tell your captain what you want to play.','profile-intro'));

 const identity=el('div',null,'profile-identity');root.append(identity);

 const name=field(identity,'Display name',profile.displayName||''),account=field(identity,'Public account ID or player URL · optional',profile.steamAccountId||'');
 const workspace=el('div',null,'profile-workspace'),roleSection=el('section',null,'profile-roles-section'),heroSection=el('section',null,'profile-heroes-section');workspace.append(roleSection,heroSection);root.append(workspace);

 const presetBar=el('div',null,'profile-role-presets'),roles=el('div',null,'profile-role-grid');

 roleSection.append(el('h3','Where do you play?'),el('p','Select your preferred positions. Open Comfort to adjust your experience.','profile-help'),presetBar,roles);
 const presetHelp=el('p','Presets replace your roles and comfort levels. Undo is available.','profile-help profile-preset-help');roleSection.append(presetHelp);

 const roleInputs=[],pickers=[];

 const redrawHeroes=()=>pickers.forEach(picker=>picker.draw());
 const updateComfort=()=>{for(const role of roleInputs){role.summary.textContent='Comfort · '+role.radios.find(r=>r.checked)?.nextElementSibling.textContent;}};
 const clearPreset=()=>{for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed','false');updateComfort();};
 const manualRoles=()=>{clearPreset();redrawHeroes();};

 for(let i=1;i<=5;i++){

  const card=el('div',null,'profile-role-card'),preference=el('label',null,'profile-role-toggle'),c=el('input');

  c.type='checkbox';c.id='profile-role-'+i;c.checked=(profile.preferredRoles||[]).includes(i);

  preference.htmlFor=c.id;preference.append(c,el('span','P'+i,'profile-role-number'),el('span',roleNames[i-1],'profile-role-name'));c.onchange=manualRoles;
  const expertise=el('details',null,'profile-role-expertise'),summary=el('summary');expertise.append(summary);

  const comfort=el('fieldset',null,'profile-comfort');comfort.append(el('legend','Comfort for '+roleNames[i-1]));

  const radios=[];

  ['Unset','Learning','Playable','Comfortable','Strong','Signature'].forEach((text,value)=>{

   const label=el('label'),radio=el('input');radio.type='radio';radio.name='profile-comfort-'+i;radio.id='profile-comfort-'+i+'-'+value;radio.value=String(value);

   radio.checked=Number(profile.roleComfort?.[i]||0)===value;radio.onchange=clearPreset;label.htmlFor=radio.id;

   label.append(radio,el('span',text));comfort.append(label);radios.push(radio);

  });

  expertise.append(comfort);card.append(preference,expertise);roles.append(card);roleInputs.push({i,c,radios,summary});

 }
 updateComfort();

 let previousRoles;

 for(const [label,preferred] of [['Carry',[1]],['Mid',[2]],['Offlane',[3]],['Support',[4,5]],['Flex',[1,2,3,4,5]]]){

  const preset=button(label,()=>{

   previousRoles=roleInputs.map(role=>({checked:role.c.checked,comfort:role.radios.find(radio=>radio.checked)?.value||'0'}));

   undoPreset.hidden=false;

   for(const role of roleInputs){role.c.checked=preferred.includes(role.i);for(const radio of role.radios)radio.checked=+radio.value===(role.c.checked?3:0);}

   for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===preset));
   updateComfort();

   redrawHeroes();

  },presetBar);preset.setAttribute('aria-pressed','false');

 }

 const undoPreset=button('Undo preset',()=>{if(!previousRoles)return;roleInputs.forEach((role,index)=>{role.c.checked=previousRoles[index].checked;for(const radio of role.radios)radio.checked=radio.value===previousRoles[index].comfort;});for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed','false');undoPreset.hidden=true;updateComfort();redrawHeroes();},presetBar);undoPreset.hidden=true;

 const status=el('p',null,'profile-save-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');

 function message(text,error=false){status.textContent=text;status.dataset.state=error?'error':'idle';}

 const options=kind=>({kind,getRoles:()=>roleInputs.filter(role=>role.c.checked).map(role=>role.i),getAccountId:()=>String(parseAccountIds(account.value)[0]||''),onError:text=>message(text,!!text)});

 heroSection.append(el('h3','Your hero pool'),el('p','Keep your proven picks separate from what you feel like playing today.','profile-help'));
 const heroTabs=el('div',null,'profile-hero-tabs');heroTabs.setAttribute('role','tablist');heroTabs.setAttribute('aria-label','Hero preferences');heroSection.append(heroTabs);

 const heroSections=el('div');heroSection.append(heroSections);

 const signatures=heroPicker(heroSections,'Signature heroes · your proven picks',profile.signatureHeroes,options('signature'));

 const desired=heroPicker(heroSections,'Today · heroes you want to play',profile.desiredHeroes,options('desired'));

 const todayActions=el('div',null,'profile-today-actions');

 button('Use signatures for today',()=>{if(desired.replace(signatures.values()))message('Today replaced with your signature heroes.');},todayActions);

 button('Clear today',()=>{desired.replace([]);message('Today’s list cleared.');},todayActions);

 heroSections.querySelector('[data-kind=desired]').querySelector('input')?.parentElement.after(todayActions);

 const avoid=heroPicker(heroSections,'Avoid · heroes to leave out',profile.avoidHeroes,options('avoid'));

 pickers.push(signatures,desired,avoid);
 const importPanel=el('div',null,'profile-import'),importStatus=el('p','Start here: import your public match history to fill empty Signatures and Today lists. Review the suggestions before saving.','profile-help');importStatus.setAttribute('role','status');identity.after(importPanel);
 account.placeholder='Dotabuff or OpenDota player link, or Steam ID';
 const importHelp=el('details',null,'profile-import-help');
 importHelp.append(el('summary','Where do I find my player link?'),el('p','Open your player page on Dotabuff or OpenDota and copy its address. You can also paste your numeric Dota account ID or Steam ID. Enable public match data in Dota if your history is private.'));
 identity.after(importHelp);
 if(/^Steam \d+$/.test(name.value))name.parentElement.append(el('small','Use a nickname your teammates will recognize.','profile-help'));
 const importButton=button('Import public stats',async()=>{
  if(importButton.disabled)return;
  const ids=parseAccountIds(account.value);if(ids.length!==1){importStatus.textContent='Enter one Dota account ID, Steam ID or player URL first.';account.focus();return;}
  const id=String(ids[0]),gen=generation,initialName=name.value;
  importButton.disabled=true;save.disabled=true;importButton.setAttribute('aria-busy','true');importStatus.textContent='Loading public match history…';
  try{
   const player=await loadPlayer(id);
   if(gen!==generation||!root.contains(importPanel)||parseAccountIds(account.value).map(String).join()!==id)return;
   observations.set(id,player);
   const suggestions=(player.heroes||[]).filter(h=>Number(h.games)>0&&heroes[Number(h.hero_id)]).sort((a,b)=>Number(b.games)-Number(a.games)).slice(0,5).map(h=>Number(h.hero_id));
   if(name.value===initialName&&(!initialName||initialName==='Steam player'||/^Steam \d+$/.test(initialName))&&player.profile?.profile?.personaname)name.value=player.profile.profile.personaname;
   if(suggestions.length){
    if(!signatures.values().length)signatures.replace(suggestions);
    const copiedToday=!desired.values().length;
    if(copiedToday)desired.replace(signatures.values());
    importStatus.textContent=copiedToday?'Public history loaded. Signatures are also suggested in Today. Change either list to match what you want to play, then save.':'Public history loaded. Your existing Today choices were kept. Review your hero lists, then save.';
   }
   else importStatus.textContent=player.sources.heroes?.status==='error'?'OpenDota history could not be loaded. Try again, or choose your heroes manually.':'No public hero history found. Enable public match data in Dota, or choose heroes manually.';
   redrawHeroes();
  }catch{importStatus.textContent='Public stats are unavailable. Try again, or select heroes manually.';}
  finally{importButton.disabled=false;save.disabled=false;importButton.removeAttribute('aria-busy');}
 },importPanel,'primary');importPanel.append(importStatus);

 function activateHeroTab(index,focus=false){
  for(const [i,section] of [...heroSections.children].entries())section.hidden=i!==index;
  [...heroTabs.children].forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
  if(focus)heroTabs.children[index].focus();
 }
 for(const [index,label] of ['Signatures','Today','Avoid'].entries()){
  const panel=heroSections.children[index];panel.id='profile-hero-panel-'+index;panel.setAttribute('role','tabpanel');
  const tab=button(label,()=>activateHeroTab(index),heroTabs);tab.id='profile-hero-tab-'+index;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);
  tab.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;event.preventDefault();activateHeroTab(next,true);};
  panel.setAttribute('aria-labelledby',tab.id);
 }
 activateHeroTab(initialHeroTab);

 const extras=el('details',null,'profile-extras');extras.append(el('summary','Notes and availability · optional'));root.append(extras);

 const notes=field(extras,'Notes · optional',profile.notes||'','textarea'),availabilityLabel=el('label','Availability · optional'),availability=el('select');

 availability.id='profile-availability';availabilityLabel.htmlFor=availability.id;

 for(const value of ['available','maybe','unavailable'])availability.append(new Option(value,value));availability.value=profile.availability||'available';availabilityLabel.append(availability);extras.append(availabilityLabel);

 const footer=el('div',null,'profile-footer'),footerActions=el('div',null,'profile-footer-actions');footer.append(status,footerActions);$('profile-dialog').append(footer);

 const avatar=el('select');
 avatar.append(new Option('Random signature hero',''));
 for(const hero of Object.values(heroes).sort((a,b)=>a.localized_name.localeCompare(b.localized_name))){
  avatar.append(new Option(hero.localized_name,hero.id));
 }
 avatar.value=String(profile.avatarHeroId||'');
 const avatarLabel=el('label','Player card portrait');
 avatarLabel.append(avatar);
 extras.append(avatarLabel);

 const save=button('Save profile',async()=>{

  if(save.disabled)return;

  try{

   const ids=parseAccountIds(account.value);

   if(account.value.trim()&&ids.length!==1)throw Error('Enter one valid numeric public account ID or player URL.');

   const p={...(avatar.value||profile.avatarHeroId?{avatarHeroId:Number(avatar.value)||null}:{}),displayName:name.value.trim().slice(0,80)||'Player',steamAccountId:ids[0]?String(ids[0]):'',preferredRoles:roleInputs.filter(r=>r.c.checked).map(r=>r.i),roleComfort:Object.fromEntries(roleInputs.map(r=>[r.i,+(r.radios.find(radio=>radio.checked)?.value||0)])),signatureHeroes:signatures.values(),desiredHeroes:desired.values(),avoidHeroes:avoid.values(),notes:notes.value.slice(0,500),availability:availability.value};

   if(continueAfterSave&&(!name.value.trim()||!p.preferredRoles.length))throw Error('Enter your display name and choose at least one position.');
   const conflicts=p.avoidHeroes.filter(id=>p.signatureHeroes.includes(id)||p.desiredHeroes.includes(id));
   if(conflicts.length){activateHeroTab(2);heroSections.children[2].querySelector('input')?.focus();throw Error('Remove '+conflicts.map(heroName).join(', ')+' from Avoid before saving: also selected in Signatures or Today.');}

   save.disabled=true;importButton.disabled=true;save.textContent='Saving…';save.setAttribute('aria-busy','true');message('Saving your profile…');

   const gen=generation,saved=user&&!demo?await backend.saveProfile(p,user.id):p;

   if(gen!==generation)return;

   profile=saved;profileSaved=true;

   if(!$('team-view').hidden){homeRoster=homeRoster.map(item=>item.userId===user?.id?{...item,...profile}:item);renderTeamHome();}
   if(!shared)state.roster=[{...profile,id:user?.id||'local-own'},...state.roster.filter(p=>p.id!=='local-own'&&p.id!==user?.id)].slice(0,5);

   observations.clear();refreshScouting();saveLocal();render();

   if(joinedTeam&&team?.id===joinedTeam.id)void loadTeam(team.id,{preserveSelection:teamRoster.length>0}).catch(()=>{});
   if(continueAfterSave){
    message('Profile saved.');
    profileSetupRequired=false;
    delete $('app-shell').dataset.profileSetup;
    $('profile-dialog').close();
    await continueAfterSave();
    return;
   }
   if((joinedTeam||continueToCup)&&$('profile-dialog').open){$('profile-dialog').close();if(joinedTeam)navigateTeam(joinedTeam.id);else navigateCup();}
   message(shared?'Saved. Refresh the shared roster snapshot in Setup to use these changes.':joinedTeam?`Profile saved. ${joinedTeam.name} can now see your preferences.`:'Profile saved.');

  }catch(error){message(error.message||'Unable to save your profile. Try again.',true);}

  finally{save.disabled=false;importButton.disabled=false;save.textContent='Save profile';save.removeAttribute('aria-busy');}

 },footerActions,'primary profile-save');

 if(!continueAfterSave&&(joinedTeam||continueToCup))button(joinedTeam?'Back to team':'Skip to Battle Cup',()=>{$('profile-dialog').close();if(joinedTeam)navigateTeam(joinedTeam.id);else navigateCup();},footerActions);
 if(user)button('Sign out',safe(signOut),continueAfterSave?footerActions:extras);

 show('profile-dialog');
 if(profile.steamAccountId&&!profile.signatureHeroes?.length&&(!profileSaved||!profile.preferredRoles?.length))void importButton.click();

}

let liveWatch;
function stopLiveWatch() {
 if(!liveWatch)return;
 clearTimeout(liveWatch.timer);
 liveWatch.abort?.abort();
 liveWatch=null;
}

async function checkLiveWatch(watch) {
 if(liveWatch!==watch)return;
 if(watch.generation!==generation||document.body.dataset.view!=='board'){stopLiveWatch();return;}
 const retry=()=>{if(liveWatch===watch)watch.timer=setTimeout(()=>void checkLiveWatch(watch),5000);};
 const controller=new AbortController();
 watch.abort=controller;
 const timeout=setTimeout(()=>controller.abort(),14000);
 try {
  const response=await fetch('http://localhost:8765/live-roster',{signal:controller.signal,credentials:'omit',cache:'no-store'});
  if(!response.ok)throw Error('The helper did not accept the connection.');
  const data=await response.json();
  if(liveWatch!==watch||watch.generation!==generation)return;
  const lineup=data.status==='ready'&&liveLineup(data);
  if(!lineup){
   watch.status.textContent=data.status==='ready'?'Waiting for both complete teams and your Dota account.':data.message||'Waiting for a live match.';
   retry();return;
  }
  if(!canWrite()){
   watch.status.textContent='Waiting for the drafter seat before importing the lineup.';
   retry();return;
  }
  if(shared&&team?.id===shared.team_id&&teamRoster.length===0)await loadTeam(shared.team_id,{preserveSelection:true});
  if(liveWatch!==watch||watch.generation!==generation)return;
  const profiles=[...(state.roster||[]),...teamRoster];
  const roster=lineup.ours.map(id=>{
   const profile=profiles.find(player=>String(player.steamAccountId||player.accountId)===id);
   return profile?{...profile,id:profile.id||profile.userId}:{id,steamAccountId:id};
  });
  if(state.actions.some(action=>action.playerId&&!roster.some(player=>player.id===action.playerId))){
   stopLiveWatch();
   watch.control.textContent='Detect live lineup';
   watch.status.textContent='Live lineup differs from the assigned players. Open a new draft to import it.';
   return;
  }
  if(!canWrite()){retry();return;}
  try {
   await mutate('set_state',{roster,enemyIds:lineup.enemies});
  }catch(error){
   if(liveWatch===watch){
    stopLiveWatch();
    watch.control.textContent='Detect live lineup';
    watch.status.textContent=error.message;
   }
   return;
  }
  if(liveWatch!==watch||watch.generation!==generation)return;
  const input=$('enemy-account-input');
  if(input)input.value=lineup.enemies.join(' ');
  stopLiveWatch();
  watch.control.textContent='Detect live lineup';
  watch.status.textContent='Imported both teams from match '+data.matchId+'. Loading public match history.';
  notice(watch.status.textContent);
 }catch{
  if(liveWatch!==watch)return;
  watch.status.textContent='Check that the updated local helper is running and allow local network access if your browser asks. Retrying…';
  retry();
 }finally{clearTimeout(timeout);}
}

let lobbyEdited=false;
function sessionButtons(){$('create-session').disabled=!user||!team||demo;$('create-session').textContent=team?'Create draft for '+team.name:'Create shared draft';$('create-session-hint').textContent=demo?'The demo never creates shared drafts.':!user?'Sign in to create a shared draft with your team.':!team?(teams.length?'Select an active team below to create a shared draft.':'Create or join a team below to create a shared draft.'):'';}
async function lobby(){
 lobbyEdited=false;
 // Default to the team shown on Team home so shared draft creation is not silently disabled.
 // The roster loads in the background so a slow response never blocks Setup.
 if(user&&!demo&&!team&&teams.length){const id=(teams.find(t=>t.id===homeTeamId)||teams[0]).id;void safe(async()=>{if(!await loadTeam(id)||team?.id!==id||!$('session-dialog').open)return;if(lobbyEdited)sessionButtons();else await lobby();})();}
 else if(team&&!teamRoster.length)await loadTeam(team.id,{preserveSelection:true});
 const details=document.querySelector('[data-connection-details]'),manual=document.querySelector('[data-manual-entry]');
 details.replaceChildren(el('p',demo?'Invented demonstration - no backend writes.':backend?'Shared drafts require sign-in and team membership.':'Public configuration unavailable. Local practice remains available.'));
 const link=el('a','Open legacy live/replay helper');link.href='http://localhost:8765';link.target='_blank';link.rel='noopener';if(['localhost','127.0.0.1'].includes(location.hostname))details.append(link);
 const demoLink=el('a','Try the demo');demoLink.href='?demo';
 const links=el('div',null,'lobby-links');links.append(link,demoLink);details.append(links);manual.replaceChildren();manual.oninput=()=>{lobbyEdited=true;};
 const scouting=el('section',null,'lobby-card');scouting.setAttribute('aria-label','Enemy scouting');scouting.append(el('h3','Enemy scouting'));manual.append(scouting);
 const scoutingActions=el('div',null,'lobby-actions');
 if(!demo){
  const liveStatus=el('p',null,'secondary');
  liveStatus.setAttribute('role','status');
  const liveControl=button('Detect live lineup',()=>{
   if(liveWatch){
    stopLiveWatch();liveControl.textContent='Detect live lineup';liveStatus.textContent='Live detection stopped.';return;
   }
   liveControl.textContent='Stop live detection';
   liveStatus.textContent='Waiting for the local Dota helper…';
   liveWatch={generation,control:liveControl,status:liveStatus};
   void checkLiveWatch(liveWatch);
  },scouting);
  liveControl.disabled=!canWrite();
  scouting.append(liveStatus);
  if(liveWatch?.generation===generation){
   liveStatus.textContent=liveWatch.status.textContent;
   liveControl.textContent='Stop live detection';
   liveControl.disabled=false;
   Object.assign(liveWatch,{control:liveControl,status:liveStatus});
  }
 }
 const enemies=field(scouting,'Enemy public player IDs or URLs (up to 5)',(state.enemyIds||[]).join(' '),'textarea');enemies.id='enemy-account-input';enemies.placeholder='One player ID or link per line';enemies.rows=3;scouting.append(scoutingActions);
 const matchIds=field(scouting,'Their earlier Battle Cup matches (IDs or links)','','textarea');matchIds.id='enemy-match-input';matchIds.placeholder='Match IDs or Dotabuff/OpenDota links from the bracket';matchIds.rows=2;
 const matchActions=el('div',null,'lobby-actions');scouting.append(matchActions);
 button('Load matches',async()=>{if(!await addEnemyMatches(matchIds.value))return;matchIds.value='';notice('Battle Cup matches loaded.');},matchActions);
 const validateEnemies=()=>{
  const tokens=enemies.value.trim().split(/[\s,;]+/).filter(Boolean);
  const invalid=tokens.filter(token=>parseAccountIds(token).length!==1);
  if(invalid.length){enemies.setAttribute('aria-invalid','true');throw Error('Correct these enemy entries: '+invalid.join(', '));}
  if(!tokens.length)throw Error('Enter enemy IDs, or use Clear enemy scouting to remove them intentionally.');
  const ids=parseAccountIds(enemies.value);if(ids.length>5)throw Error('Maximum five opponents.');enemies.removeAttribute('aria-invalid');return ids;
 };
 button('Save and scout enemies',async()=>{await mutate('set_state',{enemyIds:validateEnemies()});notice('Enemy scouting saved.');},scoutingActions,'primary').disabled=!canWrite();
 button('Clear enemy scouting',async()=>{await mutate('set_state',{enemyIds:[]});enemies.value='';enemies.removeAttribute('aria-invalid');notice('Enemy scouting cleared.');},scoutingActions).disabled=!canWrite();
 if(!shared){
  // Local practice: tick members of the active team and/or add stand-ins by public ID (max five).
  const ours=el('section',null,'lobby-card lobby-local');ours.setAttribute('aria-label','Our team');ours.append(el('h3','Our team'));manual.append(ours);
  const current=Array.isArray(state.roster)?state.roster.filter(p=>p&&typeof p==='object'):[];
  const members=user&&!demo&&team?teamRoster:[],memberIds=new Set(members.map(p=>p.userId));
  const savedMembers=current.map(p=>p.id||p.userId).filter(id=>memberIds.has(id));
  let picked=savedMembers.some(id=>id!==user?.id)?savedMembers:members.filter(p=>p.availability!=='unavailable').slice(0,5).map(p=>p.userId);
  if(members.length){
   ours.append(el('p','Load players from '+team.name+':'));
   const list=el('div',null,'lobby-roster');ours.append(list);
   for(const p of members){const label=el('label',p.displayName),check=el('input');check.type='checkbox';check.checked=picked.includes(p.userId);check.onchange=()=>{picked=check.checked?[...new Set([...picked,p.userId])]:picked.filter(id=>id!==p.userId);};label.prepend(check);list.append(label);}
  }else if(user&&!demo)ours.append(el('p',teams.length?'Select an active team under Team management to load your teammates.':'Create or join a team to load your teammates.','secondary'));
  const manualIds=current.filter(p=>!memberIds.has(p.id||p.userId)).map(p=>p.steamAccountId||p.accountId).filter(Boolean);
  const ownIds=field(ours,members.length?'Add other players by public ID or URL':'Teammate public player IDs or URLs (up to 5)',manualIds.join(' '),'textarea');ownIds.rows=3;ownIds.placeholder='One player ID or link per line';
  const ourActions=el('div',null,'lobby-actions');ours.append(ourActions);
  button('Save our team',async()=>{
   if(!canWrite())throw Error('Become local drafter first.');
   const tokens=ownIds.value.trim().split(/[\s,;]+/).filter(Boolean);
   if(tokens.some(token=>parseAccountIds(token).length!==1)){ownIds.setAttribute('aria-invalid','true');throw Error('Correct invalid teammate account entries first.');}
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
 if(user&&!demo){
  const section=el('section',null,'team-management lobby-card');section.setAttribute('aria-label','Team management');section.append(el('h3','Team management'));manual.append(section);
  const teamActions=el('div',null,'lobby-team-actions');
  const create=el('div',null,'lobby-team-action'),join=el('div',null,'lobby-team-action');
  teamActions.append(create,join);section.append(teamActions);
  const teamName=field(create,'New team name'),invite=field(join,'Team invitation code (separate from draft ID)');
  teamName.placeholder='Your team name';invite.placeholder='Paste invite link or code';
  button('Create team',async()=>{const result=await backend.createTeam(teamName.value);teams=await backend.listTeams();team=teams.find(t=>t.id===result.id)||result;await loadTeam(team.id);await lobby();notice('Created team '+team.name+'.');},create);
  button('Join team',async()=>{const gen=generation,joined=await backend.joinTeam(codeFromInvitation(invite.value),user.id);if(gen!==generation)return;const refreshed=await backend.listTeams();if(gen!==generation)return;teams=refreshed;team=teams.find(t=>t.id===joined?.id);if(!team)throw Error('Team joined. Reopen Setup to select it.');if(!await loadTeam(team.id))return;await lobby();notice('Joined '+team.name+'. This team is now selected.');},join);
  const select=el('select');select.setAttribute('aria-label','Team');select.append(new Option('Select a team',''));for(const t of teams)select.append(new Option(t.name,t.id));select.value=team?.id||'';
  select.onchange=safe(async()=>{await loadTeam(select.value);await lobby();});
  const teamLabel=el('label','Active team');teamLabel.append(select);section.append(teamLabel);
  if(team){
   section.append(el('p','Selected team: '+team.name),el('p','Select up to five players for the draft roster:'));
   const rosterList=el('div',null,'lobby-roster');section.append(rosterList);
   for(const p of teamRoster){const label=el('label',p.displayName+' - '+p.availability),check=el('input');check.type='checkbox';check.checked=selectedTeamIds.includes(p.userId);check.onchange=()=>{selectedTeamIds=check.checked?[...new Set([...selectedTeamIds,p.userId])]:selectedTeamIds.filter(id=>id!==p.userId);};label.prepend(check);rosterList.append(label);}
   if(team.owner_user_id===user.id&&teamInviteCode.test(team.invite_code)){
    const inviteTeam=team,expiry=Date.parse(inviteTeam.invite_expires_at);
    if(expiry<=Date.now())section.append(el('p','This team invite link has expired.'));
    else{
     if(Number.isFinite(expiry))section.append(el('p','Team invite link expires '+new Date(expiry).toLocaleDateString()+'.'));
     button('Copy team invite link',async()=>{
      if(expiry<=Date.now())throw Error('This team invite link has expired.');
      if(user?.id!==inviteTeam.owner_user_id||team?.id!==inviteTeam.id)return;
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
   if(shared&&team.id===shared.team_id)button('Refresh draft roster snapshot',async()=>{
    if(!await loadTeam(shared.team_id,{preserveSelection:true}))return;
    const roster=draftRoster(),removed=(state.roster||[]).filter(p=>p&&!roster.some(current=>current.id===(p.id||p.userId)));
    section.querySelector('.roster-refresh-preview')?.remove();
    if(removed.length){const preview=el('div',null,'roster-refresh-preview snapshot-preview');preview.setAttribute('role','status');preview.append(el('p','This refresh will remove: '+removed.map(p=>p.displayName||p.name||p.id).join(', ')+'.'));button('Apply roster refresh',async()=>{await mutate('set_state',{roster});preview.remove();notice('Roster snapshot refreshed.');},preview);button('Cancel roster refresh',()=>preview.remove(),preview);section.append(preview);}
    else{await mutate('set_state',{roster});notice('Roster snapshot refreshed.');}
   },section).disabled=!canWrite();
   if(shared&&teams.find(t=>t.id===shared.team_id)?.owner_user_id===user.id)button('Owner reclaim drafter',()=>mutateOwner(),section);
   const ownsTeam=team.owner_user_id===user.id,leaving=team,account=user.id;
   const exit=button(ownsTeam?'Delete team':'Leave team',async()=>{
    if(exit.disabled||team?.id!==leaving.id||user?.id!==account)return;
    if(!confirm(ownsTeam?'Delete '+leaving.name+' for everyone? Its drafts, scouting notes, Battle Cup spots and members are removed permanently.':'Leave '+leaving.name+'? You lose access to its drafts and release any draft control you hold.'))return;
    exit.disabled=true;try{await (ownsTeam?backend.deleteTeam(leaving.id,account):backend.leaveTeam(leaving.id,account));}finally{exit.disabled=false;}
    if(user?.id!==account)return;
    if(shared?.team_id===leaving.id)enterPractice();
    ++teamLoad;team=null;teamRoster=[];selectedTeamIds=[];
    if(homeTeamId===leaving.id){teamIdentity.clear();homeRequest++;homeTeamId='';homeRoster=[];renderTeamHome();}
    teams=await backend.listTeams();if(user?.id!==account)return;
    await lobby();notice(ownsTeam?'Deleted team '+leaving.name+'.':'You left '+leaving.name+'.');
   },section,ownsTeam?'danger':undefined);
   const results=el('div',null,'team-draft-results');results.setAttribute('aria-live','polite');
   button('List team drafts',async()=>{const teamId=team.id,drafts=await backend.listDrafts(teamId);if(team?.id!==teamId)return;results.replaceChildren();for(const d of drafts)button(`${d.id.slice(0,8)} - ${d.status} - revision ${d.revision}`,()=>openDraft(d.id),results);if(!drafts.length)results.append(el('p','No drafts yet.'));},section);section.append(results);
  }
 }
 sessionButtons();$('join-session').disabled=!user||demo;showIfClosed('session-dialog');
}
function showIfClosed(id){if(!$(id).open)show(id);}

async function loadTeam(id,{preserveSelection=false}={}){

 const request=++teamLoad,gen=generation;

 const previous=preserveSelection&&team?.id===id?[...selectedTeamIds]:null;

 team=teams.find(t=>t.id===id);

 // Clear stale rows while another team's roster is loading.

 teamRoster=[];selectedTeamIds=[];

 const rows=id?await backend.loadRoster(id):[];

 if(gen!==generation||request!==teamLoad)return false;

 teamRoster=rows;

 selectedTeamIds=previous?previous.filter(id=>rows.some(p=>p.userId===id)):rows.filter(p=>p.availability!=='unavailable').slice(0,5).map(p=>p.userId);

 return true;

}

async function mutateOwner(){if(!shared||pending)return;pending=true;render();const gen=generation,id=shared.id;try{const row=await backend.mutateDraft(id,shared.revision,'assign',{userId:user.id});if(gen===generation)adopt(row);}catch(e){if(gen===generation){try{adopt(await backend.getDraft(id));}catch{healthy=false;}}throw e;}finally{if(gen===generation){pending=false;render();}}}

let cupAccountVersion=0;
async function authChanged(session,event){

 const recovery=event==='PASSWORD_RECOVERY';if(recovery)welcome.recover();

 const id=session?.user?.id||null;if(id===(user?.id||null)){if(user&&!recovery&&!teamInvitation)welcome.signedIn();return;}

 stopLiveWatch();teamIdentity.clear();homeRequest++;homeTeamId='';homeRoster=[];$('team-home').replaceChildren();profileSaved=false;profileSetupRequired=false;delete $('app-shell').dataset.profileSetup;
 const gen=++generation,acct=++accountGen;user=session?.user||null;welcome.setAccount(!!user,recovery);shared=null;team=null;teams=[];teamRoster=[];selectedTeamIds=[];profile={};state=initialState();
 ++cupAccountVersion;cup.sync();
 const inviteOnEntry=!!teamInvitation;

 if(!user)restorePractice();

 resetDraftData();selected=null;pending=false;polling=false;healthy=true;localControl=true;lastRoster=0;

 $('profile-content').replaceChildren();$('notice').textContent='';$('session-input').value='';document.querySelector('[data-manual-entry]')?.replaceChildren();for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();

 if(!user){
  accountReady=Promise.resolve();
  const url=new URL(location.href);url.searchParams.delete('draft');history.replaceState(null,'',url);if(!showTeamInvitation())welcome.home(pendingDraft()?'signin':undefined);
 }else{
  const activeUser=user;
  accountReady=Promise.allSettled([backend.loadProfile(),backend.listTeams()]).then(([p,t])=>{
   // Account data belongs to the account, not the workspace: Home or Practice mid-load
   // must not leave profile setup and teams unloaded.
   if(acct!==accountGen)return;
   profileSaved=p.status==='fulfilled'&&!!p.value;
   profile=(p.status==='fulfilled'&&p.value)||{displayName:activeUser.user_metadata?.display_name||activeUser.user_metadata?.full_name||activeUser.user_metadata?.name||'',steamAccountId:activeUser.user_metadata?.steam_account_id||''};
   profileSetupRequired=p.status==='fulfilled'&&(!p.value||!!activeUser.user_metadata?.steam_account_id&&!p.value.preferredRoles?.length);
   if(t.status==='fulfilled')teams=t.value;
   if(gen===generation){restorePractice();refreshScouting();}
   if(p.status==='rejected'||t.status==='rejected')notice('Some team account information could not be loaded. Reload the page to try again.');
  });
  if(!recovery&&!showTeamInvitation()){
   $('app-shell').dataset.profileSetup='pending';
   welcome.signedIn();
  }
 }
 render();
 if(user){
  resumingAccount=gen;
  try{
  await accountReady;
  // Clear the loading marker even if Home/Practice changed the workspace meanwhile;
  // left set, it hides the whole board.
  if(acct===accountGen&&$('app-shell').dataset.profileSetup==='pending')delete $('app-shell').dataset.profileSetup;
  if(gen!==generation)return;
  if(!inviteOnEntry&&!teamInvitation&&!recovery&&!welcome.recovery){
   const resume=async()=>{
    const params=new URLSearchParams(location.search);
    const draft=params.get('draft')||pendingDraft();
    if(validDraftId(draft)){
     try{await openDraft(draft);}catch(error){navigateTeam();notice(error.message);}finally{forgetDraft();}
    }else if(params.has('cup'))openCup();
    else if(!params.has('practice'))navigateTeam();
   };
   if(profileSetupRequired)startProfileSetup(resume);
   else await resume();
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
  const turn=nextTurn(state.actions,state.firstPick);
  if(!turn)return;
  const heroId=playerDemoHeroes[state.actions.length];
  const action={mode:turn.mode,heroId};
  if(turn.mode==='ourPick'){
   const playerIndex=state.actions.filter(item=>item.mode==='ourPick').length;
   action.playerId=state.roster[playerIndex].id;
   action.position=playerIndex+1;
  }
  state=reduceDraft(state,'append',action,{canWrite:true,heroes});
  selected=null;
  render();
  result.textContent=(turn.side==='our'?'Our team':'Enemy team')+' '+(turn.action==='pick'?'picked ':'banned ')+heroName(heroId)+'.';
  advance.disabled=state.actions.length===24;
 },replay,'primary');
 button('Restart replay',()=>{
  state=demoState();
  selected=null;
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

for(const id of ['setup-button','connection-status'])$(id).onclick=safe(lobby);$('profile-button').onclick=safe(profileDialog);
let signingOut=false;
async function signOut(){
 if(signingOut||!user||!backend)return;
 const control=$('signout-button'),account=user.id;
 signingOut=true;control.disabled=true;control.textContent='Signing out…';control.setAttribute('aria-busy','true');
 try{await backend.signOut();forgetDraft();if(user?.id===account)await authChanged(null,'SIGNED_OUT');}
 finally{signingOut=false;control.disabled=false;control.textContent='Sign out';control.removeAttribute('aria-busy');}
}
$('signout-button').onclick=safe(signOut);

const teamIdentity=mountTeamIdentity($('team-identity'),()=>demo?{user:{id:captainDemo?'demo-2':'demo-you'},teams:[sampleTeam],backend:demoIdentityBackend,demo:true}:{user,teams,teamId:homeTeamId||team?.id,backend},(id,name,imageId)=>{if(demo)Object.assign(sampleTeam,{name,identity_image_id:imageId});teams=teams.map(item=>item.id===id?{...item,name,identity_image_id:imageId}:item);if(homeTeamId===id)renderTeamHome();});
const imageId=new URLSearchParams(location.search).get('team-image');
const cup=mountBattleCup({
 root:$('cup-view'),
 getContext:()=>({user,teams,teamId:team?.id,backend,demo,profileReady:demo||profileSaved,profileHasDraftDetails:demo||!!(profile.preferredRoles?.length&&(profile.signatureHeroes?.length||profile.desiredHeroes?.length)),version:cupAccountVersion}),
 onSignIn:()=>welcome.home('signin'),
 onSetup:safe(lobby),
 onTeam:safe(async id=>{if(!demo&&id&&await loadTeam(id)===false)return;navigateTeam(id);}),
 onProfile:()=>profileDialog(false,null,true),
 onToday:()=>profileDialog(false,null,true,1),
 onDraft:()=>{focusDraftView();},
});
function showWorkspace(view){
 $('app-shell').dataset.workspace=view;
 if(view!=='team'){teamIdentity.clear();homeRequest++;}
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
  if(!url.searchParams.has('draft')&&!url.searchParams.has('demo')&&!url.searchParams.has('mock'))url.searchParams.set('practice','');
  history.pushState(null,'',url);
 }
}
function openCup(){showWorkspace('cup');welcome.board();void cup.refresh();}
$('draft-button').onclick=()=>{leaveCup();const url=new URL(location.href);if(url.searchParams.has('team')){url.searchParams.delete('team');if(!demo)url.searchParams.set(shared?'draft':'practice',shared?.id||'');history.pushState(null,'',url);}showWorkspace('draft');};
$('team-button').onclick=()=>navigateTeam();
let homeTeamId='';
let homeRoster=[];
let homeRequest=0;
const sampleTeam={id:'demo-team',name:'Night Shift',owner_user_id:'demo-2'};
function renderTeamHome(message=''){
 const root=$('team-home');
 const active=demo?sampleTeam:teams.find(item=>item.id===homeTeamId);
 const me=demo?(captainDemo?'demo-2':'demo-0'):user?.id||'local-player';
 const current={...profile,userId:me,displayName:profile.displayName||'You'};
 const source=demo?demoState().roster.map(item=>({...item.selfReport,userId:item.id,displayName:item.name})):homeRoster;
 const players=active?source.map(item=>item.userId===me?{...item,...current}:item):[current];
 if(active&&!players.some(item=>item.userId===me)&&me)players.push(current);
 const title=el('h1',active?.name||'Your player home');title.id='team-title';title.tabIndex=-1;
 root.replaceChildren(title);
 if(active?.identity_image_id&&(demo||backend)){
  const request=homeRequest;
  void (demo?demoIdentityBackend:backend).getTeamIdentityImage(active.identity_image_id).then(image=>{
   if(request!==homeRequest||!title.isConnected||!['image/png','image/jpeg','image/webp'].includes(image?.mime))return;
   const logo=el('img',null,'team-home-emblem');logo.alt='Team emblem';logo.src='data:'+image.mime+';base64,'+image.data;title.before(logo);
  }).catch(()=>{});
 }
 if(!demo&&teams.length>1){
  const switcher=el('select');switcher.setAttribute('aria-label','Choose team');
  for(const item of teams)switcher.append(new Option(item.name,item.id));
  switcher.value=homeTeamId;switcher.onchange=()=>navigateTeam(switcher.value);root.append(switcher);
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
  const choices=(player.signatureHeroes||[]).filter(id=>heroes[id]);
  const seed=Array.from(String(player.userId||'solo')).reduce((sum,ch)=>(sum*31+ch.charCodeAt(0))>>>0,0);
  const hero=heroes[player.avatarHeroId]?player.avatarHeroId:choices[seed%choices.length];
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
 if(!demo&&active?.owner_user_id===me&&homeRoster.length>1){
  const manage=el('details',null,'team-roster-details');
  manage.append(el('summary','Manage teammates'));
  const status=el('p');status.setAttribute('role','status');
  const account=user.id, request=homeRequest;
  let removing=false;
  for(const member of homeRoster.filter(item=>item.userId!==account)){
   const row=el('div',null,'team-member-management');
   const label=member.displayName||'Teammate';
   row.append(el('strong',label));
   const remove=button('Remove '+label,async()=>{
    if(removing||request!==homeRequest||user?.id!==account)return;
    if(!confirm('Remove '+label+' from '+active.name+'? This also releases their team Battle Cup spot and draft control, and resets the team invite link.'))return;
    removing=true;remove.disabled=true;
    try{
     await backend.removeTeamMember(active.id,member.userId,account);
     if(request!==homeRequest||user?.id!==account)return;
     if(team?.id===active.id){
      ++teamLoad;
      teamRoster=teamRoster.filter(item=>item.userId!==member.userId);
      selectedTeamIds=selectedTeamIds.filter(id=>id!==member.userId);
     }
     homeRoster=homeRoster.filter(item=>item.userId!==member.userId);
     // Removal resets the invite code server-side; reload teams so Copy invite link uses the new one.
     try{const fresh=await backend.listTeams();if(request===homeRequest&&user?.id===account){teams=fresh;if(team)team=teams.find(t=>t.id===team.id)||team;}}catch{}
     if(request!==homeRequest||user?.id!==account)return;
     renderTeamHome(label+' was removed from the team. The team invite link was reset: share the new one with players who have not joined yet.');renderRoster();
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
 if(!active&&user)button('Create or join a team',lobby,actions);
 button('Battle Cup',navigateCup,actions);
 button('Open draft board',focusDraftView,actions,'primary');
 root.append(actions);
}
function navigateTeam(id){
 const chosen=demo?sampleTeam:teams.find(item=>item.id===(id||homeTeamId||team?.id))||teams[0];
 const request=++homeRequest, account=user?.id;
 homeTeamId=chosen?.id||'';
 homeRoster=[];
 const url=new URL(location.href);
 url.searchParams.delete('cup');url.searchParams.delete('practice');url.searchParams.delete('draft');
 url.searchParams.set('team','');
 if(url.href!==location.href)history.pushState(null,'',url);
 showWorkspace('team');welcome.board();renderRoster();
 renderTeamHome(chosen&&!demo?'Loading team roster…':'');
 teamIdentity.open(homeTeamId);
 if(chosen&&!demo&&backend?.loadRoster){
  void backend.loadRoster(chosen.id).then(rows=>{
   if(request!==homeRequest||account!==user?.id||$('team-view').hidden)return;
   homeRoster=rows;renderTeamHome();renderRoster();
  }).catch(()=>{
   if(request===homeRequest&&account===user?.id&&!$('team-view').hidden)renderTeamHome('Could not load the roster. Reopen Team to retry.');
  });
 }
}

function navigateCup(){
 const url=new URL(location.href);url.searchParams.delete('draft');url.searchParams.delete('team');url.searchParams.set('cup','');
 if(url.href!==location.href)history.pushState(null,'',url);
 openCup();
};
$('session-dialog').addEventListener('close',()=>{if(!$('cup-view').hidden)void cup.refresh();});
for(const event of ['focus','online'])window.addEventListener(event,()=>{
 if(!$('cup-view').hidden&&document.body.dataset.view==='board')void cup.refresh();
});
if(!teamInvitation&&new URLSearchParams(location.search).has('cup'))openCup();
if(demo&&new URLSearchParams(location.search).has('team'))navigateTeam();


$('hero-search').oninput=()=>{searchIndex=0;renderHeroes();};$('claim-drafter').onclick=safe(()=>mutate('claim'));$('release-drafter').onclick=safe(()=>mutate('release'));$('undo').onclick=safe(()=>mutate('undo'));$('first-pick').onchange=safe(()=>mutate('set_state',{firstPick:$('first-pick').checked}));$('reset-draft').onclick=safe(async()=>{if(confirm('Reset all draft actions?'))await mutate('reset');});

$('create-session').onclick=safe(async()=>{if(!user||!team||demo)throw Error('Select a team first.');const teamId=team.id;if(!await loadTeam(teamId,{preserveSelection:true}))return;const row=await backend.createDraft(teamId,{actions:[],firstPick:true,enemyIds:[],roster:draftRoster(),assignments:{},source:'manual'});await openDraft(row.id);});

$('join-session').onclick=safe(async()=>{let id=$('session-input').value.trim();try{id=new URL(id).searchParams.get('draft')||id;}catch{}if(!/^[a-f0-9-]{36}$/i.test(id)){$('session-input').setAttribute('aria-invalid','true');throw Error('Enter a valid draft UUID or full session URL.');}$('session-input').removeAttribute('aria-invalid');await openDraft(id);});$('copy-session').onclick=safe(async()=>{if(!shared)return;const url=new URL(location.origin+location.pathname);url.searchParams.set('draft',shared.id);await navigator.clipboard.writeText(url.href);notice('Session link copied. Team membership is required.');});

document.addEventListener('keydown',e=>{if(document.body.dataset.view==='welcome'||$('draft-view').hidden||document.querySelector('dialog[open]'))return;const editing=e.target.closest('input,textarea,select,fieldset,[contenteditable]');if(e.target===$('hero-search')&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const count=heroChoices().length;searchIndex=count?(searchIndex+(e.key==='ArrowDown'?1:-1)+count)%count:0;highlightSearch();return;}if(e.key==='Escape'){selected=null;$('hero-search').value='';render();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!editing){e.preventDefault();if(canWrite()&&state.actions.length)void safe(()=>mutate('undo'))();return;}if(e.key==='Enter'&&e.target===$('hero-search')){e.preventDefault();const first=heroChoices()[searchIndex];first?.click();return;}if(!editing&&!e.target.closest('button,a')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.length===1){e.preventDefault();$('hero-search').focus();$('hero-search').value+=e.key==='/'?'':e.key;renderHeroes();}});

for(const control of document.querySelectorAll('[data-hero-filter]'))control.onclick=()=>{heroFilter=control.dataset.heroFilter;searchIndex=0;for(const other of document.querySelectorAll('[data-hero-filter]'))other.setAttribute('aria-pressed',String(other===control));renderHeroes();};
$('clear-hero-search').onclick=()=>{$('hero-search').value='';searchIndex=0;renderHeroes();$('hero-search').focus();};
$('drafter-seat').onclick=()=>{const action=!$('claim-drafter').disabled?$('claim-drafter'):$('release-drafter');action.scrollIntoView?.({block:'center'});if(!action.hidden)action.focus();};
const skip=document.querySelector('.skip-link');if(skip)skip.onclick=e=>{e.preventDefault();if(!$('cup-view').hidden)$('cup-view').focus();else if(!$('team-view').hidden)$('team-title')?.focus();else focusDraftView();};
function openLinkInvitation(){
 if(demo)return false;
 const invite=readInvitation();if(!invite)return false;
 teamInvitation=invite;return showTeamInvitation();
}
window.addEventListener('hashchange',openLinkInvitation);
window.addEventListener('popstate',()=>void safe(async()=>{if(openLinkInvitation())return;const params=new URLSearchParams(location.search);if(params.has('cup')){openCup();return;}if(params.has('team')&&(user||demo)){navigateTeam();return;}showWorkspace('draft');if(params.has('demo')||params.has('mock')){if(demo){detachWorkspace();welcome.board();render();}else location.reload();return;}const draft=params.get('draft');if(draft){if(user)await openDraft(draft,{navigate:false});else{detachWorkspace();welcome.home('signin');}}else if(params.has('practice')){enterPractice({navigate:false});welcome.board();}else if(!showTeamInvitation()){detachWorkspace();welcome.home();}})());
setInterval(()=>{void poll();refreshSightings();},3000);window.addEventListener('focus',()=>void poll());window.addEventListener('online',()=>void poll());

if(imageId!==null){
 $('welcome-view').hidden=true;
 $('app-shell').hidden=true;
 $('identity-download').hidden=false;
} else {showTeamInvitation();render();refreshScouting();if(demo&&new URLSearchParams(location.search).has('profile'))profileDialog();}

if(imageId===null)void loadHeroes().then(value=>{heroes=Object.fromEntries(Object.entries(value).map(([id,h])=>[id,{...heroes[id],...h,pub_pick:heroes[id]?.pub_pick??h.pub_pick}]));suggestionCache.key='';render();}).catch(()=>{});

if(imageId===null)void publicData.request('/heroStats',{priority:0,ttl:86400000}).then(rows=>{for(const h of rows)if(heroes[h.id])heroes[h.id]={...heroes[h.id],...h};suggestionCache.key='';render();}).catch(()=>{});

if(imageId!==null)void (async()=>{
 const root=$('identity-download');
 try{
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(imageId))throw Error();
  if(demo){await showIdentityDownload(root,demoIdentityBackend,imageId);return;}
  const config=typeof __BOARD_CONFIG__==='object'&&__BOARD_CONFIG__?.url&&__BOARD_CONFIG__?.anonKey?__BOARD_CONFIG__:await (await fetch('/api/config',{cache:'no-store'})).json();
  await showIdentityDownload(root,createBackend({supabaseUrl:config.url,supabaseAnonKey:config.anonKey}),imageId);
 }catch{root.textContent='This image is unavailable.';}
})();
else if(!demo)void (async()=>{try{

 const authFragment=new URLSearchParams(location.hash.slice(1));
 let oauthProvider;try{oauthProvider=sessionStorage.getItem('captain-oauth-provider');sessionStorage.removeItem('captain-oauth-provider');}catch{}
 const steamToken=authFragment.get('steam_token');
 // Show progress instead of a signed-out home while a callback or a stored session resolves.
 const callback=!!(steamToken||oauthProvider||authFragment.has('access_token')||new URLSearchParams(location.search).has('code'));
 let storedSession=false;try{storedSession=Object.keys(localStorage).some(key=>/^sb-.+-auth-token$/.test(key));}catch{}
 if(callback||storedSession||'authPending' in document.documentElement.dataset){welcome.loading(callback?'Signing you in…':'Loading your account…');setTimeout(()=>welcome.loading(),15000);}
 if(steamToken){const clean=new URL(location.href);clean.hash='';history.replaceState(null,'',clean);}

 if(authFragment.has('error')||authFragment.has('error_code')){

  const clean=new URL(location.href);

  clean.hash='';

  history.replaceState(null,'',clean);

  welcome.linkError(oauthProvider);

 }

 // Use the config baked in at build time; fall back to /api/config when the build had none.
 const inlined=typeof __BOARD_CONFIG__==='object'&&__BOARD_CONFIG__?.url&&__BOARD_CONFIG__?.anonKey?__BOARD_CONFIG__:null;
 let config=inlined;
 if(!config){const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok){welcome.setConnection('unavailable');return;}config=await response.json();if(!config.url||!config.anonKey){welcome.setConnection('unavailable');return;}}steamEnabled=config.steamAuth===true;googleEnabled=config.googleAuth===true;backend=createBackend({supabaseUrl:config.url,supabaseAnonKey:config.anonKey});
 if(teamInvitation&&!user&&$('team-invite-heading'))showTeamInvitation(true);
 if(new URLSearchParams(location.search).has('steam-error')){
  welcome.home('signin');
  const message=$('welcome-auth').querySelector('.auth-message[role=status]');
  if(message){message.dataset.state='error';message.textContent='Steam sign-in did not finish. Try again.';}
 }
 if(steamToken){
  try {await backend.verifySteam(steamToken);}
  catch {history.replaceState(null,'','/?steam-error');location.reload();return;}
 }
 backend.onAuthChange((session,event)=>{
  observedAuthUser=session?.user?.id||null;++authEvent;
  setTimeout(()=>void safe(()=>authChanged(session,event))(),0);
 });const initialSession=await backend.getSession();
 if(!initialSession&&pendingDraft()&&!teamInvitation&&!authFragment.has('error')&&!authFragment.has('error_code')&&!new URLSearchParams(location.search).has('steam-error'))welcome.home('signin');
 await authChanged(initialSession);welcome.loading();welcome.setConnection('available');render();
 // Sign-in provider flags can change without a rebuild; refresh them in the background.
 if(inlined)void fetch('/api/config',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(fresh=>{if(!fresh?.url)return;steamEnabled=fresh.steamAuth===true;googleEnabled=fresh.googleAuth===true;welcome.setConnection('available');}).catch(()=>{});}catch{welcome.setConnection('unavailable');notice('Sign-in service unavailable. Local practice remains available.');}})();





