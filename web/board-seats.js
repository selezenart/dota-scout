// Seat strip: ally and enemy player cards.
import {parseAccountIds} from './draft-engine.js';
import {comfortRows,enemyBanTarget,allyCounterBans,recentCupGames,heroStatRows,sourceStatus} from './draft-stats.js';
import {renderPlayerRail,SEAT_STATUS} from './war-room.js';
import {ROSTER_SIZE} from './constants.js';
import {demo} from './url-state.js';
import {store} from './store.js';
import {$,notice,safe} from './dom.js';
import {ui,render} from './ui.js';
import {accountOf,canWrite,heroName,portrait,roster,opponents,playerSummary} from './draft-data.js';
import {requestAllyCounters} from './scouting.js';
import {mutate} from './draft-sync.js';
export function seatData(player,side,taken,now){
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
export function renderSeats(){
 const taken=new Set(store.state.actions.map(action=>+action.heroId)),now=Math.floor(Date.now()/1000);
 renderPlayerRail($('player-rail'),{
  allies:roster().slice(0,ROSTER_SIZE).map(player=>seatData(player,'ally',taken,now)),
  enemies:opponents().slice(0,ROSTER_SIZE).map(player=>seatData(player,'enemy',taken,now)),
  focusId:store.focusedPlayer,portrait,heroName,
  onToggle:id=>{store.focusedPlayer=store.focusedPlayer===id?null:id;render();},
  onAddEnemy:safe(ui.lobby),
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
