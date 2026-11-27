// Shared pieces for the JSDOM board tests. Named .js so `node --test tests/*.mjs`
// does not run it as a test file.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

export const markup=await readFile(new URL('../web/index.html',import.meta.url),'utf8');

// web/backend.js stub: tests set window.__backend before the board script runs.
export const BACKEND_STUB='export const createBackend=()=>globalThis.__backend;';

const MATCH_EXPORTS='export const loadMatch=async id=>globalThis.__matches[id];export const parseMatchIds=t=>[...new Set(String(t).split(/[\\s,]+/).filter(Boolean))];export const summarizeMatch=x=>x;';
// web/data.js stub. Each part is the source of that export; the defaults read
// window.__heroes and window.__players. `matches` adds the match-import exports.
export function dataStub({
 publicData='{request:async()=>[]}',
 loadHeroes='async()=>globalThis.__heroes',
 loadPlayer='async(id,progress)=>{const p=globalThis.__players[id];progress(p);return p;}',
 matches=false,extra='',
}={}){
 return `export const publicData=${publicData};export const loadHeroes=${loadHeroes};export const loadPlayer=${loadPlayer};`+(matches?MATCH_EXPORTS:'')+extra;
}

// Let timers at 0 ms and the promise chains behind them run.
export async function flush(immediates=5){
 await new Promise(resolve=>setTimeout(resolve,0));
 for(let i=0;i<immediates;i++)await new Promise(resolve=>setImmediate(resolve));
}
// Several timer/immediate rounds, for boards that chain more async work.
export async function ticks(rounds=12){
 for(let i=0;i<rounds;i++){await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setImmediate(resolve));}
}
// Resolve once predicate() holds after a DOM change; fail after `ms`.
export function observed(w,predicate,label,ms=2000){
 if(predicate())return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{observer.disconnect();reject(Error('Timed out: '+label));},ms);
  const observer=new w.MutationObserver(()=>{if(predicate()){clearTimeout(timer);observer.disconnect();resolve();}});
  observer.observe(w.document,{childList:true,subtree:true,attributes:true,characterData:true});
 });
}

// JSDOM has no modal dialogs; model open/close as the `open` flag.
export function stubDialogs(w){
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
}
const emptyConfig=async()=>({ok:true,json:async()=>({})});
// The browser globals every board test replaces before running the script.
export function prepareWindow(w,{fetch=emptyConfig,confirm=true}={}){
 w.fetch=fetch;w.setInterval=()=>0;
 if(confirm)w.confirm=()=>true;
 stubDialogs(w);
 return w;
}
export function boardWindow(query='?practice'){
 return new JSDOM(markup,{url:'https://board.example/'+query,runScripts:'outside-only'});
}

// Run the compiled board in a fresh window and return small query helpers.
export async function openBoard(code,{query,fetch,confirm,local={},session={},beforeRun,settle=flush}={}){
 const dom=boardWindow(query),w=dom.window;
 prepareWindow(w,{fetch,confirm});
 for(const [key,value] of Object.entries(local))w.localStorage.setItem(key,value);
 for(const [key,value] of Object.entries(session))w.sessionStorage.setItem(key,value);
 await beforeRun?.(w);
 w.eval(code);await settle();
 const q=id=>w.document.getElementById(id);
 const button=(text,root=w.document)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const click=async node=>{assert.ok(node,'control exists');node.click();await flush();};
 return {dom,w,q,button,click};
}
