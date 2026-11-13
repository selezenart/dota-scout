import {nextTurn} from './draft-engine.js';
export function initialState(){return {actions:[],firstPick:true,roster:[],opponents:[],assignments:{}};}
export function reduceDraft(state,operation,payload={},context={}){
 if(!context.canWrite)throw Error('Confirmed drafter control required');
 const actions=state.actions||[];
 if(operation==='append'){
  const turn=nextTurn(actions,state.firstPick);if(!turn)throw Error('Draft is complete');
  const a=payload.action||payload;if(!context.heroes?.[a.heroId]||actions.some(x=>+x.heroId===+a.heroId)||a.mode!==turn.mode)throw Error('Invalid or already taken hero');
  if(a.playerId!=null||a.position!=null){if(turn.mode!=='ourPick')throw Error('Only explicit allied assignments supported');if(a.playerId!=null&&!state.roster.some(p=>String(p.id)===String(a.playerId)))throw Error('Unknown roster player');if(a.position!=null&&![1,2,3,4,5].includes(+a.position))throw Error('Invalid role');if(actions.some(x=>x.mode==='ourPick'&&((a.playerId!=null&&String(x.playerId)===String(a.playerId))||(a.position!=null&&+x.position===+a.position))))throw Error('Player or role already assigned');}
  return {...state,actions:[...actions,{...a}]};
 }
 if(operation==='undo')return {...state,actions:actions.slice(0,-1)};
 if(operation==='reset')return {...state,actions:[]};
 if(operation==='set_first_pick'){if(actions.length)throw Error('Reset the draft before changing first pick');return {...state,firstPick:!!payload.firstPick};}
 if(operation==='set_roster')return {...state,roster:payload.roster.slice(0,5)};
 if(operation==='set_opponents')return {...state,opponents:payload.opponents.slice(0,5)};
 throw Error('Unsupported operation');
}
export function demoState(){const s=initialState();s.roster=Array.from({length:5},(_,i)=>({id:'demo-'+i,name:['Alex','Sam','Lee','Jo','Max'][i],selfReport:{preferredRoles:[i+1],signatureHeroes:[[1,8],[13,74],[2,29],[26,86],[5,30]][i],desiredHeroes:[[8],[74],[29],[86],[30]][i],avoidHeroes:[],availability:'available'}}));s.opponents=Array.from({length:5},(_,i)=>({id:'invented-'+i,name:'Invented opponent '+(i+1),heroes:[{hero_id:[1,13,2,26,5][i],games:40}],recent:[{match_id:i,hero_id:[1,13,2,26,5][i],start_time:Math.floor(Date.now()/1000)-3600,lobby_type:9}]}));return s;}
