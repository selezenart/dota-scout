// Hero pool: search, filters, tiles and staging a hero.
import {nextTurn} from './draft-engine.js';
import {tileMark,heroStatRows,MIN_GAMES,WARN_RATE} from './draft-stats.js';
import {ROSTER_SIZE,TOP_RECOMMENDATIONS} from './constants.js';
import {store} from './store.js';
import {$,el,button} from './dom.js';
import {render} from './ui.js';
import {portrait,derived,roster,opponents,ranking} from './draft-data.js';
import {seatData} from './board-seats.js';

export function stage(id,rec){
 store.selected={id,...rec};
 render();
 const confirm=$('suggestions').querySelector('button.primary');
 if(!confirm||confirm.disabled)return;
 confirm.focus({preventScroll:true});
 const bounds=confirm.getBoundingClientRect();
 if(bounds.top<0||bounds.bottom>window.innerHeight)confirm.scrollIntoView?.({block:'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
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
export function renderHeroes(){
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
  const attributeFilter=store.heroFilter==='all-attr'?'all':store.heroFilter;
  const visibleGroup=store.heroFilter==='all'||store.heroFilter==='recommended'||attributeFilter===attribute;
  if(!visibleGroup)continue;
  const list=Object.values(store.heroes).filter(hero=>hero.primary_attr===attribute&&(store.heroFilter!=='recommended'||(!takenBy.has(+hero.id)&&store.rankedIds.has(+hero.id)&&matches(hero))));
  matched+=list.filter(matches).length;
  list.sort((a,b)=>a.localized_name.localeCompare(b.localized_name));
  if(!list.length)continue;
  const section=el('section',null,'hero-group'),grid=el('div',null,'hero-grid'),heading=el('div',null,'attribute-heading');
  section.dataset.attribute=attribute;
  const mark=el('span',null,'attribute-mark');mark.setAttribute('aria-hidden','true');
  heading.append(mark,el('h3',label),el('span',String(list.length),'attribute-count'));section.append(heading,grid);
  for(const hero of list){
   const tile=button('',()=>stage(+hero.id),grid,'hero-tile');tile.dataset.heroId=hero.id;
   tile.classList.toggle('is-wanted',wanted.has(+hero.id));tile.classList.toggle('is-recommended',store.rankedIds.has(+hero.id));
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
export function searchHeroes(){
 store.searchIndex=0;
 const tiles=[...$('hero-groups').querySelectorAll('.hero-tile')],query=$('hero-search').value.toLowerCase();
 const misses=tiles.map(tile=>!!query&&!String(store.heroes[tile.dataset.heroId]?.localized_name||'').toLowerCase().includes(query));
 if(store.heroFilter==='recommended'||!tiles.length||misses.every(Boolean)){renderHeroes();return;}
 tiles.forEach((tile,i)=>tile.classList.toggle('is-search-miss',misses[i]));
 highlightSearch();
}
export function heroChoices(){return [...$('hero-groups').querySelectorAll('.hero-tile:not(:disabled):not(.is-search-miss)')];}
export function highlightSearch(){
 const all=[...$('hero-groups').querySelectorAll('.hero-tile')],tiles=heroChoices();
 store.searchIndex=Math.max(0,Math.min(store.searchIndex,tiles.length-1));
 all.forEach(b=>{b.classList.remove('is-highlighted');b.id='hero-result-'+b.dataset.heroId;});
 tiles[store.searchIndex]?.classList.add('is-highlighted');
 const search=$('hero-search');
 if(tiles[store.searchIndex])search.setAttribute('aria-activedescendant',tiles[store.searchIndex].id);else search.removeAttribute('aria-activedescendant');
}
