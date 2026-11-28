// Enemy scouting: Battle Cup match reports, sightings and the who-played-what assignment.
import {CM_ORDER,enemyMatchReport,relevantEnemyMatches,enemySightings} from './draft-engine.js';
import {SEAT_STATUS} from './war-room.js';
// Namespace import keeps optional scouting helpers off the strict named-import list.
import * as matchData from './data.js';
import {createTeamScopedStore} from './team-store.js';
import {HISTORY_WINDOW_DAYS} from './constants.js';
import {demo} from './url-state.js';
import {store} from './store.js';
import {$,el,notice,button} from './dom.js';
import {render} from './ui.js';
import {canWrite,heroName,portrait,opponents,playerSummary} from './draft-data.js';
const SIGHTING_REFRESH_MS=15000;
const LOCAL_MATCH_CAP=200;
const LOCAL_SIGHTING_CAP=2000;

// The two likeliest positions of a scouted player, e.g. 'Pos 1 · Pos 3'.
function likelyPositions(s){return s.positions.slice(0,2).map(r=>'Pos '+r.position).join(' · ');}

// Public OpenDota history for one enemy: what to ban against them.
export function enemyDetails(card,p){
 const s=playerSummary(p,Math.floor(Date.now()/1000));
 const seen=seenAgainstUs(p);if(seen)card.append(el('p',seen,'enemy-seen'));
 if(s.state!=='ready'){
  card.append(el('p',{loading:'Loading public stats…',waiting:'Waiting for OpenDota…',closed:'Closed account — no public match history.',error:'Public stats unavailable (OpenDota error).'}[s.state],'enemy-status'));
  return;
 }
 card.append(el('p',s.positions.length?'Likely '+likelyPositions(s):'Position unknown','player-role-summary'));
 const strip=(title,cls,rows,label,empty)=>{
  card.append(el('h4',title));const root=el('div',null,'roster-hero-strip '+cls);
  for(const h of rows){const item=el('div');item.append(portrait(h.heroId),el('small',heroName(h.heroId)),el('small',label(h)));root.append(item);}
  if(!rows.length)root.append(el('span',empty,'secondary'));card.append(root);
 };
 strip('Most played · '+HISTORY_WINDOW_DAYS+' days','enemy-top-heroes',s.topHeroes,h=>h.winRate==null?`${h.games} games`:`${h.games} games · ${h.winRate}%`,'No hero data');
 const total=s.recent.wins+s.recent.losses;
 card.append(el('h4','Recent'),el('p',total?`${s.recent.wins}W ${s.recent.losses}L (last ${total})`:'No recent matches','enemy-recent'));
 strip('Battle Cup','enemy-cup',s.cup,h=>`${h.games} games · ${h.wins}W`,'No Battle Cup games found');
}
// Earlier Battle Cup matches pasted to scout the enemy team. Shared through the team
// database inside a team draft; stored on this device otherwise or until the owner
// applies migration 010.
const matchStore=createTeamScopedStore({key:'captain-enemy-matches-v1',cap:LOCAL_MATCH_CAP,newestFirst:true,method:'listEnemyMatches',context:()=>({backend:store.backend,shared:store.shared,user:store.user}),
 mapRow:r=>({matchId:String(r.match_id),enemySide:r.enemy_side,contextIds:r.context_enemy_ids||[],summary:r.summary,addedAt:Date.parse(r.added_at)}),onChange:()=>render(),
 onMissing:()=>notice('Team match storage is not set up yet. Battle Cup matches are kept on this device.'),
 onLoadError:error=>notice('Could not load team Battle Cup matches: '+(error.message||'try again later.'))});
