import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import handler from '../api/steam.js';

// Drives the real /api/steam handler. Steam, OpenDota and Supabase are faked at
// the fetch boundary, so the real supabase-js client builds the wire requests
// and the tests can see exactly what reaches each service.
const origin = 'https://board.example';
const supabase = 'https://project.supabase.test';
const serviceKey = 'fake-service-role-key-for-tests-only-0123456789';
const secret = 'fake-steam-state-secret-for-tests-0123456789';
const cookieName = '__Host-captain-steam';
const steamId = '76561197960265729';
const provider = 'https://steamcommunity.com/openid/login';
const sign = (purpose, value) => createHmac('sha256', secret).update(purpose + '\0' + value).digest('hex');

let savedEnv, savedFetch, services;
test.beforeEach(() => {
  savedEnv = {...process.env};
  savedFetch = globalThis.fetch;
  Object.assign(process.env, {SUPABASE_URL:supabase, SUPABASE_SERVICE_ROLE_KEY:serviceKey, STEAM_AUTH_SECRET:secret, STEAM_AUTH_ORIGIN:origin});
  services = fakeServices();
  globalThis.fetch = services.fetch;
});
test.afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  globalThis.fetch = savedFetch;
});

function fakeServices() {
  const calls = [], used = new Set();
  const behaviour = {steamValid:true, steamStatus:200, nickname:'Nick', consume:'once', linkError:false};
  const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json'}});
  async function fetch(input, init) {
    const request = new Request(input, init);
    const call = {url:request.url, method:request.method, headers:Object.fromEntries(request.headers), body:await request.text()};
    calls.push(call);
    const url = new URL(call.url);
    if (call.url === provider) return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:' + behaviour.steamValid + '\n', {status:behaviour.steamStatus});
    if (url.origin === 'https://api.opendota.com') return json({profile:{personaname:behaviour.nickname}});
    if (url.origin !== supabase) throw Error('Unexpected request to ' + url.origin);
    if (url.pathname === '/rest/v1/rpc/consume_steam_auth_nonce') {
      if (behaviour.consume === 'error') return json({message:'database unavailable'}, 500);
      const nonce = JSON.parse(call.body).assertion_nonce;
      const fresh = !used.has(nonce);
      used.add(nonce);
      return json(fresh);
    }
    if (url.pathname === '/auth/v1/admin/generate_link') {
      if (behaviour.linkError) return json({code:'unexpected_failure', msg:'link failed'}, 422);
      return json({id:'user-1', email:JSON.parse(call.body).email, hashed_token:'fake-hashed-token', action_link:supabase + '/verify', verification_type:'magiclink'});
    }
    if (url.pathname === '/rest/v1/player_profiles') return new Response(null, {status:call.method === 'POST' ? 201 : 204});
    throw Error('Unexpected Supabase request ' + call.method + ' ' + url.pathname);
  }
  return {
    fetch, calls, behaviour,
    to:host => calls.filter(call => new URL(call.url).origin === host),
    path:path => calls.filter(call => call.url.startsWith(supabase + path)),
  };
}

function response() {
  return {
    statusCode:200, headers:{}, body:undefined, location:undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(code, url) { this.statusCode = code; this.location = url; return this; },
  };
}
async function call(url, cookie, method = 'GET') {
  const res = response();
  await handler({method, url, headers:cookie === undefined ? {} : {cookie}}, res);
  return res;
}
async function start() {
  const res = await call('/api/steam');
  const value = /^__Host-captain-steam=([^;]+);/.exec(res.headers['set-cookie'])[1];
  const state = new URL(res.location).searchParams.get('openid.return_to').split('&state=')[1];
  return {res, state, cookie:cookieName + '=' + value};
}
let nonces = 0;
function assertion(state, {returnTo} = {}) {
  const nonce = new Date().toISOString().slice(0,19) + 'Zunique' + (++nonces);
  const identity = 'https://steamcommunity.com/openid/id/' + steamId;
  const fields = {
    ns:'http://specs.openid.net/auth/2.0', mode:'id_res', op_endpoint:provider, claimed_id:identity, identity,
    return_to:returnTo || origin + '/api/steam?callback=1&state=' + state, response_nonce:nonce, assoc_handle:'fake-handle',
    signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', sig:'fake-signature',
  };
  const query = new URLSearchParams({callback:'1', state});
  for (const [key, value] of Object.entries(fields)) query.set('openid.' + key, value);
  return {url:'/api/steam?' + query, nonce};
}
const signedCookie = state => cookieName + '=' + state + '.' + sign('state', state);
function assertRejected(res) {
  assert.equal(res.statusCode, 303);
  assert.equal(res.location, origin + '/?steam-error');
  assert.equal(services.path('/auth/v1/admin/generate_link').length, 0, 'no session link is minted');
}
const leaks = (res, value) => [res.location, res.body, ...Object.values(res.headers)].some(part => String(part ?? '').includes(value));

