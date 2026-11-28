// Live lobby roster read from the local helper app.
import {liveLineup} from './live-roster.js';
import {LOCAL_HELPER_ORIGIN} from './constants.js';
import {store} from './store.js';
import {$,notice} from './dom.js';
import {accountOf,memberId,canWrite} from './draft-data.js';
import {mutate,loadTeam} from './draft-sync.js';
const LIVE_WATCH_RETRY_MS=5000;
const LIVE_WATCH_TIMEOUT_MS=14000; // local live-roster helper
export function stopLiveWatch() {
 if(!store.liveWatch)return;
 clearTimeout(store.liveWatch.timer);
 store.liveWatch.abort?.abort();
 store.liveWatch=null;
}

export async function checkLiveWatch(watch) {
 if(store.liveWatch!==watch)return;
 if(watch.generation!==store.generation||document.body.dataset.view!=='board'){stopLiveWatch();return;}
 const retry=()=>{if(store.liveWatch===watch)watch.timer=setTimeout(()=>void checkLiveWatch(watch),LIVE_WATCH_RETRY_MS);};
 const controller=new AbortController();
 watch.abort=controller;
 const timeout=setTimeout(()=>controller.abort(),LIVE_WATCH_TIMEOUT_MS);
 try {
  const response=await fetch(LOCAL_HELPER_ORIGIN+'/live-roster',{signal:controller.signal,credentials:'omit',cache:'no-store'});
  if(!response.ok)throw Error('The helper did not accept the connection.');
  const data=await response.json();
  if(store.liveWatch!==watch||watch.generation!==store.generation)return;
  const lineup=data.status==='ready'&&liveLineup(data);
  if(!lineup){
   watch.status.textContent=data.status==='ready'?'Waiting for both complete teams and your Dota account.':data.message||'Waiting for a live match.';
   retry();return;
  }
  if(!canWrite()){
   watch.status.textContent='Waiting for the drafter seat before importing the lineup.';
   retry();return;
  }
  if(store.shared&&store.team?.id===store.shared.team_id&&store.teamRoster.length===0)await loadTeam(store.shared.team_id,{preserveSelection:true});
  if(store.liveWatch!==watch||watch.generation!==store.generation)return;
  const profiles=[...(store.state.roster||[]),...store.teamRoster];
  const roster=lineup.ours.map(id=>{
   const profile=profiles.find(player=>String(accountOf(player))===id);
   return profile?{...profile,id:memberId(profile)}:{id,steamAccountId:id};
  });
  if(store.state.actions.some(action=>action.playerId&&!roster.some(player=>player.id===action.playerId))){
   stopLiveWatch();
   watch.control.textContent='Detect live lineup';
   watch.status.textContent='Live lineup differs from the assigned players. Open a new draft to import it.';
   return;
  }
  if(!canWrite()){retry();return;}
  try {
   await mutate('set_state',{roster,enemyIds:lineup.enemies});
  }catch(error){
   if(store.liveWatch===watch){
    stopLiveWatch();
    watch.control.textContent='Detect live lineup';
    watch.status.textContent=error.message;
   }
   return;
  }
  if(store.liveWatch!==watch||watch.generation!==store.generation)return;
  const input=$('enemy-account-input');
  if(input)input.value=lineup.enemies.join(' ');
  stopLiveWatch();
  watch.control.textContent='Detect live lineup';
  watch.status.textContent='Imported both teams from match '+data.matchId+'. Loading public match history.';
  notice(watch.status.textContent);
 }catch{
  if(store.liveWatch!==watch)return;
  watch.status.textContent='Check that the updated local helper is running and allow local network access if your browser asks. Retrying…';
  retry();
 }finally{clearTimeout(timeout);}
}
