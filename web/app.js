// Board entry: fills the late-bound actions, wires page-wide listeners and starts up
// (config, sign-in state, hero data).
import {signupProgress} from './signup-progress.js';
import {mountTeamIdentity,showIdentityDownload,demoIdentityBackend} from './team-identity.js';
import {mountBattleCup} from './bcup.js';
import {createWelcome} from './welcome.js';
import {CM_ORDER,CM_PHASE_STARTS,nextTurn,parseAccountIds,normalizeProfile,diverseTop,reviewLineup} from './draft-engine.js';
import {comfortRows,enemyBanTarget,allyCounterBans,recentCupGames,tileMark,heroStatRows,sourceStatus,MIN_GAMES,WARN_RATE} from './draft-stats.js';
import {renderPlayerRail,resetAllyEntry,SEAT_STATUS} from './war-room.js';
import {publicData,loadPlayer,loadHeroes} from './data.js';
import {initialState,demoState,reduceDraft} from './demo.js';
import {createBackend} from './backend.js';
import {DAY_MS,DISPLAY_NAME_MAX,GOOGLE_ATTEMPT_KEY,HERO_LIST_MAX,LOCAL_HELPER_ORIGIN,OAUTH_PROVIDER_KEY,ROSTER_SIZE,TOP_RECOMMENDATIONS} from './constants.js';
import {urlParams,demo,captainDemo,playerDemo,UUID,validDraftId,inlinedConfig,pendingDraft,forgetDraft,teamInviteCode,forgetInvitation,readInvitation,codeFromInvitation,imageId} from './url-state.js';
import {store} from './store.js';
import {$,el,notice,safe,button,field,focusDraftView,show,showIfClosed} from './dom.js';
import {ui,render} from './ui.js';
import {accountOf,memberId,providerName,stratz,touch,observations,requestedMatchups,matchupErrors,allyCounterFailures,resetDraftData,matchupCoverage,canWrite,roleNames,heroName,portrait,derived,roster,opponents,playerSummary,ranking} from './draft-data.js';
import {saveLocal,restorePractice} from './practice-store.js';
import {stratzCredit,appendStratzCredit,requestAllyCounters,refreshScouting} from './scouting.js';
import {enemyDetails,addEnemyMatches,refreshSightings,renderEnemyAssignment,renderDraftEnemies} from './enemy-intel.js';
import {detachWorkspace,enterPractice,mutate,openDraft,poll,draftRoster,loadTeam,mutateOwner} from './draft-sync.js';
import {stopLiveWatch,checkLiveWatch} from './live-watch.js';
Object.assign(ui,{stopLiveWatch,renderView,renderTeamHome});
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
let rankedIds=new Set();

let steamEnabled=false;
let googleEnabled=false;
let profileSaved=false;
let profileSetupRequired=false;
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
 if(profileSetupRequired)startProfileSetup(go);else await go();
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
   if(profileSetupRequired)startProfileSetup(()=>navigateTeam(joined.id),joined);
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

