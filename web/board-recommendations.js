// Suggestions panel and the decision card for the staged action.
import {CM_ORDER,diverseTop} from './draft-engine.js';
import {heroStatRows,MIN_GAMES} from './draft-stats.js';
import {TOP_RECOMMENDATIONS} from './constants.js';
import {playerDemo} from './url-state.js';
import {store} from './store.js';
import {$,el,button} from './dom.js';
import {render} from './ui.js';
import {requestedMatchups,matchupErrors,allyCounterFailures,matchupCoverage,roleNames,heroName,portrait,roster,opponents,ranking} from './draft-data.js';
import {refreshScouting} from './scouting.js';
import {mutate} from './draft-sync.js';
import {stage} from './board-heroes.js';

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

export function renderRecommendations(turn,write){
 const root=$('suggestions');
 root.replaceChildren();
 if(!turn){
  store.rankedIds.clear();
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
 store.rankedIds=new Set(ranked.slice(0,TOP_RECOMMENDATIONS).map(r=>r.heroId));
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
  if(store.state.actions.length===before+1){store.freshActionIndex=before;render();store.freshActionIndex=-1;}
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
