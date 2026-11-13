import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const provider = 'https://steamcommunity.com/openid/login';
const namespace = 'http://specs.openid.net/auth/2.0';
const identifier = namespace + '/identifier_select';
const cookie = '__Host-captain-steam';
const callbackPath = '/api/steam?callback=1';
const lifetime = 600;

export function steamConfig(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || (env.STEAM_AUTH_SECRET?.length || 0) < 32) return null;
  try {
    const origin = new URL(env.STEAM_AUTH_ORIGIN).origin;
    if (!origin.startsWith('https://') || origin !== env.STEAM_AUTH_ORIGIN) return null;
    return {origin, secret:env.STEAM_AUTH_SECRET, url:env.SUPABASE_URL, key:env.SUPABASE_SERVICE_ROLE_KEY};
  } catch {return null;}
}

const hmac = (secret, purpose, value) => createHmac('sha256',secret).update(purpose+'\0'+value).digest('hex');

export async function verifySteamAssertion(query, returnTo, fetcher = fetch, now = Date.now()) {
  const claimed = query.get('openid.claimed_id');
  const identity = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed || '');
  const fields = ['op_endpoint','claimed_id','identity','return_to','response_nonce','assoc_handle'];
  const signed = new Set((query.get('openid.signed') || '').split(','));
  const nonce = query.get('openid.response_nonce') || '';
  const time = Date.parse(nonce.slice(0,20));
  const params = [...query].filter(([name]) => name.startsWith('openid.'));
  if (new Set(params.map(([name])=>name)).size !== params.length ||
      query.get('openid.ns') !== namespace || query.get('openid.mode') !== 'id_res' ||
      query.get('openid.op_endpoint') !== provider || !identity || query.get('openid.identity') !== claimed ||
      query.get('openid.return_to') !== returnTo || !fields.every(field => signed.has(field)) ||
      !Number.isFinite(time) || time < now-lifetime*1000 || time > now+60000) throw Error('Invalid Steam assertion');
  const accountId = BigInt(identity[1])-76561197960265728n;
  if (accountId<=0n || accountId>=4294967295n) throw Error('Invalid Steam account');
  const body = new URLSearchParams(params);
  body.set('openid.mode','check_authentication');
  const response = await fetcher(provider,{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(10000)});
  if (!response.ok || !(await response.text()).split(/\r?\n/).includes('is_valid:true')) throw Error('Steam verification failed');
  return {steamId:identity[1], accountId:String(accountId), nonce};
}

export async function openDotaNickname(accountId, fetcher = fetch) {
  if (!/^\d{1,10}$/.test(String(accountId))) return null;
  try {
    const response = await fetcher('https://api.opendota.com/api/players/'+accountId, {
      redirect:'error', signal:AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const name = (await response.json()).profile?.personaname;
    return typeof name === 'string' ? Array.from(name.trim()).slice(0,80).join('') || null : null;
  } catch {
    return null;
  }
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  const config = steamConfig();
  if (!config || req.method !== 'GET') return res.status(config?405:503).send('Steam sign-in unavailable.');
  const query = new URL(req.url,config.origin).searchParams;
  const redirect = url => res.redirect(303,url);
  if (!query.has('callback')) {
    const state = Math.floor(Date.now()/1000)+'.'+randomBytes(24).toString('hex');
    const signature = hmac(config.secret,'state',state);
    res.setHeader('Set-Cookie', cookie+'='+state+'.'+signature+'; Path=/; Max-Age='+lifetime+'; Secure; HttpOnly; SameSite=Lax');
    const steam = new URL(provider);
    steam.search = new URLSearchParams({
      'openid.ns':namespace, 'openid.mode':'checkid_setup', 'openid.return_to':config.origin+callbackPath+'&state='+state,
      'openid.realm':config.origin+'/', 'openid.claimed_id':identifier, 'openid.identity':identifier,
    });
    return redirect(steam.href);
  }
  try {
    const state = query.get('state') || '';
    const saved = (req.headers.cookie || '').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookie+'='))?.slice(cookie.length+1) || '';
    const expected = state+'.'+hmac(config.secret,'state',state);
    if (!/^\d{10}\.[a-f0-9]{48}$/.test(state) || saved.length!==expected.length ||
        !timingSafeEqual(Buffer.from(saved),Buffer.from(expected)) ||
        Math.abs(Date.now()/1000-Number(state.split('.')[0]))>lifetime) throw Error('Invalid Steam state');
    res.setHeader('Set-Cookie',cookie+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
    const {steamId,accountId,nonce} = await verifySteamAssertion(query,config.origin+callbackPath+'&state='+state);
    const admin = createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
    const consumed = await admin.rpc('consume_steam_auth_nonce',{assertion_nonce:nonce});
    if (consumed.error || !consumed.data) throw Error('Steam assertion already used');
    const email = 'steam-'+hmac(config.secret,'account',steamId).slice(0,48)+'@steam.captain.invalid';
    const nickname = await openDotaNickname(accountId);
    const displayName = nickname || 'Steam player';
    const {data,error} = await admin.auth.admin.generateLink({type:'magiclink',email,options:{data:{
      display_name:displayName, steam_account_id:String(accountId),
    }}});
    if (error || !data?.properties?.hashed_token) throw Error('Could not create Steam session');
    if (data.user?.id) {
      const profile = {user_id:data.user.id,display_name:displayName,steam_account_id:String(accountId)};
      const inserted = await admin.from('player_profiles').upsert(profile,{onConflict:'user_id',ignoreDuplicates:true});
      if (!inserted.error && nickname) {
        await admin.from('player_profiles').update({display_name:nickname})
          .eq('user_id',data.user.id).in('display_name',['Steam '+accountId,'Steam player']);
      }
    }
    return redirect(config.origin+'/#'+new URLSearchParams({steam_token:data.properties.hashed_token}));
  } catch {
    return redirect(config.origin+'/?steam-error');
  }
}
