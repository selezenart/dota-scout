import test from 'node:test';
import assert from 'node:assert/strict';
import {boardCode} from './build-board.js';
import {dataStub,flush,boardWindow} from './board-harness.js';

// Public values only: an anon-role JWT shape and a placeholder project URL.
const anonKey=['header',Buffer.from(JSON.stringify({role:'anon'})).toString('base64url'),'signature'].join('.');
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_ANON_KEY=anonKey;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const code=await boardCode({
 '/web/backend.js':'export const createBackend=options=>globalThis.__createBackend(options);',
 '/web/data.js':dataStub({loadHeroes:'()=>new Promise(()=>{})',loadPlayer:'async id=>({id:String(id),sources:{},heroes:[]})'}),
},{inlineConfig:true});

test('the board reaches Supabase without waiting for /api/config when the build has public config',async()=>{
 const dom=boardWindow(''),w=dom.window,calls=[];
 w.fetch=url=>{calls.push(String(url));return new Promise(()=>{});};
 w.__createBackend=options=>{calls.push('backend:'+options.supabaseUrl);return {getSession:async()=>null,onAuthChange(){},listTeams:async()=>[]};};
 w.setInterval=()=>0;
 try{
  w.eval(code);await flush();
  assert.ok(calls.includes('backend:https://example.supabase.co'),'backend created from inlined config: '+calls.join(', '));
  assert.ok(!calls.slice(0,calls.indexOf('backend:https://example.supabase.co')).includes('/api/config'),'no blocking /api/config request');
 }finally{w.close();}
});

test('inlined config never contains server secrets',()=>{
 assert.ok(code.includes(anonKey),'public anon key is inlined');
 assert.doesNotMatch(code,/service_role|SUPABASE_SERVICE_ROLE_KEY|STEAM_AUTH_SECRET/);
});
