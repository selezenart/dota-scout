import {steamConfig} from './steam.js';
export function publicConfig(env = process.env) {
  try {
    const url = new URL(env.SUPABASE_URL || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) return {};
    const key = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';
    if (key.startsWith('sb_publishable_') && /^[A-Za-z0-9_-]{30,}$/.test(key)) return {url:url.origin,anonKey:key};
    const parts = key.split('.');
    if (parts.length !== 3) return {};
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.role !== 'anon' || !/^[A-Za-z0-9_.-]+$/.test(key)) return {};
    return {url:url.origin,anonKey:key};
  } catch { return {}; }
}
export async function googleConfigured(config,fetcher=fetch){
 if(!config.url)return false;
 try{const response=await fetcher(config.url+'/auth/v1/settings',{headers:{apikey:config.anonKey},signal:AbortSignal.timeout(3000)});return response.ok&&(await response.json()).external?.google===true;}catch{return false;}
}
export default async function handler(req,res) { res.setHeader('Cache-Control','no-store'); const config=publicConfig(); res.status(200).json(config.url?{...config,steamAuth:!!steamConfig(),googleAuth:await googleConfigured(config)}:config); }