test('start redirect signs a short-lived host-only state cookie and sends Steam the matching return URL', async () => {
  const {res, state, cookie} = await start();
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.match(state, /^\d{10}\.[a-f0-9]{48}$/);
  assert.ok(Math.abs(Number(state.split('.')[0]) - Date.now() / 1000) < 5, 'state carries the issue time');
  assert.equal(res.headers['set-cookie'], cookie + '; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax');
  assert.equal(cookie, signedCookie(state), 'cookie is the state plus its HMAC');
  assert.doesNotMatch(res.headers['set-cookie'], /Domain=/i, '__Host- cookies must stay host-only');
  const steam = new URL(res.location);
  assert.equal(steam.origin + steam.pathname, provider);
  assert.equal(steam.searchParams.get('openid.mode'), 'checkid_setup');
  assert.equal(steam.searchParams.get('openid.return_to'), origin + '/api/steam?callback=1&state=' + state);
  assert.equal(steam.searchParams.get('openid.realm'), origin + '/');
  assert.equal(services.calls.length, 0, 'starting sign-in contacts no service');
  assert.notEqual((await start()).state, state, 'every start gets a fresh random state');
});

test('Steam sign-in is unavailable without full configuration and rejects non-GET methods', async () => {
  delete process.env.STEAM_AUTH_SECRET;
  const missing = await call('/api/steam');
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.headers['set-cookie'], undefined);
  process.env.STEAM_AUTH_SECRET = secret;
  const post = await call('/api/steam', undefined, 'POST');
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers['set-cookie'], undefined);
  assert.equal(services.calls.length, 0);
});

test('a valid callback clears the cookie, consumes the nonce, upserts the profile and redirects with the token', async () => {
  const {state, cookie} = await start();
  const {url, nonce} = assertion(state);
  const res = await call(url, 'other=1; ' + cookie);
  assert.equal(res.statusCode, 303);
  assert.equal(res.location, origin + '/#steam_token=fake-hashed-token');
  assert.equal(res.headers['set-cookie'], cookieName + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');

  const [verify] = services.to('https://steamcommunity.com');
  assert.equal(verify.method, 'POST');
  assert.equal(new URLSearchParams(verify.body).get('openid.mode'), 'check_authentication');

  const [consume] = services.path('/rest/v1/rpc/consume_steam_auth_nonce');
  assert.deepEqual(JSON.parse(consume.body), {assertion_nonce:nonce});

  const [link] = services.path('/auth/v1/admin/generate_link');
  const linkBody = JSON.parse(link.body);
  assert.equal(linkBody.type, 'magiclink');
  assert.equal(linkBody.email, 'steam-' + sign('account', steamId).slice(0,48) + '@steam.captain.invalid');
  assert.deepEqual(linkBody.data, {display_name:'Nick', steam_account_id:'1'});

  const [upsert, rename, extra] = services.path('/rest/v1/player_profiles');
  assert.equal(extra, undefined);
  assert.equal(upsert.method, 'POST');
  assert.equal(new URL(upsert.url).searchParams.get('on_conflict'), 'user_id');
  assert.match(upsert.headers.prefer, /resolution=ignore-duplicates/, 'an existing profile is never overwritten');
  assert.deepEqual(JSON.parse(upsert.body), {user_id:'user-1', display_name:'Nick', steam_account_id:'1'});
  assert.equal(rename.method, 'PATCH');
  assert.equal(new URL(rename.url).searchParams.get('user_id'), 'eq.user-1');
  assert.equal(new URL(rename.url).searchParams.get('display_name'), 'in.(Steam 1,Steam player)', 'only default names are replaced');
  assert.deepEqual(JSON.parse(rename.body), {display_name:'Nick'});

  for (const value of [serviceKey, secret]) assert.equal(leaks(res, value), false, 'response never carries server secrets');
  for (const outside of services.calls.filter(item => !item.url.startsWith(supabase)))
    assert.equal(JSON.stringify(outside).includes(serviceKey), false, 'service key is sent only to Supabase: ' + outside.url);
  for (const inside of services.calls.filter(item => item.url.startsWith(supabase)))
    assert.equal(inside.headers.apikey, serviceKey, 'Supabase calls use the service role');
});

test('a callback with a forged state signature is rejected before Steam is asked', async () => {
  const {state} = await start();
  assertRejected(await call(assertion(state).url, cookieName + '=' + state + '.' + '0'.repeat(64)));
  assertRejected(await call(assertion(state).url, cookieName + '=' + state + '.' + sign('account', state)));
  assert.equal(services.calls.length, 0);
});

test('a callback without the state cookie is rejected', async () => {
  const {state} = await start();
  assertRejected(await call(assertion(state).url));
  assertRejected(await call(assertion(state).url, 'unrelated=1'));
  assert.equal(services.calls.length, 0);
});

test('a malformed state is rejected even when its cookie is correctly signed', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const state of ['', 'abc', '123.' + 'a'.repeat(48), now + '.' + 'A'.repeat(48), now + '.' + 'a'.repeat(47), now + '.' + 'a'.repeat(48) + '.x'])
    assertRejected(await call(assertion(state).url, signedCookie(state)));
  assert.equal(services.calls.length, 0);
});

