// Replay controls of the ?demo&player walkthrough.
import {CM_ORDER,nextTurn} from './draft-engine.js';
import {demoState,reduceDraft} from './demo.js';
import {playerDemo} from './url-state.js';
import {store} from './store.js';
import {el,button} from './dom.js';
import {render} from './ui.js';
import {heroName} from './draft-data.js';
const playerDemoHeroes=[1,13,2,26,5,44,29,8,74,11,12,14,23,86,30,25,34,28,36,37,38,39,55,60];

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