export async function addEnemyMatches(text){
 const ids=matchData.parseMatchIds(text);
 if(!ids.length)throw Error('Enter match IDs or match links.');
 if(ids.length>10)throw Error('Load at most 10 matches at a time.');
 matchStore.sync();
 if(matchStore.state==='loading')throw Error('Team matches are still loading. Try again in a moment.');
 // A failed team load is retried on the next attempt instead of needing a reload.
 if(matchStore.state==='failed'){matchStore.scope=null;matchStore.sync();throw Error('Team matches could not be loaded. Retrying now; try again in a moment.');}
 const teamId=matchStore.remote?matchStore.team():null,scope=matchStore.scope,contextIds=(store.state.enemyIds||[]).map(String),failed=[],unsaved=[];
 for(const id of ids){
  let summary;
  try{summary=await matchData.loadMatch(id);}catch{}
  if(scope!==matchStore.scope)return false;
  if(!Array.isArray(summary?.players)||!summary.players.length){failed.push(id);continue;}
  const row={matchId:id,summary,enemySide:matchStore.rows.find(r=>r.matchId===id)?.enemySide||null,contextIds,addedAt:Date.now()};
  if(teamId){try{await store.backend.saveEnemyMatch(teamId,id,summary,row.enemySide,contextIds);}catch{unsaved.push(id);continue;}}
  if(scope!==matchStore.scope)return false;
  matchStore.rows=[row,...matchStore.rows.filter(r=>r.matchId!==id)];
 }
 if(!teamId)matchStore.writeLocal();
 render();
 const problems=[];
 if(failed.length)problems.push('Could not load match '+failed.join(', ')+'. Check the ID, or try again if OpenDota is busy.');
 if(unsaved.length)problems.push('Could not save match '+unsaved.join(', ')+' to the team. Check your team access and try again.');
 if(problems.length)throw Error(problems.join(' '));
 return true;
}
async function setEnemyMatchSide(matchId,side){
 const teamId=matchStore.remote?matchStore.team():null,scope=matchStore.scope;
 if(teamId)await store.backend.setEnemyMatchSide(teamId,matchId,side);
 if(scope!==matchStore.scope)return;
 matchStore.rows=matchStore.rows.map(r=>r.matchId===matchId?{...r,enemySide:side}:r);if(!teamId)matchStore.writeLocal();render();
}
function renderEnemyMatches(section){
 section.querySelector('.draft-enemy-matches')?.remove();
 const rows=relevantEnemyMatches(matchStore.rows,store.state.enemyIds||[],Date.now());if(!rows.length)return false;
 const r=enemyMatchReport(rows,store.state.enemyIds||[]),root=el('div',null,'draft-enemy-matches');
 const resolved=r.matches.filter(m=>m.side),wins=resolved.filter(m=>m.won).length;
 root.append(el('h4','Their Battle Cup matches'),el('p',`${rows.length} match${rows.length===1?'':'es'} · ${wins}W ${resolved.filter(m=>m.won===false).length}L${r.anonymous?` · ${r.anonymous} anonymous picks`:''}`,'draft-enemy-match-summary'));
 const list=(cls,items,label)=>{
  if(!items.length)return;
  const box=el('div',null,'draft-enemy-match-list');
  for(const h of items.slice(0,8))box.append(el('span',label(h),cls));
  root.append(box);
 };
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
  const sides=el('details',null,'draft-enemy-match-sides');
  sides.append(el('summary',`Enemy side in ${resolvedSides.length} match${resolvedSides.length===1?'':'es'}`));
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
const sightingStore=createTeamScopedStore({key:'captain-enemy-sightings-v1',cap:LOCAL_SIGHTING_CAP,newestFirst:false,method:'listEnemySightings',context:()=>({backend:store.backend,shared:store.shared,user:store.user}),
 mapRow:r=>({accountId:String(r.account_id),heroId:+r.hero_id,enemyWon:r.enemy_won??null,sourceKey:r.source_key,seenAt:Date.parse(r.seen_at)}),onChange:()=>render(),
 onLoadError:error=>notice('Could not load the team scouting list: '+(error.message||'try again later.'))});
let assignment={key:null,map:{},result:''};
// Called from the draft poll so idle teammates also see a newly saved assignment.
export function refreshSightings(){
 const teamId=sightingStore.team();
 if(teamId&&sightingStore.remote&&sightingStore.state==='ready'&&store.state.actions.length>=CM_ORDER.length&&Date.now()-sightingStore.loadedAt>SIGHTING_REFRESH_MS){
  sightingStore.loadedAt=Date.now();
  sightingStore.reload(teamId);
 }
}
// One key per game. Reset keeps the draft id, so the key also uses the opening bans
// and the enemy accounts; a later Undo and re-pick stays the same game.
function draftFingerprint(){
 let h=0x811c9dc5;
 const text=store.state.actions.slice(0,4).map(a=>a.mode[0]+a.heroId).join(',')+'|'+[...(store.state.enemyIds||[])].map(String).sort().join(',');
 for(const ch of text){h^=ch.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}
 return h.toString(16).padStart(8,'0');
}
const sightingDraftBase=()=>store.shared?.id?'draft:'+store.shared.id:'draft:practice';
const sightingGameKey=()=>sightingDraftBase()+':'+draftFingerprint();
// Key last saved per draft in this session, so a corrected enemy list or opening replaces it.
const lastSightingKey=new Map();
async function saveSightings(entries){
 if(new Set(entries.map(e=>e.accountId)).size!==entries.length)throw Error('Assign each enemy account only once.');
 if(store.shared&&!canWrite())throw Error('Only the current drafter can save who played what.');
 sightingStore.sync();
 if(sightingStore.state==='loading')throw Error('The team scouting list is still loading. Try again in a moment.');
 if(sightingStore.state==='failed'){
  sightingStore.scope=null;
  sightingStore.sync();
  throw Error('The team scouting list could not be loaded. Retrying now; try again in a moment.');
 }
 const teamId=sightingStore.remote?sightingStore.team():null,scope=sightingStore.scope,key=sightingGameKey(),slot=scope+'|'+sightingDraftBase();
 const previous=lastSightingKey.get(slot)!==key?lastSightingKey.get(slot):null;
 if(teamId)await store.backend.recordEnemySightings(teamId,key,entries,'manual');
 if(scope!==sightingStore.scope)return false;
 let staleKept=false;
 if(teamId&&previous)try{await store.backend.recordEnemySightings(teamId,previous,[],'manual');}catch{staleKept=true;}
 if(scope!==sightingStore.scope)return false;
 // Remembered only once the earlier version is gone, so saving again retries the cleanup.
 if(!staleKept)lastSightingKey.set(slot,key);
 // A list request started before this save must not drop the new rows.
 if(teamId)++sightingStore.load;
 sightingStore.rows=[...sightingStore.rows.filter(r=>r.sourceKey!==key&&r.sourceKey!==previous),...entries.map(e=>({...e,sourceKey:key,seenAt:Date.now()}))];
 // Invented demo opponents never reach the real list.
 if(!teamId&&!demo)sightingStore.writeLocal();render();
 if(staleKept)notice('Saved. The earlier version of this game could not be removed; save again to retry.');
 return true;
}
function seenAgainstUs(p){
 const seen=enemySightings(sightingStore.rows,String(p.id));
 return seen.length?'Seen vs us: '+seen.slice(0,4).map(h=>`${heroName(h.heroId)} ×${h.games}${h.wins?` (${h.wins}W)`:''}`).join(', '):'';
}
export function renderEnemyAssignment(root){
 const picks=store.state.actions.filter(a=>a.mode==='enemyPick'),enemies=opponents();
 if(!picks.length||!enemies.length)return;
 sightingStore.sync();
 const key=sightingStore.scope+'|'+sightingGameKey(),readOnly=!!store.shared&&!canWrite();
 // Teammates outside the drafter seat always see the saved assignment (refreshed by the poll);
 // the drafter's unsaved edits survive a failed poll or a pending action.
 const viewer=!!store.shared&&store.shared.drafter_user_id!==store.user?.id;
 if(assignment.key!==key||viewer){
  const saved=sightingStore.rows.filter(r=>r.sourceKey===sightingGameKey());
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
 const resultLabel=el('label',null,'enemy-assignment-row'),result=el('select');
 result.setAttribute('aria-label','Our result');
 for(const [value,label] of [['','Result unknown'],['won','We won'],['lost','We lost']])result.append(new Option(label,value));
 result.value=assignment.result;
 result.disabled=readOnly;
 result.onchange=()=>{assignment.result=result.value;};
 resultLabel.append(el('span','Our result'),result);
 box.append(resultLabel);
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
export function renderDraftEnemies(){
 const section=$('draft-enemy-scouting'),list=$('draft-enemy-list');
 if(!section||!list)return;
 matchStore.sync();
 sightingStore.sync();
 // An empty draft is a Reset or a new game: later saves must not replace the earlier game.
 // While someone else holds the drafter seat this tab may miss their Reset, so forget too.
 if(!store.state.actions.length||store.shared&&store.shared.drafter_user_id!==store.user?.id)lastSightingKey.delete(sightingStore.scope+'|'+sightingDraftBase());
 const enemies=opponents();
 list.replaceChildren();
 section.classList.toggle('is-detail-open',enemies.some(p=>String(p.id)===store.focusedPlayer));
 const hasReport=renderEnemyMatches(section);
 section.classList.toggle('has-match-report',hasReport);
 section.hidden=!hasReport&&!enemies.length;
 const now=Math.floor(Date.now()/1000);
 for(const p of enemies){
  const s=playerSummary(p,now),row=el('div',null,'draft-enemy');
  row.dataset.playerId=String(p.id);
  row.classList.toggle('is-focused',String(p.id)===store.focusedPlayer);
  const meta=SEAT_STATUS[s.state]||(s.positions.length?likelyPositions(s):'Position unknown');
  row.append(el('strong',p.name,'draft-enemy-name'),el('span',meta,'draft-enemy-meta'));
  if(s.state==='ready'){
   const heroesRow=el('div',null,'draft-enemy-heroes');
   for(const h of s.topHeroes.slice(0,3)){
    const item=el('span',null,'draft-enemy-hero'),img=portrait(h.heroId);
    img.alt='';
    item.append(img,el('small',`${heroName(h.heroId)} ${h.winRate==null?h.games+' games':`${h.winRate}% · ${h.games}`}`));
    heroesRow.append(item);
   }
   row.append(heroesRow);
   if(s.cup.length)row.append(el('p','Battle Cup: '+s.cup.slice(0,3).map(h=>heroName(h.heroId)).join(', '),'draft-enemy-cup'));
  }
  const seen=seenAgainstUs(p);
  if(seen)row.append(el('p',seen,'draft-enemy-seen'));
  list.append(row);
 }
}
