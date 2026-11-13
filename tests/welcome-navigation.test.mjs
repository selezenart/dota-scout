import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createWelcome} from '../web/welcome.js';
import {googleConfigured} from '../api/config.js';

test('Google availability fails closed and accepts only an enabled provider',async()=>{
 const config={url:'https://example.supabase.co',anonKey:'public'};
 assert.equal(await googleConfigured(config,async()=>({ok:true,json:async()=>({external:{google:true}})})),true);
 assert.equal(await googleConfigured(config,async()=>({ok:true,json:async()=>({external:{google:false}})})),false);
 assert.equal(await googleConfigured(config,async()=>{throw Error('offline');}),false);
});

test('Google button refreshes availability, preserves disabled state after email errors and handles retry',async()=>{
 const dom=new JSDOM('<div id="welcome-auth"></div>',{url:'https://board.example/'});
 for(const key of ['document','location','history','sessionStorage'])globalThis[key]=dom.window[key];
 let enabled=false,calls=0,finish;
 try{
  const welcome=createWelcome({getBackend:()=>({signIn:async()=>{throw Error('Invalid password');},signInGoogle:async()=>{calls++;await new Promise(resolve=>{finish=resolve;});throw Error('provider failure');}}),googleEnabled:()=>enabled});
  welcome.form('signin');const root=document.getElementById('welcome-auth'),form=root.querySelector('form'),google=form.querySelector('.google-auth-button');
  assert.equal(google.disabled,true);assert.ok(google.querySelector('img[alt=""]'));
  form.querySelector('[type=email]').value='friend@example.com';form.querySelector('[type=password]').value='password123';
  await form.onsubmit({preventDefault(){}});assert.equal(google.disabled,true);
  enabled=true;welcome.setConnection('available');assert.equal(google.disabled,false);assert.equal(form.querySelector('[type=email]').value,'friend@example.com');
  const waiting=google.onclick();assert.equal(google.disabled,true);assert.match(google.textContent,/Opening Google/);await google.onclick();assert.equal(calls,1);
  finish();await waiting;assert.equal(google.disabled,false);assert.match(form.querySelector('.google-auth .auth-message').textContent,/could not start/);assert.equal(sessionStorage.getItem('captain-oauth-provider'),null);
  welcome.linkError('google');assert.match(root.querySelector('form>.auth-message').textContent,/Google sign-in was canceled/);
 }finally{dom.window.close();for(const key of ['document','location','history','sessionStorage'])delete globalThis[key];}
});

test('confirmation signup returns to the signed-in destination and late Steam availability preserves form input',async()=>{
 const dom=new JSDOM('<div id="welcome-auth"></div>',{url:'https://board.example/'});
 for(const key of ['document','location','history'])globalThis[key]=dom.window[key];
 let enabled=false,cup=0;
 try{
  const welcome=createWelcome({getBackend:()=>({signUp:async()=>({}),signIn:async()=>({session:{user:{id:'test'}}})}),steamEnabled:()=>enabled,onSession:async()=>{},onRegistered:()=>cup++});
  welcome.form('register');
  const root=document.getElementById('welcome-auth'),form=root.querySelector('form');
  form.querySelector('[autocomplete=name]').value='Friend';
  form.querySelector('[type=email]').value='friend@example.com';
  form.querySelector('[type=password]').value='password123';
  enabled=true;welcome.setConnection('ready');
  assert.ok(form.querySelector('a[href="/api/steam"]'));
  assert.ok(form.querySelector('.steam-auth-link svg[aria-hidden="true"] path'));
  assert.equal(form.querySelector('[type=email]').value,'friend@example.com');
  await form.onsubmit({preventDefault(){}});
  assert.equal(new URLSearchParams(location.search).has('cup'),false);
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Go to sign in').click();
  const signin=root.querySelector('form');signin.querySelector('[type=password]').value='password123';
  await signin.onsubmit({preventDefault(){}});
  assert.equal(cup,1);
 }finally{dom.window.close();for(const key of ['document','location','history'])delete globalThis[key];}
});
