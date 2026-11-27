import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBackend,googleAttemptKey} from '../web/backend.js';
import {readFileSync} from 'node:fs';
import {GOOGLE_ATTEMPT_KEY} from '../web/constants.js';

const clientId='123-abc.apps.googleusercontent.com';

function browserGlobals(){
 const store=new Map(),visited=[];
 globalThis.sessionStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 globalThis.location={origin:'https://captains-board.vercel.app',assign:url=>visited.push(url)};
 return {store,visited};
}

test('Google sign-in goes straight to Google and returns to our own address',async()=>{
 const {store,visited}=browserGlobals();
 const backend=createBackend({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public',googleClientId:clientId});
 assert.equal(backend.googleDirect,true);
 await backend.signInGoogle();
 assert.equal(visited.length,1);
 const url=new URL(visited[0]);
 assert.equal(url.origin+url.pathname,'https://accounts.google.com/o/oauth2/v2/auth');
 assert.equal(url.searchParams.get('client_id'),clientId);
 assert.equal(url.searchParams.get('redirect_uri'),'https://captains-board.vercel.app/');
 assert.equal(url.searchParams.get('response_type'),'id_token');
 assert.equal(url.searchParams.get('scope'),'openid email profile');
 const pending=JSON.parse(store.get('captain-google-oauth'));
 assert.match(pending.state,/^[0-9a-f]{32,}$/);
 assert.match(pending.nonce,/^[0-9a-f]{32,}$/);
 assert.equal(url.searchParams.get('state'),pending.state);
 assert.equal(url.searchParams.get('nonce'),createHash('sha256').update(pending.nonce).digest('hex'),'Google only sees the hashed nonce');
 assert.ok(!visited[0].includes(pending.nonce),'raw nonce never leaves the browser');
});

test('without a Google client ID the existing Supabase redirect is kept',()=>{
 browserGlobals();
 const backend=createBackend({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public'});
 assert.equal(backend.googleDirect,false);
 assert.equal(typeof backend.finishGoogle,'function');
});

test('app.js reads the Google attempt from the same storage key backend.js writes',()=>{
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 assert.equal(googleAttemptKey,'captain-google-oauth');
 assert.equal(googleAttemptKey,GOOGLE_ATTEMPT_KEY);
 assert.match(app,/import \{[^}]*\bGOOGLE_ATTEMPT_KEY\b[^}]*\} from '\.\/constants\.js';/);
 assert.ok(!app.includes("'captain-google-oauth'"),'app.js must not repeat the key');
});

test('only a well-formed Google client ID is published',async()=>{
 const {googleClientId}=await import('../api/config.js');
 assert.equal(googleClientId({GOOGLE_CLIENT_ID:' 979878573644-abc123def.apps.googleusercontent.com '}),'979878573644-abc123def.apps.googleusercontent.com');
 for(const bad of ['','GOCSPX-secret','https://evil.example/x.apps.googleusercontent.com','123-abc.apps.googleusercontent.com.evil.com'])assert.equal(googleClientId({GOOGLE_CLIENT_ID:bad}),'',bad);
});
