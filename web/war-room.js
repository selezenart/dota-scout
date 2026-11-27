import {HISTORY_WINDOW_DAYS} from './constants.js';
const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const STATE_TEXT={loading:'Loading…',waiting:'Waiting for OpenDota…',closed:'Closed account',error:'Stats unavailable'};

function comfortRow(row,{portrait,heroName,side}){
 const item=make('span','seat-hero tier-'+row.tier),image=portrait(row.heroId),text=make('span','seat-hero-text'),stat=make('span','seat-stat');
 image.alt='';
 const none=!row.games,rate=row.winRate==null?'—':(side==='enemy'&&row.tier==='hot'?'▲ ':'')+row.winRate+'%',games=row.games+' games'+(row.tier==='low'?' · low':'');
 if(none)stat.append(make('b',null,row.unavailable?'Stats unavailable':'No public games'));else stat.append(make('b',null,rate),make('small',null,games));text.append(make('span','seat-hero-name',heroName(row.heroId)),stat);item.append(image,text);
 item.title=none?`${heroName(row.heroId)}: ${row.unavailable?'stats unavailable':`no public games in the last ${HISTORY_WINDOW_DAYS} days`}`:`${heroName(row.heroId)}: ${rate} over ${row.games} games in the last ${HISTORY_WINDOW_DAYS} days`;
 return item;
}

function seatCard(seat,options){
 const {focusId,portrait,heroName,onToggle}=options;
 const card=make('button','seat-card is-'+seat.side);card.type='button';card.dataset.seatId=seat.id;card.setAttribute('aria-pressed',String(focusId===seat.id));card.classList.toggle('is-focused',focusId===seat.id);card.onclick=()=>onToggle(seat.id);
 const head=make('span','seat-head');head.append(make('strong',null,seat.name),make('small',null,seat.position?'Pos '+seat.position:'Pos ?'));card.append(head);
 const status=STATE_TEXT[seat.state];
 if(status)card.append(make('span','seat-state',status));
 if(seat.comfort.length){const list=make('span','seat-comfort');for(const row of seat.comfort)list.append(comfortRow(row,{portrait,heroName,side:seat.side}));card.append(list);}
 card.append(make('span','seat-caption',seat.banLabel),make('span','seat-ban',seat.bans));
 const cup=make('span','seat-cup');
 if(seat.cup.length)for(const game of seat.cup){const item=make('span','seat-game '+(game.won==null?'is-unknown':game.won?'is-win':'is-loss')),image=portrait(game.heroId),result=game.won==null?'?':game.won?'W':'L';image.alt=`${result==='?'?'Unknown result':result==='W'?'Won':'Lost'} on ${heroName(game.heroId)}`;item.append(image,make('span',null,result));cup.append(item);}
 else cup.append(make('small',null,seat.cupEmpty||'No recent cups'));
 card.append(make('span','seat-caption','Last Battle Cup'),cup);
 return card;
}

// Inline "add a teammate by ID" form for an open ally seat. Kept across re-renders (stats loading
// re-draws the rail) so typed text and focus survive.
let allyEntry=null,returnFocusIndex=null;
// Called when the workspace or account changes, so an open form never carries over to another account.
export function resetAllyEntry(){allyEntry=null;returnFocusIndex=null;}
function allyForm(index,onAddAlly){
 const form=make('form','seat-card seat-empty seat-add-ally is-ally'),input=make('input'),actions=make('span','seat-add-actions'),add=make('button',null,'Add'),cancel=make('button',null,'Cancel'),error=make('small','seat-add-error');
 input.type='text';input.setAttribute('aria-label','Player ID or link');input.placeholder='Player ID or link';input.autocomplete='off';input.value=allyEntry.text;input.oninput=()=>{if(allyEntry)allyEntry.text=input.value;};
 if(allyEntry.error)input.setAttribute('aria-invalid','true');
 input.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();cancel.onclick();}};
 add.type='submit';cancel.type='button';error.setAttribute('role','status');error.textContent=allyEntry.error||'';
 cancel.onclick=()=>{allyEntry=null;returnFocusIndex=index;form.dispatchEvent(new CustomEvent('seat-rerender',{bubbles:true}));};
 form.onsubmit=async event=>{event.preventDefault();if(allyEntry.busy)return;allyEntry.busy=true;add.disabled=true;
  try{await onAddAlly(input.value);allyEntry=null;}
  catch(e){if(allyEntry){allyEntry.error=e.message||'Could not add this player.';error.textContent=allyEntry.error;input.setAttribute('aria-invalid','true');input.focus();}}
  finally{if(allyEntry){allyEntry.busy=false;add.disabled=false;}form.dispatchEvent(new CustomEvent('seat-rerender',{bubbles:true}));}};
 actions.append(add,cancel);form.append(input,actions,error);
 // Focus once when the form opens; later re-renders must not pull focus from other controls.
 if(!allyEntry.focused){allyEntry.focused=true;queueMicrotask(()=>{if(form.isConnected)input.focus({preventScroll:true});});}
 return form;
}
function emptySeat(side,onAddEnemy,index,onAddAlly){
 if(side==='ally'&&onAddAlly&&allyEntry?.index===index)return allyForm(index,onAddAlly);
 if(side==='ally'&&onAddAlly){const seat=make('button','seat-card seat-empty is-ally');seat.type='button';seat.dataset.allySeat=String(index);seat.append(make('strong',null,'Open seat'),make('small',null,'Add player by ID'));seat.onclick=()=>{allyEntry={index,text:'',error:''};seat.dispatchEvent(new CustomEvent('seat-rerender',{bubbles:true}));};return seat;}
 if(side==='ally'){const seat=make('div','seat-card seat-empty is-ally');seat.append(make('strong',null,'Open seat'));return seat;}
 const add=make('button','seat-card seat-empty seat-add-enemy is-enemy','Add enemy');add.type='button';add.onclick=onAddEnemy;return add;
}

export function renderPlayerRail(root,options){
 if(!options.onAddAlly)allyEntry=null;
 if(!root.dataset.seatRerender){root.dataset.seatRerender='1';root.addEventListener('seat-rerender',()=>root.__rerender?.());}root.__rerender=()=>renderPlayerRail(root,root.__options);root.__options=options;
 const focused=root.contains(document.activeElement)?document.activeElement.dataset?.seatId:null;
 const focusedOpenSeat=root.contains(document.activeElement)?document.activeElement.dataset?.allySeat:null;
 root.replaceChildren();
 for(const [side,seats] of [['ally',options.allies],['enemy',options.enemies]]){
  const group=make('div','seat-group');group.setAttribute('role','group');group.setAttribute('aria-label',side==='ally'?'Our players':'Enemy players');
  for(let index=0;index<5;index++)group.append(seats[index]?seatCard(seats[index],options):emptySeat(side,options.onAddEnemy,index,options.onAddAlly));
  root.append(group);
 }
 if(focused!=null)[...root.querySelectorAll('[data-seat-id]')].find(node=>node.dataset.seatId===focused)?.focus({preventScroll:true});
 // After Cancel, return focus to the seat the form came from.
 if(focusedOpenSeat!=null&&returnFocusIndex==null)root.querySelector('[data-ally-seat="'+focusedOpenSeat+'"]')?.focus({preventScroll:true});
 if(returnFocusIndex!=null){root.querySelector('[data-ally-seat="'+returnFocusIndex+'"]')?.focus({preventScroll:true});returnFocusIndex=null;}
}
