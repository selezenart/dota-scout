import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicQueue, loadPlayer} from '../web/data.js';

test('default public fetch keeps the global receiver required by browser fetch',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async function(){assert.equal(this,globalThis);return {ok:true,json:async()=>[]};};
 try{const queue=new PublicQueue({storage:null});assert.deepEqual(await queue.request('/players/42/heroes'),[]);}
 finally{globalThis.fetch=original;}
});

test('reading cached public data retains its original fetched timestamp', async () => {
  let now = 1000;
  let calls = 0;
  const queue = new PublicQueue({
    storage: null,
    now: () => now,
    fetcher: async () => {
      calls++;
      return {ok: true, json: async () => ({profile: {personaname: 'Player'}})};
    }
  });
  await queue.request('/players/42');
  assert.deepEqual(queue.getSourceInfo('/players/42'), {at: 1000, cached: false});
  now = 2000;
  await queue.request('/players/42');
  assert.equal(calls, 1);
  assert.deepEqual(queue.getSourceInfo('/players/42'), {at: 1000, cached: true});
});

test('persistent cache age survives a new queue and reaches scouting source labels', async () => {
  const storage = {
    getItem: () => JSON.stringify({at: 500, value: []}),
    setItem() {}
  };
  const queue = new PublicQueue({
    storage,
    now: () => 2000,
    fetcher: async () => { throw new Error('Cache should be used'); }
  });
  const player = await loadPlayer(42, () => {}, queue);
  assert.equal(player.sources.heroes.at, 500);
  assert.equal(player.sources.heroes.cached, true);
  assert.equal(player.sources.matches.at, 500);
});

test('future timestamps are refetched instead of being presented as fresh cache', async () => {
  const queue = new PublicQueue({
    storage: {getItem: () => JSON.stringify({at: 9999, value: 'future'}), setItem() {}},
    now: () => 1000,
    fetcher: async () => ({ok: true, json: async () => 'current'})
  });
  assert.equal(await queue.request('/players/42'), 'current');
  assert.deepEqual(queue.getSourceInfo('/players/42'), {at: 1000, cached: false});
});
