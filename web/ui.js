// Render loop of the board, plus the late-bound actions table.
// Actions that lower modules call but that live in modules above them (dialogs, routing,
// session). app.js fills this table once at start-up, so imports only ever point down
// and the module graph has no cycles. Lower modules call these only from handlers and
// async work, never while modules are still loading.
export const ui={};
// Renders asked for by background data arrivals run once per frame.
let renderQueued=false;
export function scheduleRender(){
 if(renderQueued)return;renderQueued=true;
 const run=()=>{if(renderQueued)render();};
 if(typeof requestAnimationFrame==='function'&&!document.hidden)requestAnimationFrame(run);else queueMicrotask(run);
}

export function render(){
 renderQueued=false;
 const active=document.activeElement;
 let selector=active?.id?'#'+active.id:active?.dataset.heroId?'[data-hero-id="'+active.dataset.heroId+'"]':active?.name?'[name="'+active.name+'"][value="'+active.value+'"]':active?.classList.contains('primary')&&active.closest('#suggestions')?'#suggestions button.primary':null;
 const value=active?.value;
 ui.renderView();
 if(selector&&!active.isConnected){
  const replacement=document.querySelector(selector);
  if(replacement){
   if(replacement.tagName==='SELECT'&&[...replacement.options].some(o=>o.value===value))replacement.value=value;
   replacement.focus({preventScroll:true});
  }
 }
}
