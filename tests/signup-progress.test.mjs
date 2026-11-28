import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {signupProgress} from '../web/signup-progress.js';

function withDocument(t){
 const dom=new JSDOM(''),saved=globalThis.document;
 globalThis.document=dom.window.document;
 t.after(()=>{globalThis.document=saved;dom.window.close();});
}
const steps=list=>[...list.children].map(item=>({
 text:item.textContent,
 number:item.querySelector('[aria-hidden]').textContent,
 complete:'complete' in item.dataset,
 current:item.getAttribute('aria-current'),
}));

test('signup progress marks finished steps, the current step and the remaining ones',t=>{
 withDocument(t);
 const list=signupProgress(2);
 assert.equal(list.tagName,'OL');
 assert.equal(list.getAttribute('aria-label'),'Battle Cup registration progress');
 assert.deepEqual(steps(list),[
  {text:'✓Sign in or register completed',number:'✓',complete:true,current:null},
  {text:'✓Join your team completed',number:'✓',complete:true,current:null},
  {text:'3Set up your profile',number:'3',complete:false,current:'step'},
  {text:'4Reserve a Battle Cup spot',number:'4',complete:false,current:null},
 ]);
 assert.equal(list.querySelectorAll('.sr-only').length,2,'screen readers hear which steps are done');
 assert.ok(steps(signupProgress(3,true)).every(step=>step.complete&&step.current===null),'a complete signup has no current step');
});

test('signup progress steps with actions become labelled buttons',t=>{
 withDocument(t);
 const clicked=[];
 const list=signupProgress(1,false,{0:()=>clicked.push('account'),1:()=>clicked.push('team'),3:'not a function'});
 const buttons=[...list.querySelectorAll('button')];
 assert.deepEqual(buttons.map(b=>b.getAttribute('aria-label')),['Sign in or register · completed','Join your team · current step']);
 assert.ok(buttons.every(b=>b.type==='button'),'buttons never submit a surrounding form');
 buttons[1].click();buttons[0].click();
 assert.deepEqual(clicked,['team','account']);
 assert.equal(list.children[3].querySelector('button'),null,'a non-function action stays plain text');
});

test('an optional team step is never shown as completed',t=>{
 withDocument(t);
 for(const list of [signupProgress(2,false,{},true),signupProgress(3,true,{},true)]){
  const team=steps(list)[1];
  assert.equal(team.text,'＋Team · optional');
  assert.equal(team.complete,false);
  assert.equal(team.current,null);
 }
 const current=signupProgress(1,false,{1:()=>{}},true);
 assert.equal(current.children[1].getAttribute('aria-current'),'step');
 assert.equal(current.querySelector('button').getAttribute('aria-label'),'Team · optional · current step');
});
