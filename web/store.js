// Shared mutable state of the board. Modules read and assign `store.x` instead of keeping
// their own copies, so every module sees the same account, team, draft and view.
// Account, team and draft switches bump `store.generation`; async work compares it
// (and the signed-in account) before writing results back.
import snapshot from './heroes.json';
import {initialState,demoState} from './demo.js';
import {demo,captainDemo,readInvitation} from './url-state.js';
export const store={
 teamInvitation:null,
 heroes:snapshot,
 state:demo?demoState():initialState(),
 profile:captainDemo?{displayName:'Lee',preferredRoles:[3],signatureHeroes:[2,29],desiredHeroes:[29]}:demo?{displayName:'Alex',preferredRoles:[1,2],roleComfort:{1:4,2:3},signatureHeroes:[1,8,44],desiredHeroes:[8],avoidHeroes:[]}: {},
 backend:undefined,
 user:undefined,
 shared:undefined,
 teams:[],
 team:undefined,
 selected:null,
 pending:false,
 localControl:true,
 generation:0,
 polling:false,
 healthy:true,
 lastRoster:0,
 matchups:{},
 reviewVisible:true,
 // Optional seat data: kept apart from `matchups`, which recommend() reads.
 allyCounterMatchups:{},
 focusedPlayer:null,
 searchIndex:0,
 teamRoster:[],
 selectedTeamIds:[],
 teamLoad:0,
 liveWatch:undefined,
 homeTeamId:'',
 homeRoster:[],
 homeRequest:0,
};

if(!demo)store.teamInvitation=readInvitation({restore:true});
