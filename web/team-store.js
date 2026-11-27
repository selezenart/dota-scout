// A scouting list kept in the team database inside a team draft and on this device
// otherwise. Device storage is per account (`key:<user id>`, or `key:practice`
// signed out), so another local user does not see this scouting.
//
// `scope` is team-or-device plus the account; every scope change bumps `load`, so a
// list request started in an earlier scope (another team, a signed-out account)
// never lands. Team scope never mixes in device rows.
export const missingRpc=error=>error?.code==='PGRST202'||/Could not find the function/i.test(error?.message||'');

export function createTeamScopedStore({key,cap,newestFirst,method,context,mapRow,onChange,onMissing,onLoadError}){
 const store={
  rows:[],scope:null,remote:false,state:'ready',load:0,loadedAt:0,
  // The team whose list applies now, or null when this board keeps the list on the device.
  team(){const {backend,shared,user}=context();return typeof backend?.[method]==='function'&&shared?.team_id&&user?shared.team_id:null;},
  localKey(){return key+':'+(context().user?.id||'practice');},
  readLocal(){try{const rows=JSON.parse(localStorage.getItem(store.localKey())||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}},
  writeLocal(){try{localStorage.setItem(store.localKey(),JSON.stringify(newestFirst?store.rows.slice(0,cap):store.rows.slice(-cap)));}catch{}},
  sync(){
   const teamId=store.team(),scope=(teamId||'device')+':'+(context().user?.id||'');if(scope===store.scope)return;
   store.scope=scope;store.remote=false;
   if(!teamId){++store.load;store.state='ready';store.rows=store.readLocal();return;}
   store.state='loading';store.rows=[];store.reload(teamId);
  },
  // Re-reads the team list; current rows stay visible until the new ones arrive.
  reload(teamId){
   const load=++store.load;
   void Promise.resolve().then(()=>context().backend[method](teamId)).then(rows=>{
    if(load!==store.load)return;store.remote=true;store.state='ready';store.loadedAt=Date.now();
    store.rows=(Array.isArray(rows)?rows:[]).map(mapRow);onChange();
   }).catch(error=>{
    if(load!==store.load)return;
    if(missingRpc(error)){store.state='ready';store.rows=store.readLocal();onMissing?.();onChange();}
    // A failed refresh keeps the rows already shown.
    else if(store.state==='loading'){store.state='failed';onLoadError(error);}
   });
  },
 };
 return store;
}