function stage(id,rec){
 store.selected={id,...rec};
 render();
 const confirm=$('suggestions').querySelector('button.primary');
 if(!confirm||confirm.disabled)return;
 confirm.focus({preventScroll:true});
 const bounds=confirm.getBoundingClientRect();
 if(bounds.top<0||bounds.bottom>window.innerHeight)confirm.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function renderView(){
 $('signout-button').hidden=!store.user||demo;

 const turn=nextTurn(store.state.actions,store.state.firstPick),write=canWrite();

 $('connection-status').textContent=demo?'Demo · sample data':store.shared?(store.healthy?'Shared · synced':'Shared · reconnecting'):'Practice · this device';

 $('session-code').textContent=store.shared?store.shared.id.slice(0,8):'Local';
 $('copy-session').disabled=!store.shared;

 $('session-status').textContent=store.shared&&!write?'Following draft · updates sync automatically. Become drafter to make changes.':demo?'Demo never writes to the backend.':store.user?'Signed in · select a team and draft.':'Local practice. Sign in for shared drafts.';

 $('draft-owner').textContent=playerDemo?'Sam · captain controls the draft':store.shared?(store.shared.drafter_user_id?(roster().find(p=>p.id===store.shared.drafter_user_id)?.name||'Team member')+' controls the draft':'Seat available'):(store.localControl?'You · local practice':'Local seat available');

 $('claim-drafter').disabled=store.pending||!store.healthy||!!(store.shared?.drafter_user_id)||(!store.shared&&store.localControl);
 $('release-drafter').hidden=store.shared?!store.user||!(store.shared.drafter_user_id===store.user.id||store.teams.find(t=>t.id===store.shared.team_id)?.owner_user_id===store.user.id):!store.localControl;

 if(playerDemo){
  $('claim-drafter').hidden=true;
  $('release-drafter').hidden=true;
  $('drafter-seat').hidden=true;
  $('session-status').textContent='Player demo · follow the captain’s picks and bans.';
 }
 $('turn-label').textContent=turn?(turn.side==='our'?'Our ':'Enemy ')+turn.action:'Draft complete';
 $('turn-progress').textContent=`${store.state.actions.length} / ${CM_ORDER.length} actions · ${demo?'Invented demo':store.shared?'Shared team draft':'Manual practice'}`;

 $('undo').disabled=!write||!store.state.actions.length;
 $('reset-draft').disabled=!write;
 $('first-pick').checked=store.state.firstPick;
 $('first-pick').disabled=!write||!!store.state.actions.length;

 renderSeats();
 renderDraftTree();

 for(const side of ['our','enemy']){
  const list=$(side+'-lineup');
  list.replaceChildren();
  const picks=store.state.actions.filter(a=>a.mode===side+'Pick');
  for(let i=0;i<ROSTER_SIZE;i++){
   const li=el('li',null,'lineup-slot'),a=picks[i];
   if(a)li.append(portrait(a.heroId));else li.append(el('span',String(i+1).padStart(2,'0'),'slot-portrait'));
   li.append(el('span',a?heroName(a.heroId)+(a.position?' · P'+a.position:''):'Empty','slot-name'));
   list.append(li);
  }
 }

 renderRecommendations(turn,write);
 appendStratzCredit();
 renderHeroes();
 renderRoster();
 renderDraftEnemies();

 $('analysis').hidden=!!turn||!store.reviewVisible;
 if(turn)$('analysis').replaceChildren();
 if(!turn){
  const n=$('analysis');
  n.replaceChildren(el('h2','Draft review'),el('p','Heuristic composition review; ranking indices are not win probabilities. Missing public history remains unknown.'));
  const review=reviewLineup({draft:store.state.actions,stratz,heroes:store.heroes});
  for(const side of ['our','enemy']){
   const picks=store.state.actions.filter(a=>a.mode===side+'Pick'),info=review[side];
   n.append(el('h3',side==='our'?'Our lineup':'Enemy lineup'));
   for(const a of picks){
    const row=el('div',null,'review-player');
    row.append(portrait(a.heroId),el('p',heroName(a.heroId)+(a.position?' · Position '+a.position:' · Position unassigned')+(a.playerId?' · '+(roster().find(p=>p.id===a.playerId)?.name||a.playerId):'')));
    n.append(row);
    const notes=el('ul',null,'review-notes');
    for(const note of info.heroes.find(h=>h.heroId===+a.heroId)?.notes||[])notes.append(el('li',note.text,'review-note-'+note.tone));
    n.append(notes);
   }
   n.append(el('p','Matchup edge (Divine+): '+(info.edge===null?'no data':`${info.edge>=0?'+':''}${info.edge.toFixed(1)} per matchup across ${info.pairs} matchups`)));
  }
  if([...review.our.heroes,...review.enemy.heroes].some(h=>h.notes.some(x=>x.tone!=='info')))n.append(stratzCredit());
  n.append(el('p',`Observed matchup coverage: ${matchupCoverage().observed} / ${matchupCoverage().total} opposing pairs observed; missing pairs have no matchup evidence. Bans: `+store.state.actions.filter(a=>a.mode.endsWith('Ban')).map(a=>heroName(a.heroId)).join(', ')));
  button('Show hero board',()=>{store.reviewVisible=false;render();},n);
 }
 if(!turn&&!$('analysis').hidden)renderEnemyAssignment($('analysis'));

}
function seatData(player,side,taken,now){
 const hasAccount=side==='enemy'||accountOf(player);
 const summary=playerSummary(player,now),state=hasAccount?summary.state:'ready';
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
  const counters=allyCounterBans(comfort[0].heroId,store.allyCounterMatchups[comfort[0].heroId],taken);
  if(counters.length){bans=counters.map(row=>heroName(row.heroId)).join(', ');banIds=counters.map(row=>+row.heroId);}
 }
 const cup=usable?recentCupGames(player,now):[];
 const position=side==='enemy'?summary.positions?.[0]?.position:player.selfReport.preferredRoles?.[0];
 return {id:String(player.id),name:player.name,side,position,state,comfort,banLabel,bans,cup,cupEmpty:absence(['recent','matches'],'No recent cups'),heroIds:[...new Set([...comfort.map(row=>+row.heroId),...cup.map(game=>+game.heroId),...banIds])]};
}
function renderSeats(){
 const taken=new Set(store.state.actions.map(action=>+action.heroId)),now=Math.floor(Date.now()/1000);
 renderPlayerRail($('player-rail'),{
  allies:roster().slice(0,ROSTER_SIZE).map(player=>seatData(player,'ally',taken,now)),
  enemies:opponents().slice(0,ROSTER_SIZE).map(player=>seatData(player,'enemy',taken,now)),
  focusId:store.focusedPlayer,portrait,heroName,
  onToggle:id=>{store.focusedPlayer=store.focusedPlayer===id?null:id;render();},
  onAddEnemy:safe(lobby),
  // Local practice only: add a teammate to an open seat by public ID, no Setup or team needed.
  onAddAlly:!store.shared&&!demo&&canWrite()?addAllyById:null
 });
}
async function addAllyById(text){
 const tokens=String(text||'').trim().split(/[\s,;]+/).filter(Boolean),ids=parseAccountIds(text);
 if(tokens.length!==1||ids.length!==1)throw Error('Enter one valid player ID or profile link.');
 const current=(Array.isArray(store.state.roster)?store.state.roster:[]).filter(p=>p&&typeof p==='object');
 if(current.length>=ROSTER_SIZE)throw Error('Our team already has five players.');
 const id=String(ids[0]);
 if(current.some(p=>String(accountOf(p)||'')===id))throw Error('This player is already on our team.');
 await mutate('set_state',{roster:[...current,{id,name:id,steamAccountId:id}]});
 // mutate() returns quietly while another change is still saving; only confirm a real change.
 if(!(store.state.roster||[]).some(p=>String(p?.steamAccountId||'')===id))throw Error('Another change is still saving. Try again.');
 notice('Player '+id+' added to our team.');
}
let freshActionIndex=-1;
function renderDraftTree(){
 const tree=$('timeline');tree.replaceChildren();$('history-inspect').textContent='Select a recorded hero to inspect the action.';
 CM_ORDER.forEach((step,index)=>{
  const ours=step.team===(store.state.firstPick?'A':'B');
  const recorded=store.state.actions[index],current=index===store.state.actions.length;
  const row=el('div',null,'tree-turn');
  row.dataset.side=ours?'our':'enemy';
  row.dataset.action=step.action.toLowerCase();
  row.classList.toggle('phase-start',CM_PHASE_STARTS.includes(index));
  const slot=el('button',null,'tree-row');
  slot.type='button';
  slot.id='draft-turn-'+index;
  slot.dataset.action=step.action.toLowerCase();
  slot.dataset.turn=index;
  slot.classList.toggle('is-recorded',!!recorded);
  slot.classList.toggle('is-fresh',index===freshActionIndex&&!!recorded);
  slot.classList.toggle('is-current',current);
  const label=`Turn ${index+1}, ${ours?'our':'enemy'} ${step.action.toLowerCase()}${recorded?', '+heroName(recorded.heroId):current?', select a hero':', waiting'}`;
  slot.setAttribute('aria-label',label);
  slot.title=label;
  if(current)slot.setAttribute('aria-current','step');
  const preview=current&&store.selected&&store.heroes[store.selected.id]&&!store.state.actions.some(a=>+a.heroId===+store.selected.id)?store.selected.id:null;
  if(preview!=null){
   const text=label+', previewing '+heroName(preview);
   slot.setAttribute('aria-label',text);
   slot.title=text;
   const img=portrait(preview);
   img.className='tree-hero tree-preview';
   slot.append(img);
  }
  else if(recorded){const img=portrait(recorded.heroId);img.className='tree-hero';slot.append(img);}
  else{
   const placeholder=el('span',null,'tree-placeholder'),icon=el('span',current?step.action.toUpperCase():'');
   icon.setAttribute('aria-hidden','true');
   placeholder.append(icon);
   slot.append(placeholder);
  }
  slot.disabled=!recorded&&!current;
  slot.onclick=()=>{
   if(current){focusDraftView();return;}
   $('history-inspect').replaceChildren(portrait(recorded.heroId),el('strong',heroName(recorded.heroId)),el('span',(ours?'Our ':'Enemy ')+step.action.toLowerCase()+' · turn '+(index+1)+(recorded.position?' · P'+recorded.position:'')));
  };
  const number=el('span',String(index+1),'tree-number');
  number.setAttribute('aria-hidden','true');
  row.append(slot,number);
  tree.append(row);
 });
}

