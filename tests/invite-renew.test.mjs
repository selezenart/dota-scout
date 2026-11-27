import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBackend} from '../web/backend.js';

test('renewTeamInvite calls the owner-only RPC pinned to the chosen account',async t=>{
 const requests=[];
 const fixtureSession={access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expires_in:3600,user:{id:'owner'}};
 const renewed={invite_code:'c'.repeat(64),invite_expires_at:'2027-01-01T00:00:00Z'};
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const url=new URL(input);
  requests.push({url,method:options.method,headers:new Headers(options.headers),body:JSON.parse(options.body)});
  const data=url.pathname.endsWith('/token')?fixtureSession:renewed;
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 });
 globalThis.location=new URL('https://board.example/');
 t.after(()=>{delete globalThis.location;});
 const backend=createBackend({supabaseUrl:'https://supabase.example',supabaseAnonKey:'fixture-publishable-key'});
 await backend.signIn('owner@example.com','fixture-password');
 await assert.rejects(backend.renewTeamInvite('team-a','another-account'),/active account changed/);
 assert.equal(requests.length,1);
 assert.deepEqual(await backend.renewTeamInvite('team-a','owner'),renewed);
 const call=requests.at(-1);
 assert.equal(call.url.pathname,'/rest/v1/rpc/renew_scout_team_invite');
 assert.equal(call.method,'POST');
 assert.equal(call.headers.get('Authorization'),'Bearer fixture-access-token');
 assert.deepEqual(call.body,{target_team:'team-a'});
});

test('migration 015 adds an owner-only invite renewal that locks invite then team',async()=>{
 const sql=await readFile('supabase/migrations/015_renew_team_invite.sql','utf8').catch(()=>'');
 assert.match(sql,/create or replace function public\.renew_scout_team_invite\(target_team uuid\)/i);
 assert.match(sql,/security definer set search_path = ''/i);
 const body=sql.slice(sql.search(/\$\$/));
 const check=body.search(/raise exception 'Only the captain can renew/i);
 const lockInvite=body.search(/from public\.team_invites where team_id = target_team[^;]*for update/i);
 const lockTeam=body.search(/from public\.teams where id = target_team[^;]*for update/i);
 assert.ok(check>0&&lockInvite>check&&lockTeam>lockInvite,'ownership check, then invite lock, then team lock');
 assert.match(sql,/expires_at = now\(\) \+ interval '30 days'/i);
 assert.match(sql,/'invite_code'[^;]*'invite_expires_at'/i);
 assert.match(sql,/revoke all on function public\.renew_scout_team_invite\(uuid\) from public, anon, authenticated;/i);
 assert.match(sql,/grant execute on function public\.renew_scout_team_invite\(uuid\) to authenticated;/i);
});