test('an expired or future-dated state is rejected even when correctly signed', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const issued of [now - 605, now + 605]) {
    const state = issued + '.' + 'b'.repeat(48);
    assertRejected(await call(assertion(state).url, signedCookie(state)));
  }
  assert.equal(services.calls.length, 0);
  const fresh = (now - 590) + '.' + 'b'.repeat(48);
  const accepted = await call(assertion(fresh).url, signedCookie(fresh));
  assert.equal(accepted.location, origin + '/#steam_token=fake-hashed-token', 'a state inside the window still works');
});

test('a cookie from another sign-in attempt does not authorize this callback', async () => {
  const first = await start(), second = await start();
  assertRejected(await call(assertion(second.state).url, first.cookie));
  assert.equal(services.calls.length, 0);
});

test('a callback whose return URL names another state fails the Steam assertion checks', async () => {
  const first = await start(), second = await start();
  const {url} = assertion(first.state, {returnTo:origin + '/api/steam?callback=1&state=' + second.state});
  assertRejected(await call(url, first.cookie));
  assert.equal(services.calls.length, 0);
});

test('Steam rejecting the assertion stops before the nonce is consumed', async () => {
  services.behaviour.steamValid = false;
  const {state, cookie} = await start();
  assertRejected(await call(assertion(state).url, cookie));
  assert.equal(services.to('https://steamcommunity.com').length, 1);
  assert.equal(services.path('/rest/v1/rpc/consume_steam_auth_nonce').length, 0);
});

test('a Steam error response is rejected even if its body claims validity', async () => {
  services.behaviour.steamStatus = 500;
  const {state, cookie} = await start();
  assertRejected(await call(assertion(state).url, cookie));
  assert.equal(services.path('/rest/v1/rpc/consume_steam_auth_nonce').length, 0);
});

test('a replayed assertion is rejected once its nonce has been consumed', async () => {
  const {state, cookie} = await start();
  const {url} = assertion(state);
  assert.equal((await call(url, cookie)).location, origin + '/#steam_token=fake-hashed-token');
  const replay = await call(url, cookie);
  assert.equal(replay.location, origin + '/?steam-error');
  assert.equal(services.path('/rest/v1/rpc/consume_steam_auth_nonce').length, 2);
  assert.equal(services.path('/auth/v1/admin/generate_link').length, 1, 'the replay mints no second link');
});

test('a nonce store failure fails closed', async () => {
  services.behaviour.consume = 'error';
  const {state, cookie} = await start();
  assertRejected(await call(assertion(state).url, cookie));
  assert.equal(services.path('/rest/v1/rpc/consume_steam_auth_nonce').length, 1);
});

test('a magic-link failure redirects to the error page without touching profiles', async () => {
  services.behaviour.linkError = true;
  const {state, cookie} = await start();
  const res = await call(assertion(state).url, cookie);
  assert.equal(res.location, origin + '/?steam-error');
  assert.equal(services.path('/auth/v1/admin/generate_link').length, 1);
  assert.equal(services.path('/rest/v1/player_profiles').length, 0);
  assert.equal(leaks(res, serviceKey), false);
});

test('a missing OpenDota nickname keeps the default name and skips the rename', async () => {
  services.behaviour.nickname = null;
  const {state, cookie} = await start();
  assert.equal((await call(assertion(state).url, cookie)).location, origin + '/#steam_token=fake-hashed-token');
  const profiles = services.path('/rest/v1/player_profiles');
  assert.equal(profiles.length, 1);
  assert.equal(JSON.parse(profiles[0].body).display_name, 'Steam player');
});
