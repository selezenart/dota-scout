import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {buildBoard as build} from './build-board.js';

// Public values only: an anon-role JWT shape and a placeholder project URL.
const anonKey=['header',Buffer.from(JSON.stringify({role:'anon'})).toString('base64url'),'signature'].join('.');
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_ANON_KEY=anonKey;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const built=await build({inlineConfig:true,logLevel:'silent',plugins:[{name:'inline-config-boundaries',enforce:'pre',load(id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/web/backend.js'))return 'export const createBackend=options=>globalThis.__createBackend(options);';
 if(path.endsWith('/web/data.js'))return 'export const publicData={request:async()=>[]};export const loadHeroes=()=>new Promise(()=>{});export const loadPlayer=async id=>({id:String(id),sources:{},heroes:[]});';
}}],build:{write:false,minify:false}});
const code=built.output.find(o=>o.type==='chunk'&&o.isEntry).code;
const markup=await readFile('web/index.html','utf8');
const flush=async()=>{await new Promise(r=>setTimeout(r,0));for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};

test('the board reaches Supabase without waiting for /api/config when the build has public config',async()=>{
 const dom=new JSDOM(markup,{url:'https://board.example/',runScripts:'outside-only'}),w=dom.window,calls=[];
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
