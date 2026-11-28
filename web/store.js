// Shared mutable state of the board. Modules read and assign `store.x` instead of keeping
// their own copies, so every module sees the same account, team, draft and view.
// Account, team and draft switches bump `store.generation`; async work compares it
// (and the signed-in account) before writing results back.
import {demo,readInvitation} from './url-state.js';
export const store={
 teamInvitation:null,
};

if(!demo)store.teamInvitation=readInvitation({restore:true});
