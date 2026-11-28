// DOM helpers shared by every view: lookup, element builders, notices and error-safe handlers.

export const $=id=>document.getElementById(id);

export const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};

export const notice=text=>{
 const dialog=document.querySelector('dialog[open]');
 let target=dialog?.querySelector('[data-dialog-notice]');
 if(dialog&&!target){target=el('p',null,'session-feedback');target.dataset.dialogNotice='';target.setAttribute('role','status');dialog.append(target);}
 (target||$('notice')).textContent=text;
 if(dialog?.id==='session-dialog'){$('session-input').setAttribute('aria-describedby',target.id||(target.id='session-notice'));}
};

export const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>notice(e.message||'Operation failed'));

export function button(text,fn,parent,cls){const b=el('button',text,cls);b.type='button';b.onclick=safe(fn);parent?.append(b);return b;}

export function field(parent,label,value='',type='text'){
 const l=el('label',label),i=el(type==='textarea'?'textarea':'input');
 if(type!=='textarea')i.type=type;
 i.value=value;
 l.append(i);
 parent.append(l);
 return i;
}
export function focusDraftView(){ $('draft-button').click();$('surface-heroes').checked=true;$('hero-search').focus(); }

export function show(id){$(id).showModal();}
export function showIfClosed(id){if(!$(id).open)show(id);}
