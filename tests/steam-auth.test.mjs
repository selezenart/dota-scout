import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySteamAssertion,steamConfig} from '../api/steam.js';

test('Steam assertions must match the callback, be fresh, and pass direct Valve verification', async () => {
  const now = Date.parse('2026-11-13T18:00:00Z');
  const callback = 'https://board.example/api/steam?callback=1&state=example';
  const identity = 'https://steamcommunity.com/openid/id/76561197960265729';
  const query = new URLSearchParams(Object.fromEntries(Object.entries({
    ns:'http://specs.openid.net/auth/2.0',mode:'id_res',op_endpoint:'https://steamcommunity.com/openid/login',
    claimed_id:identity,identity,return_to:callback,response_nonce:'2026-11-13T18:00:00Zunique',
    assoc_handle:'test',signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
  }).map(([key,value])=>['openid.'+key,value])));
  let calls = 0;
  const verify = async (url, options) => {
    calls++;
    assert.equal(url,'https://steamcommunity.com/openid/login');
    assert.equal(options.body.get('openid.mode'),'check_authentication');
    return new Response('is_valid:true\n');
  };
  assert.equal((await verifySteamAssertion(query,callback,verify,now)).accountId,'1');
  await assert.rejects(verifySteamAssertion(query,'https://other.example',verify,now));
  await assert.rejects(verifySteamAssertion(query,callback,verify,now+700000));
  const duplicate = new URLSearchParams(query);
  duplicate.append('openid.identity',identity);
  await assert.rejects(verifySteamAssertion(duplicate,callback,verify,now));
  assert.equal(calls,1);
  await assert.rejects(verifySteamAssertion(query,callback,async()=>new Response('is_valid:false'),now));
});

test('Steam configuration fails closed without a secure canonical origin or secret',()=>{
  assert.equal(steamConfig({}),null);
  assert.equal(steamConfig({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',STEAM_AUTH_SECRET:'x'.repeat(32),STEAM_AUTH_ORIGIN:'http://board.example'}),null);
});