let heroFilter='all';
function focusedHeroIds(taken){
 if(store.focusedPlayer==null)return null;
 const now=Math.floor(Date.now()/1000);
 const seat=[...roster().slice(0,ROSTER_SIZE).map(p=>[p,'ally']),...opponents().slice(0,ROSTER_SIZE).map(p=>[p,'enemy'])].find(([p])=>String(p.id)===store.focusedPlayer);
 return seat?new Set(seatData(seat[0],seat[1],taken,now).heroIds):null;
}

function suggestionSets(){
 const c=derived(),top=mode=>new Set(ranking(mode).slice(0,TOP_RECOMMENDATIONS).map(row=>+row.heroId));
 return c.sets||={pick:top('ourPick'),ban:top('ourBan')};
}
function enemyWinChips(){
 const chips=new Map();
 for(const player of opponents())for(const row of heroStatRows(player.heroes)){
  if(row.winRate==null||row.games<MIN_GAMES||row.winRate<WARN_RATE)continue;
  const current=chips.get(row.heroId);
  if(!current||row.winRate>current.winRate)chips.set(row.heroId,{...row,player:player.name});
 }
 return chips;
}
function renderHeroes(){
 const root=$('hero-groups');root.replaceChildren();
 const ourPick=nextTurn(store.state.actions,store.state.firstPick)?.mode==='ourPick';
 const assigned=new Set(store.state.actions.filter(action=>action.mode==='ourPick').map(action=>action.playerId).filter(Boolean));
 const available=roster().filter(player=>!assigned.has(player.id)&&player.selfReport.availability!=='unavailable');
 const wanted=new Set(ourPick?available.flatMap(player=>player.selfReport.desiredHeroes):[]);
 root.setAttribute('aria-label','Heroes by attribute, A to Z');
 const query=$('hero-search').value.toLowerCase();
 const takenBy=new Map(store.state.actions.map(action=>[+action.heroId,action.mode])),suggestions=suggestionSets(),chips=enemyWinChips(),playerHeroes=focusedHeroIds(new Set(takenBy.keys()));
 const matches=hero=>hero.localized_name.toLowerCase().includes(query);
 let matched=0;
 const popularity=hero=>Number.isFinite(hero.pub_pick)&&hero.pub_pick>=0?hero.pub_pick:-1;
 for(const [attribute,label] of [['str','Strength'],['agi','Agility'],['int','Intelligence'],['all','Universal']]){
  const attributeFilter=heroFilter==='all-attr'?'all':heroFilter;
  const visibleGroup=heroFilter==='all'||heroFilter==='recommended'||attributeFilter===attribute;
  if(!visibleGroup)continue;
  const list=Object.values(store.heroes).filter(hero=>hero.primary_attr===attribute&&(heroFilter!=='recommended'||(!takenBy.has(+hero.id)&&rankedIds.has(+hero.id)&&matches(hero))));
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
   tile.setAttribute('aria-label',hero.localized_name);tile.setAttribute('aria-pressed',String(store.selected?.id===+hero.id));
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
 if(!root.children.length||(query&&!matched)){
  root.replaceChildren();
  const empty=el('p','No heroes match your search or filters. Try another name or All heroes.');
  empty.setAttribute('role','status');
  root.append(empty);
 }
 highlightSearch();
}

// Typing only changes which tiles match, so toggle the existing tiles. The Recommended
// filter and the no-match message change which tiles exist: rebuild for those.
function searchHeroes(){
 store.searchIndex=0;
 const tiles=[...$('hero-groups').querySelectorAll('.hero-tile')],query=$('hero-search').value.toLowerCase();
 const misses=tiles.map(tile=>!!query&&!String(store.heroes[tile.dataset.heroId]?.localized_name||'').toLowerCase().includes(query));
 if(heroFilter==='recommended'||!tiles.length||misses.every(Boolean)){renderHeroes();return;}
 tiles.forEach((tile,i)=>tile.classList.toggle('is-search-miss',misses[i]));
 highlightSearch();
}
function heroChoices(){return [...$('hero-groups').querySelectorAll('.hero-tile:not(:disabled):not(.is-search-miss)')];}
function highlightSearch(){
 const all=[...$('hero-groups').querySelectorAll('.hero-tile')],tiles=heroChoices();
 store.searchIndex=Math.max(0,Math.min(store.searchIndex,tiles.length-1));
 all.forEach(b=>{b.classList.remove('is-highlighted');b.id='hero-result-'+b.dataset.heroId;});
 tiles[store.searchIndex]?.classList.add('is-highlighted');
 const search=$('hero-search');
 if(tiles[store.searchIndex])search.setAttribute('aria-activedescendant',tiles[store.searchIndex].id);else search.removeAttribute('aria-activedescendant');
}

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

function renderRecommendations(turn,write){
 const root=$('suggestions');
 root.replaceChildren();
 if(!turn){
  rankedIds.clear();
  const done=el('div',null,'decision-dock');
  root.append(done);
  done.append(el('p',`All ${CM_ORDER.length} actions recorded.`));
  button('Show draft review',()=>{store.reviewVisible=true;render();},done);
  return;
 }
 const best=el('div',null,'best-now'),dock=el('div',null,'decision-dock');
 const evidenceSources=evidenceSummaries(turn);
 root.append(best,dock);
 const ranked=ranking(turn.mode);
 rankedIds=new Set(ranked.slice(0,TOP_RECOMMENDATIONS).map(r=>r.heroId));
 const rec=store.selected?ranked.find(r=>r.heroId===store.selected.id):null;
 if(store.selected&&!store.state.actions.some(a=>+a.heroId===store.selected.id)){

 const feature=el('div',null,'rec-feature'),body=el('div',null,'rec-body');
  feature.append(portrait(store.selected.id),body);
  body.append(el('h3',heroName(store.selected.id)),el('p',rec?`Original recommendation: ranking index ${rec.score} · ${rec.playerName||'Unassigned player'}`:'Manual selection · evidence unavailable'));
  const reasons=[...(rec?.reasons||[]),...(rec?.evidence||[])];
 if(reasons.length)body.append(el('p',reasons[0],'decision-reason'));
 if(reasons.length>1){
  const details=el('details',null,'decision-reasons');
  details.append(el('summary','Why this hero'));
  for(const reason of reasons.slice(1))details.append(el('p',reason));
  body.append(details);
 }

 let player,position;
  if(turn.mode==='ourPick'){
   const used=store.state.actions.filter(a=>a.mode==='ourPick'),playerLabel=el('label','Assign allied player','player-assignment');
   player=el('select');
   player.id='assigned-player';
   playerLabel.htmlFor=player.id;
   player.append(new Option('Unassigned',''));
   for(const p of roster().filter(p=>!used.some(a=>a.playerId===p.id)))player.append(new Option(p.name,p.id));
   player.value=store.selected.playerId??rec?.playerId??'';
   player.onchange=()=>{store.selected.playerId=player.value;};
   playerLabel.append(player);
   const picker=el('fieldset',null,'position-picker'),options=el('div',null,'position-options'),status=el('p',null,'position-status');
   status.setAttribute('role','status');
   position=Object.hasOwn(store.selected,'position')?store.selected.position:rec?.position??'';
   if(used.some(a=>+a.position===+position))position='';
   const update=()=>{status.textContent=position?'P'+position+' · '+roleNames[+position-1]:'Unassigned';};
   picker.append(el('legend','Assign position'),options);
   for(let i=1;i<=5;i++){
    const label=el('label',null,'position-option'),radio=el('input'),copy=el('span',null,'position-copy');
    radio.type='radio';
    radio.name='assigned-position';
    radio.value=String(i);
    radio.checked=+position===i;
    radio.disabled=used.some(a=>+a.position===i);
    radio.onchange=()=>{if(radio.checked){store.selected.position=position=radio.value;update();}};
    copy.append(el('strong','P'+i),el('small',roleNames[i-1]));
    label.append(radio,copy);
    options.append(label);
   }
   button('Unassigned',()=>{
    store.selected.position=position='';
    for(const radio of options.querySelectorAll('input'))radio.checked=false;
    update();
   },picker,'position-auto');
   update();
   picker.append(status);
   body.append(playerLabel,picker);
  }

 const confirm=button(`${turn.side==='enemy'?'Enemy ':''}${turn.action==='pick'?'Pick':'Ban'} ${heroName(store.selected.id)}`,async()=>{
  const a={mode:turn.mode,heroId:store.selected.id};
  if(player?.value)a.playerId=player.value;
  if(position&&!store.state.actions.some(a=>a.mode==='ourPick'&&+a.position===+position))a.position=+position;
  const before=store.state.actions.length;
  await mutate('append',a);
  if(store.state.actions.length===before+1){freshActionIndex=before;render();freshActionIndex=-1;}
 },feature,'primary');
  confirm.disabled=!write;
 button('Clear selection',()=>{store.selected=null;render();$('hero-search').focus();},feature,'clear-staged');
 if(!write)feature.append(el('p',playerDemo?'Only the captain can confirm picks and bans.':store.shared?'Become drafter to confirm this action.':'Take the drafter seat to confirm this action.','decision-readonly'));
 dock.append(feature);

 }else dock.append(el('p','Choose a suggested hero or browse the pool. Review your selection here before confirming.','decision-empty'));

 const candidates=el('div',null,'decision-candidates');
 candidates.append(el('h3',turn.action==='ban'?'Best bans now':'Best picks now'));
 best.append(candidates);
 const more=el('details',null,'more-candidates');
 more.append(el('summary','More suggestions'));
 let candidateIndex=0;
 const visibleCandidates=diverseTop(ranked.filter(candidate=>candidate.heroId!==store.selected?.id),8,2);
 if(turn.mode==='ourPick'&&visibleCandidates.length){
  const legend=el('div',null,'rec-legend');
  legend.setAttribute('aria-label','Suggestion categories');
  for(const [cls,label] of [['team','Team'],['counter','Counter'],['meta','Meta'],['all','All three']])legend.append(el('span',label,'rec-badge rec-badge-'+cls));
  candidates.before(legend);
 }
 for(const r of visibleCandidates){
  const b=button('',()=>stage(r.heroId,r),candidateIndex++<6?candidates:more,'rec-row');
  const summary=el('span',null,'rec-summary');
  summary.append(el('strong',heroName(r.heroId)),el('span',[r.playerName,r.position?'P'+r.position:null].filter(Boolean).join(' · ')),el('small',r.reasons[0]||r.evidence[0]||'Limited data'));
  b.append(portrait(r.heroId),summary);
 const win=heroEvidence(r.heroId,evidenceSources,r.playerId);
  if(win)summary.append(el('span',win,'rec-win'));
  const tags=r.tags||[];
  if(tags.length){
   const badges=el('span',null,'rec-badges');
   if(tags.length===3){b.classList.add('rec-all-three');badges.append(el('span','All three','rec-badge rec-badge-all'));}
   for(const t of tags){b.classList.add('rec-tag-'+t);badges.append(el('span',{team:'Team',counter:'Counter',meta:'Meta'}[t],'rec-badge rec-badge-'+t));}
   summary.append(badges);
  }
  b.title=[...r.reasons,...r.evidence].join('\n');
 }
 if(!ranked.length)best.append(el('p','No evidence-backed recommendations for this turn. Manual selection is available.'));
 if(visibleCandidates.length>6)best.append(more);
 const coverage=matchupCoverage(),evidence=el('details',null,'decision-evidence');
 evidence.append(el('summary',`Matchup evidence · ${coverage.observed} / ${coverage.total} pairs`),el('p','Heuristic rankings · public coverage varies. Enemy assignments stay unconfirmed.'));
 dock.append(evidence);
 if(matchupErrors.size){
  evidence.append(el('p','Some matchup requests are unavailable.'));
  button('Retry unavailable matchup data',()=>{
   for(const id of matchupErrors)requestedMatchups.delete(id);
   matchupErrors.clear();
   allyCounterFailures.clear();
   refreshScouting();
   render();
  },dock);
 }


}
function renderRoster(){
 const root=$('team-roster');root.replaceChildren();
 const homeActive=!$('team-view').hidden&&store.user;
 const allies=homeActive?(store.homeTeamId?store.homeRoster:[{...store.profile,userId:store.user.id}]).map(item=>normalizeProfile({...item,id:item.userId,name:item.displayName||'Teammate'},item)):roster();
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
   if(sources.length){
    const details=el('details',null,'roster-sources');
    details.append(el('summary','Public data and freshness'));
    for(const [source,status] of sources)details.append(el('p',`${source}: ${status.status}${status.cached?' - cached':''}${status.at?' · '+new Date(status.at).toLocaleString():''}${status.message?' · '+status.message:''}`));
    card.append(details);
   }
   root.append(card);
  }
 }
 if(!root.children.length){
  root.append(el('p','Your team starts here. Add your profile or invite teammates from Setup.'));
  button('Edit my profile',()=>profileDialog(),root,'primary');
  button('Invite or import players',lobby,root);
 }
}

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

   if(selected.size>=HERO_LIST_MAX){onError(`Choose up to ${HERO_LIST_MAX} heroes in each list. Remove one first.`);return;}

   selected.add(id);

  }

  const focused=document.activeElement,source=focused?.classList.contains('profile-hero-chip')?'chip':'choice';
  onError('');draw();
  const replacement=wrap.querySelector(`[data-hero-id="${id}"][data-source="${source}"]`)||wrap.querySelector(`[data-hero-id="${id}"]`);
  (replacement||search).focus();

 }

 function draw(){

  count.textContent=selected.size+' / '+HERO_LIST_MAX+' selected';chips.replaceChildren();

  for(const id of selected){

   const b=button('',()=>toggle(id),chips,'profile-hero-chip');

   b.dataset.heroId=id;b.dataset.source='chip';
   b.append(portrait(id),el('span',heroName(id)),el('span','×'));

   b.setAttribute('aria-label','Remove '+heroName(id));

  }

  search.placeholder='Search all heroes';
  const played=new Map((observations.get(getAccountId?.()||String(store.profile.steamAccountId||''))?.heroes||[]).filter(h=>h.games>0).map(h=>[+h.hero_id,h.games]));

  const query=search.value.trim().toLowerCase(),roles=getRoles(),support=roles.length&&roles.every(role=>role>=4);

  const core=roles.length&&roles.every(role=>role<=3);

  hint.textContent=query?'Matching heroes · click to toggle.':support?'Popular support suggestions · choose heroes you actually play.':core?'Popular core suggestions · choose heroes you actually play.':'Popular suggestions · choose heroes you actually play.';

  if(!query&&played.size)hint.textContent='Selected heroes first, then your public match history. Import can suggest heroes in empty lists; review before saving.';

  let choices=Object.values(store.heroes).filter(h=>h.localized_name.toLowerCase().includes(query));

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

 return {values:()=>[...selected],draw,replace(values){
  if(values.length>HERO_LIST_MAX){
   onError(`This list has more than ${HERO_LIST_MAX} heroes. Choose up to ${HERO_LIST_MAX} before copying it to Today.`);
   return false;
  }
  selected.clear();
  for(const id of values)selected.add(id);
  draw();
  return true;
 }};

}

