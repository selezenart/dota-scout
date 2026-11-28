// The local practice board, saved per account in localStorage.
import {initialState} from './demo.js';
import {demo,storageKey} from './url-state.js';
import {store} from './store.js';
import {touch} from './draft-data.js';

try {
 const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
 if(saved&&!demo){store.state={...initialState(),...saved.state};store.profile=saved.profile||{};}
}catch{}

function practiceKey(){return store.user?'captain-practice-v1:'+store.user.id:storageKey;}
export function saveLocal(){if(!store.shared&&!demo)try{localStorage.setItem(practiceKey(),JSON.stringify({state:store.state,profile:store.profile}));}catch{}}
export function restorePractice(){
 store.state=initialState();
 try{
  const saved=JSON.parse(localStorage.getItem(practiceKey())||'null');
  if(saved){store.state={...initialState(),...saved.state};if(!store.user)store.profile=saved.profile||{};return;}
 }catch{}
 if(store.user){store.state.roster=[{...store.profile,id:store.user.id}];touch();}
}
