import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import * as engine2 from '../web/draft-engine.js';
import {buildBoard} from './build-board.js';

const built=await buildBoard({logLevel:'silent',plugins:[{name:'reasons-boundaries',enforce:'pre',load(id){
 const p=id.replaceAll('\\','/');
 if(p.endsWith('/web/backend.js'))return 'export const createBackend=()=>globalThis.__backend;';
 if(p.endsWith('/web/data.js'))return 'export const publicData={request:async()=>[]};export const loadHeroes=async()=>globalThis.__heroes;export const loadPlayer=async id=>({id:String(id),name:String(id),sources:{},heroes:[],recent:[],matches:[]});export const loadStratz=async id=>globalThis.__stratz[id];';
}}],build:{write:false,minify:false}});
const boardCode=built.output.find(o=>o.type==='chunk'&&o.isEntry).code,boardMarkup=await readFile('web/index.html','utf8');
const settle=async()=>{for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,0));await new Promise(r=>setImmediate(r));}};
const cssText=async f=>(await readFile(f,'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
const rules=css=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({sel:m[1].trim(),body:m[2]}));

test('css: no stylesheet hides the suggestion reason (.rec-summary small)',async()=>{
 for(const f of ['web/war-room.css','web/styles.css']){
  const bad=rules(await cssText(f)).filter(r=>/\.rec-summary\s*>?\s*small/.test(r.sel)&&/display\s*:\s*none/.test(r.body));
  assert.deepEqual(bad.map(r=>r.sel),[],f+' hides the reason');
 }
});

test('css: compact best-now layouts show the reason clamped to two lines in the muted colour',async()=>{
 const found=rules(await cssText('web/war-room.css')).filter(r=>/#draft-view \.best-now \.rec-summary>small/.test(r.sel));
 assert.ok(found.length>=2,'both compact layouts style the reason');
 for(const r of found){
  assert.match(r.body,/-webkit-line-clamp\s*:\s*2/);
  assert.match(r.body,/white-space\s*:\s*normal/);
  assert.match(r.body,/color\s*:\s*var\(--muted\)/);
 }
});

async function stratzBoard(){
 const n=engine2.CM_ORDER.findIndex((t,i)=>i>8&&t.team==='A'&&t.action==='Pick');
 let our=0,en=0,ban=20;const actions=engine2.CM_ORDER.slice(0,n).map(({team,action})=>{const side=team==='A'?'our':'enemy';return {mode:side+action,heroId:action==='Pick'?(side==='our'?[1,4][our++]:[2,3][en++]):ban++};});
 const w=new JSDOM(boardMarkup,{url:'https://board.example/?practice',runScripts:'outside-only'}).window;
 w.fetch=async()=>({ok:true,json:async()=>({})});w.setInterval=()=>0;w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.localStorage.setItem('captain-practice-v1',JSON.stringify({state:{actions,firstPick:true,enemyIds:[]},profile:{}}));
 w.__heroes=JSON.parse(await readFile('web/heroes.json','utf8'));
 const strong={h:5,m:400,w:0.35,s:-9};w.__stratz={2:{heroId:2,vs:[strong],with:[]},3:{heroId:3,vs:[{...strong}],with:[]},1:{heroId:1,vs:[],with:[]},4:{heroId:4,vs:[],with:[]}};
 w.eval(boardCode);await settle();return w;
}

test('board: every suggestion row carries a non-empty reason that matches its tooltip',async()=>{
 const w=await stratzBoard();
 try{
  const rows=[...w.document.querySelectorAll('.decision-candidates .rec-row')];
  assert.ok(rows.length>0,'rows rendered');
  for(const row of rows){
   const reason=row.querySelector('.rec-summary > small');
   assert.ok(reason,'row has a reason');assert.ok(reason.textContent.trim().length>0,'reason not empty');
   const lines=row.title.split('\n');
   assert.ok(lines.length>=1&&row.title.length>0,'row has a tooltip');
   assert.equal(lines[0],reason.textContent,'tooltip starts with the visible reason');
  }
  assert.match(rows[0].querySelector('.rec-summary > small').textContent,/^Counters /,'top STRATZ-backed row explains the counter');
 }finally{w.close();}
});