function startProfileSetup(continueAfterSave,joinedTeam=null){
 welcome.board();
 $('app-shell').dataset.profileSetup='true';
 profileDialog(false,joinedTeam,false,0,continueAfterSave);
}

function profileDialog(local=false,joinedTeam=null,continueToCup=false,initialHeroTab=0,continueAfterSave=null){

 if(store.backend&&!store.user&&!demo&&!local){welcome.home('signin');return;}

 const root=$('profile-content');
 root.replaceChildren();
 $('profile-title').textContent=continueAfterSave?'Set up your player profile':'Your profile';
 $('profile-dialog').querySelector('[data-close]').hidden=!!continueAfterSave;
 $('profile-dialog').oncancel=continueAfterSave?event=>event.preventDefault():null;
 $('profile-dialog').querySelector('.profile-footer')?.remove();

 if(continueAfterSave)root.append(el('p','Choose a display name and at least one position to continue. You can add or change heroes anytime.','profile-help'));
 if(joinedTeam||continueToCup)root.append(signupProgress(2));
 if(joinedTeam)root.append(el('p',`You joined ${joinedTeam.name}. Add the roles and heroes you want your team to see, then save your profile.`,'profile-help'));

 if(!store.backend||!store.user||demo)root.append(el('p',demo?'Demo preferences are invented and local.':'Local preference profile · no authentication or sync.','profile-help'));

 root.append(el('p','Build your player card. Choose your roles, then tell your captain what you want to play.','profile-intro'));

 const identity=el('div',null,'profile-identity');
 root.append(identity);

 const name=field(identity,'Display name',store.profile.displayName||''),account=field(identity,'Public account ID or player URL · optional',store.profile.steamAccountId||'');
 const workspace=el('div',null,'profile-workspace'),roleSection=el('section',null,'profile-roles-section'),heroSection=el('section',null,'profile-heroes-section');
 workspace.append(roleSection,heroSection);
 root.append(workspace);

 const presetBar=el('div',null,'profile-role-presets'),roles=el('div',null,'profile-role-grid');

 roleSection.append(el('h3','Where do you play?'),el('p','Select your preferred positions. Open Comfort to adjust your experience.','profile-help'),presetBar,roles);
 const presetHelp=el('p','Presets replace your roles and comfort levels. Undo is available.','profile-help profile-preset-help');
 roleSection.append(presetHelp);

 const roleInputs=[],pickers=[];

 const redrawHeroes=()=>pickers.forEach(picker=>picker.draw());
 const updateComfort=()=>{for(const role of roleInputs){role.summary.textContent='Comfort · '+role.radios.find(r=>r.checked)?.nextElementSibling.textContent;}};
 const clearPreset=()=>{for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed','false');updateComfort();};
 const manualRoles=()=>{clearPreset();redrawHeroes();};

 for(let i=1;i<=5;i++){

  const card=el('div',null,'profile-role-card'),preference=el('label',null,'profile-role-toggle'),c=el('input');

  c.type='checkbox';c.id='profile-role-'+i;c.checked=(store.profile.preferredRoles||[]).includes(i);

  preference.htmlFor=c.id;preference.append(c,el('span','P'+i,'profile-role-number'),el('span',roleNames[i-1],'profile-role-name'));c.onchange=manualRoles;
  const expertise=el('details',null,'profile-role-expertise'),summary=el('summary');expertise.append(summary);

  const comfort=el('fieldset',null,'profile-comfort');comfort.append(el('legend','Comfort for '+roleNames[i-1]));

  const radios=[];

  ['Unset','Learning','Playable','Comfortable','Strong','Signature'].forEach((text,value)=>{

   const label=el('label'),radio=el('input');
   radio.type='radio';
   radio.name='profile-comfort-'+i;
   radio.id='profile-comfort-'+i+'-'+value;
   radio.value=String(value);

   radio.checked=Number(store.profile.roleComfort?.[i]||0)===value;
   radio.onchange=clearPreset;
   label.htmlFor=radio.id;

   label.append(radio,el('span',text));
   comfort.append(label);
   radios.push(radio);

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

 const undoPreset=button('Undo preset',()=>{
  if(!previousRoles)return;
  roleInputs.forEach((role,index)=>{
   role.c.checked=previousRoles[index].checked;
   for(const radio of role.radios)radio.checked=radio.value===previousRoles[index].comfort;
  });
  for(const b of presetBar.querySelectorAll('button'))b.setAttribute('aria-pressed','false');
  undoPreset.hidden=true;
  updateComfort();
  redrawHeroes();
 },presetBar);
 undoPreset.hidden=true;

 const status=el('p',null,'profile-save-status');
 status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');

 function message(text,error=false){status.textContent=text;status.dataset.state=error?'error':'idle';}

 const options=kind=>({kind,getRoles:()=>roleInputs.filter(role=>role.c.checked).map(role=>role.i),getAccountId:()=>String(parseAccountIds(account.value)[0]||''),onError:text=>message(text,!!text)});

 heroSection.append(el('h3','Your hero pool'),el('p','Keep your proven picks separate from what you feel like playing today.','profile-help'));
 const heroTabs=el('div',null,'profile-hero-tabs');
 heroTabs.setAttribute('role','tablist');
 heroTabs.setAttribute('aria-label','Hero preferences');
 heroSection.append(heroTabs);

 const heroSections=el('div');
 heroSection.append(heroSections);

 const signatures=heroPicker(heroSections,'Signature heroes · your proven picks',store.profile.signatureHeroes,options('signature'));

 const desired=heroPicker(heroSections,'Today · heroes you want to play',store.profile.desiredHeroes,options('desired'));

 const todayActions=el('div',null,'profile-today-actions');

 button('Use signatures for today',()=>{if(desired.replace(signatures.values()))message('Today replaced with your signature heroes.');},todayActions);

 button('Clear today',()=>{desired.replace([]);message('Today’s list cleared.');},todayActions);

 heroSections.querySelector('[data-kind=desired]').querySelector('input')?.parentElement.after(todayActions);

 const avoid=heroPicker(heroSections,'Avoid · heroes to leave out',store.profile.avoidHeroes,options('avoid'));

 pickers.push(signatures,desired,avoid);
 const importPanel=el('div',null,'profile-import'),importStatus=el('p','Start here: import your public match history to fill empty Signatures and Today lists. Review the suggestions before saving.','profile-help');
 importStatus.setAttribute('role','status');
 identity.after(importPanel);
 account.placeholder='Dotabuff or OpenDota player link, or Steam ID';
 const importHelp=el('details',null,'profile-import-help');
 importHelp.append(el('summary','Where do I find my player link?'),el('p','Open your player page on Dotabuff or OpenDota and copy its address. You can also paste your numeric Dota account ID or Steam ID. Enable public match data in Dota if your history is private.'));
 identity.after(importHelp);
 if(/^Steam \d+$/.test(name.value))name.parentElement.append(el('small','Use a nickname your teammates will recognize.','profile-help'));
 const importButton=button('Import public stats',async()=>{
  if(importButton.disabled)return;
  const ids=parseAccountIds(account.value);
  if(ids.length!==1){importStatus.textContent='Enter one Dota account ID, Steam ID or player URL first.';account.focus();return;}
  const id=String(ids[0]),gen=store.generation,initialName=name.value;
  importButton.disabled=true;
  save.disabled=true;
  importButton.setAttribute('aria-busy','true');
  importStatus.textContent='Loading public match history…';
  try{
   const player=await loadPlayer(id);
   if(gen!==store.generation||!root.contains(importPanel)||parseAccountIds(account.value).map(String).join()!==id)return;
   observations.set(id,player);
   const suggestions=(player.heroes||[]).filter(h=>Number(h.games)>0&&store.heroes[Number(h.hero_id)]).sort((a,b)=>Number(b.games)-Number(a.games)).slice(0,5).map(h=>Number(h.hero_id));
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
 },importPanel,'primary');
 importPanel.append(importStatus);

 function activateHeroTab(index,focus=false){
  for(const [i,section] of [...heroSections.children].entries())section.hidden=i!==index;
  [...heroTabs.children].forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
  if(focus)heroTabs.children[index].focus();
 }
 for(const [index,label] of ['Signatures','Today','Avoid'].entries()){
  const panel=heroSections.children[index];
  panel.id='profile-hero-panel-'+index;
  panel.setAttribute('role','tabpanel');
  const tab=button(label,()=>activateHeroTab(index),heroTabs);
  tab.id='profile-hero-tab-'+index;
  tab.setAttribute('role','tab');
  tab.setAttribute('aria-controls',panel.id);
  tab.onkeydown=event=>{
   let next;
   if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;
   event.preventDefault();
   activateHeroTab(next,true);
  };
  panel.setAttribute('aria-labelledby',tab.id);
 }
 activateHeroTab(initialHeroTab);

 const extras=el('details',null,'profile-extras');
 extras.append(el('summary','Notes and availability · optional'));
 root.append(extras);

 const notes=field(extras,'Notes · optional',store.profile.notes||'','textarea'),availabilityLabel=el('label','Availability · optional'),availability=el('select');

 availability.id='profile-availability';
 availabilityLabel.htmlFor=availability.id;

 for(const value of ['available','maybe','unavailable'])availability.append(new Option(value,value));
 availability.value=store.profile.availability||'available';
 availabilityLabel.append(availability);
 extras.append(availabilityLabel);

 const footer=el('div',null,'profile-footer'),footerActions=el('div',null,'profile-footer-actions');
 footer.append(status,footerActions);
 $('profile-dialog').append(footer);

 const avatar=el('select');
 avatar.append(new Option('Random signature hero',''));
 for(const hero of Object.values(store.heroes).sort((a,b)=>a.localized_name.localeCompare(b.localized_name))){
  avatar.append(new Option(hero.localized_name,hero.id));
 }
 avatar.value=String(store.profile.avatarHeroId||'');
 const avatarLabel=el('label','Player card portrait');
 avatarLabel.append(avatar);
 extras.append(avatarLabel);

 const save=button('Save profile',async()=>{

  if(save.disabled)return;

  try{

   const ids=parseAccountIds(account.value);

   if(account.value.trim()&&ids.length!==1)throw Error('Enter one valid numeric public account ID or player URL.');

   const p={...(avatar.value||store.profile.avatarHeroId?{avatarHeroId:Number(avatar.value)||null}:{}),displayName:name.value.trim().slice(0,DISPLAY_NAME_MAX)||'Player',steamAccountId:ids[0]?String(ids[0]):'',preferredRoles:roleInputs.filter(r=>r.c.checked).map(r=>r.i),roleComfort:Object.fromEntries(roleInputs.map(r=>[r.i,+(r.radios.find(radio=>radio.checked)?.value||0)])),signatureHeroes:signatures.values(),desiredHeroes:desired.values(),avoidHeroes:avoid.values(),notes:notes.value.slice(0,500),availability:availability.value};

   if(continueAfterSave&&(!name.value.trim()||!p.preferredRoles.length))throw Error('Enter your display name and choose at least one position.');
   const conflicts=p.avoidHeroes.filter(id=>p.signatureHeroes.includes(id)||p.desiredHeroes.includes(id));
   if(conflicts.length){
    activateHeroTab(2);
    heroSections.children[2].querySelector('input')?.focus();
    throw Error('Remove '+conflicts.map(heroName).join(', ')+' from Avoid before saving: also selected in Signatures or Today.');
   }

   save.disabled=true;importButton.disabled=true;save.textContent='Saving…';save.setAttribute('aria-busy','true');message('Saving your profile…');

   const gen=store.generation,saved=store.user&&!demo?await store.backend.saveProfile(p,store.user.id):p;

   if(gen!==store.generation)return;

   store.profile=saved;profileSaved=true;

   if(!$('team-view').hidden){store.homeRoster=store.homeRoster.map(item=>item.userId===store.user?.id?{...item,...store.profile}:item);renderTeamHome();}
   if(!store.shared){
    store.state.roster=[{...store.profile,id:store.user?.id||'local-own'},...store.state.roster.filter(p=>p.id!=='local-own'&&p.id!==store.user?.id)].slice(0,ROSTER_SIZE);
    touch();
   }

   observations.clear();refreshScouting();saveLocal();render();

   if(joinedTeam&&store.team?.id===joinedTeam.id)void loadTeam(store.team.id,{preserveSelection:store.teamRoster.length>0}).catch(()=>{});
   if(continueAfterSave){
    message('Profile saved.');
    profileSetupRequired=false;
    delete $('app-shell').dataset.profileSetup;
    $('profile-dialog').close();
    await continueAfterSave();
    return;
   }
   if((joinedTeam||continueToCup)&&$('profile-dialog').open){$('profile-dialog').close();if(joinedTeam)navigateTeam(joinedTeam.id);else navigateCup();}
   message(store.shared?'Saved. Refresh the shared roster snapshot in Setup to use these changes.':joinedTeam?`Profile saved. ${joinedTeam.name} can now see your preferences.`:'Profile saved.');

  }catch(error){message(error.message||'Unable to save your profile. Try again.',true);}

  finally{save.disabled=false;importButton.disabled=false;save.textContent='Save profile';save.removeAttribute('aria-busy');}

 },footerActions,'primary profile-save');

 if(!continueAfterSave&&(joinedTeam||continueToCup))button(joinedTeam?'Back to team':'Skip to Battle Cup',()=>{
  $('profile-dialog').close();
  if(joinedTeam)navigateTeam(joinedTeam.id);else navigateCup();
 },footerActions);
 if(store.user)button('Sign out',signOut,continueAfterSave?footerActions:extras);

 show('profile-dialog');
 if(store.profile.steamAccountId&&!store.profile.signatureHeroes?.length&&(!profileSaved||!store.profile.preferredRoles?.length))void importButton.click();

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
 profileSaved=false;
 profileSetupRequired=false;
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
   profileSaved=p.status==='fulfilled'&&!!p.value;
   store.profile=(p.status==='fulfilled'&&p.value)||{displayName:providerName(activeUser)||'',steamAccountId:activeUser.user_metadata?.steam_account_id||''};
   profileSetupRequired=p.status==='fulfilled'&&(!p.value||!!activeUser.user_metadata?.steam_account_id&&!p.value.preferredRoles?.length);
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
   if(profileSetupRequired)startProfileSetup(resumeRoute);
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
 getContext:()=>({user:store.user,teams:store.teams,teamId:store.team?.id,backend:store.backend,demo,profileReady:demo||profileSaved,profileHasDraftDetails:demo||!!(store.profile.preferredRoles?.length&&(store.profile.signatureHeroes?.length||store.profile.desiredHeroes?.length)),version:cupAccountVersion}),
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
 heroFilter=control.dataset.heroFilter;
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
