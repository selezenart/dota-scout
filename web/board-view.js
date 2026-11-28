// Board render entry: status lines and panels, and the roster list.
import {CM_ORDER,nextTurn,normalizeProfile,reviewLineup} from './draft-engine.js';
import {ROSTER_SIZE} from './constants.js';
import {demo,playerDemo} from './url-state.js';
import {store} from './store.js';
import {$,el,button} from './dom.js';
import {ui,render} from './ui.js';
import {stratz,matchupCoverage,canWrite,roleNames,heroName,portrait,roster,opponents} from './draft-data.js';
import {stratzCredit,appendStratzCredit} from './scouting.js';
import {enemyDetails,renderEnemyAssignment,renderDraftEnemies} from './enemy-intel.js';
import {renderSeats} from './board-seats.js';
import {renderDraftTree} from './board-tree.js';
import {renderHeroes} from './board-heroes.js';
import {renderRecommendations} from './board-recommendations.js';
export function renderView(){
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
export function renderRoster(){
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
  button('Edit my profile',()=>ui.profileDialog(),root,'primary');
  button('Invite or import players',ui.lobby,root);
 }
}
