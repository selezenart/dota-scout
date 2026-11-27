import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {showIdentityDownload,mountTeamIdentity} from '../web/team-identity.js';
import {flush} from './board-harness.js';

// The module reads browser globals at call time; lend it a JSDOM window per test.
function page(){
 const dom=new JSDOM('<main></main>',{url:'https://board.example/'}),w=dom.window;
 const saved={document:globalThis.document,window:globalThis.window,Option:globalThis.Option};
 Object.assign(globalThis,{document:w.document,window:w,Option:w.Option});
 return {w,root:w.document.querySelector('main'),done(){Object.assign(globalThis,saved);dom.window.close();}};
}
const png=Buffer.from([0x89,0x50,0x4e,0x47,1,2,3]).toString('base64');

test('team image download decodes the image and names the file by its type',async t=>{
 const p=page();t.after(p.done);
 const blobs=[],revoked=[];
 t.mock.method(URL,'createObjectURL',blob=>{blobs.push(blob);return 'blob:https://board.example/image-'+blobs.length;});
 t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 let finish;
 const pending=showIdentityDownload(p.root,{getTeamIdentityImage:id=>{assert.equal(id,'image-1');return new Promise(resolve=>{finish=resolve;});}},'image-1');
 assert.match(p.root.textContent,/Loading image…/);
 finish({mime:'image/png',data:png});await pending;
 const link=p.root.querySelector('a.image-download-link'),preview=p.root.querySelector('img');
 assert.equal(link.download,'team-image.png');
 assert.equal(link.getAttribute('href'),'blob:https://board.example/image-1');
 assert.equal(preview.getAttribute('src'),'blob:https://board.example/image-1');
 assert.equal(blobs[0].type,'image/png');
 assert.deepEqual([...new Uint8Array(await blobs[0].arrayBuffer())],[0x89,0x50,0x4e,0x47,1,2,3]);
 assert.equal(p.root.querySelector('a.image-home').getAttribute('href'),'/');
 p.w.dispatchEvent(Object.assign(new p.w.Event('pagehide'),{persisted:true}));
 assert.deepEqual(revoked,[],'a page kept in the back-forward cache keeps its image');
 p.w.dispatchEvent(Object.assign(new p.w.Event('pagehide'),{persisted:false}));
 assert.deepEqual(revoked,['blob:https://board.example/image-1']);

 await showIdentityDownload(p.root,{getTeamIdentityImage:async()=>({mime:'image/jpeg',data:png})},'image-2');
 assert.equal(p.root.querySelector('a.image-download-link').download,'team-image.jpg');
});

test('team image download refuses unknown types, missing images and backend failures',async t=>{
 const p=page();t.after(p.done);
 const created=t.mock.method(URL,'createObjectURL',()=>'blob:unused');
 for(const backend of [
  {getTeamIdentityImage:async()=>({mime:'image/svg+xml',data:btoa('<svg onload="alert(1)"/>')})},
  {getTeamIdentityImage:async()=>({mime:'toString',data:png})},
  {getTeamIdentityImage:async()=>null},
  {getTeamIdentityImage:async()=>{throw Error('denied');}},
  {getTeamIdentityImage:async()=>({mime:'image/png',data:'%%% not base64'})},
 ]){
  await showIdentityDownload(p.root,backend,'image-1');
  assert.match(p.root.textContent,/This image is unavailable\./);
  assert.equal(p.root.querySelector('img,a.image-download-link'),null);
 }
 assert.equal(created.mock.callCount(),0,'no object URL for a refused image');
});

const team={id:'team',name:'Night Shift',owner_user_id:'captain'};
function backendFor(rows=[]){
 const calls=[];
 return {calls,
  listTeamIdentity:async teamId=>{calls.push(['list',teamId]);return rows;},
  suggestTeamIdentity:async(...args)=>{calls.push(['suggest',...args]);},
  setTeamIdentity:async(...args)=>{calls.push(['set',...args]);},
  getTeamIdentityImage:async()=>({mime:'image/png',data:png}),
 };
}

test('team identity proposals render only for a signed-in team member, and only captains get the editor',async t=>{
 const p=page();t.after(p.done);
 const backend=backendFor([{id:'p1',proposed_name:'Moonlit Five'},{id:'p2',proposed_name:'',image_mime:'image/png'}]);
 let context={user:null,teams:[team],backend};
 const identity=mountTeamIdentity(p.root,()=>context);
 identity.open();assert.equal(p.root.children.length,0,'signed out sees nothing');
 context={user:{id:'member'},teams:[],backend};identity.open();assert.equal(p.root.children.length,0,'no team, nothing to propose for');
 context={user:{id:'member'},teams:[team],backend};identity.open();await flush();
 assert.match(p.root.textContent,/Moonlit Five/);assert.match(p.root.textContent,/Image proposal/);
 assert.equal(p.root.querySelector('a[href="/?team-image=p2"]')?.textContent,'Open and download image');
 assert.doesNotMatch(p.root.textContent,/Edit team identity/);
 context={user:{id:'captain'},teams:[team],backend};identity.open();await flush();
 assert.match(p.root.textContent,/Edit team identity/);
 assert.deepEqual([...p.root.querySelectorAll('select option')].map(o=>o.value),['','p2'],'only image proposals can become the emblem');
});

test('team identity proposals validate the image before submitting',async t=>{
 const p=page();t.after(p.done);
 const backend=backendFor();
 const identity=mountTeamIdentity(p.root,()=>({user:{id:'member'},teams:[team],backend}));
 identity.open();await flush();
 const form=p.root.querySelector('.team-branding-panel form'),status=p.root.querySelector('[role=status]');
 const [name,file]=form.querySelectorAll('input');
 const submit=async()=>{form.dispatchEvent(new p.w.Event('submit',{cancelable:true}));await flush();};
 const choose=image=>Object.defineProperty(file,'files',{value:image?[image]:[],configurable:true});
 choose(null);await submit();assert.equal(status.textContent,'Enter a name or choose an image.');
 choose({type:'image/svg+xml',size:10,arrayBuffer:async()=>new ArrayBuffer(1)});await submit();
 assert.equal(status.textContent,'Choose a PNG, JPG or WebP file up to 512 KB.');
 choose({type:'image/png',size:524289,arrayBuffer:async()=>new ArrayBuffer(1)});await submit();
 assert.equal(status.textContent,'Choose a PNG, JPG or WebP file up to 512 KB.');
 assert.equal(backend.calls.filter(c=>c[0]==='suggest').length,0,'invalid images never reach the backend');
 choose({type:'image/png',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});name.value=' Night Owls ';await submit();
 assert.deepEqual(backend.calls.find(c=>c[0]==='suggest'),['suggest','team','Night Owls','image/png',btoa('\x01\x02\x03'),'member']);
 assert.equal(status.textContent,'Proposal submitted.');
});

test('team identity proposals that arrive after the account changes are not shown',async t=>{
 const p=page();t.after(p.done);
 const backend=backendFor();let finish,user={id:'member'};
 backend.listTeamIdentity=()=>new Promise(resolve=>{finish=resolve;});
 const identity=mountTeamIdentity(p.root,()=>({user,teams:[team],backend}));
 identity.open();assert.ok(p.root.querySelector('.team-branding-panel'));
 user={id:'someone-else'};finish([{id:'late',proposed_name:'Late proposal'}]);await flush();
 assert.doesNotMatch(p.root.textContent,/Late proposal|No proposals yet/);
});
