// Draft order: every Captain's Mode pick and ban turn.
import {CM_ORDER,CM_PHASE_STARTS} from './draft-engine.js';
import {store} from './store.js';
import {$,el,focusDraftView} from './dom.js';
import {heroName,portrait} from './draft-data.js';
export function renderDraftTree(){
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
  slot.classList.toggle('is-fresh',index===store.freshActionIndex&&!!recorded);
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
