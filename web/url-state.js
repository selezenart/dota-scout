// Page URL flags, the pending-draft intent and team-invitation storage.
// No board state lives here, so any module can import it.
import {DAY_MS} from './constants.js';
const INVITE_KEEP_MS=30*DAY_MS; // a saved team invitation link is kept this long
// The current page's query; read fresh on every call because history navigation changes it.
export function urlParams(){return new URLSearchParams(location.search);}

export const demo=urlParams().has('demo')||urlParams().has('mock');

export const captainDemo=demo&&urlParams().has('captain');
export const playerDemo=demo&&urlParams().has('player');
const draftIntentKey='captain-pending-draft';
// Any 8-4-4-4-12 hex UUID (drafts use gen_random_uuid; the version digit is not checked).
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const validDraftId=value=>UUID.test(value||'');
// Public Supabase config baked in at build time (vite.config.js), or null when the build had none.
export function inlinedConfig(){return typeof __BOARD_CONFIG__==='object'&&__BOARD_CONFIG__?.url&&__BOARD_CONFIG__?.anonKey?__BOARD_CONFIG__:null;}
export function pendingDraft(){try{const value=sessionStorage.getItem(draftIntentKey);return validDraftId(value)?value:null;}catch{return null;}}
export function forgetDraft(){try{sessionStorage.removeItem(draftIntentKey);}catch{}}
const entryDraft=urlParams().get('draft');
if(validDraftId(entryDraft)&&!demo){try{sessionStorage.setItem(draftIntentKey,entryDraft);}catch{}}

const teamInviteKey='captain-team-invite-v1';
export const teamInviteCode=/^[a-f0-9]{64}$/;

function saveInvitation(code){
 // Storage is shared by same-origin tabs so the confirmation email can open a new tab.
 // Never attach the invitation credential to an auth redirect or request URL.
 const record=JSON.stringify({code,until:Date.now()+INVITE_KEEP_MS});
 try{localStorage.setItem(teamInviteKey,record);}catch{try{sessionStorage.setItem(teamInviteKey,record);}catch{}}
}

export function forgetInvitation(code){
 if(!code)return;
 for(const store of ['localStorage','sessionStorage'])try{
  const storage=window[store];
  if(JSON.parse(storage.getItem(teamInviteKey)||'null')?.code===code)storage.removeItem(teamInviteKey);
 }catch{}
}

export function readInvitation({restore=false}={}){
 const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1));
 const codes=[...fragment.getAll('invite'),...url.searchParams.getAll('invite')];
 if(codes.length){
  const code=codes.length===1&&teamInviteCode.test(codes[0])?codes[0]:null;
  if(fragment.has('invite')){fragment.delete('invite');url.hash=fragment.toString();}
  url.searchParams.delete('invite');history.replaceState(history.state,'',url);
  if(code)saveInvitation(code);
  return {code};
 }
 if(!restore||url.searchParams.has('draft')||url.searchParams.has('practice'))return null;
 let raw;
 try{raw=localStorage.getItem(teamInviteKey);}catch{try{raw=sessionStorage.getItem(teamInviteKey);}catch{}}
 try{
  const saved=JSON.parse(raw||'null');
  if(saved&&saved.until>Date.now()&&teamInviteCode.test(saved.code))return {code:saved.code};
  if(saved)forgetInvitation(saved.code);
 }catch{}
 return null;
}

export const storageKey=demo?'captain-demo-v1':'captain-practice-v1';

export function codeFromInvitation(input){
 const value=input.trim();
 let url;try{url=new URL(value);}catch{return value;}
 const fragment=new URLSearchParams(url.hash.slice(1));
 const codes=[...fragment.getAll('invite'),...url.searchParams.getAll('invite')];
 if(url.origin!==location.origin||codes.length!==1||!teamInviteCode.test(codes[0]))throw Error('Enter a team invite link from this site or paste the invitation code.');
 return codes[0];
}
export const imageId=urlParams().get('team-image');
