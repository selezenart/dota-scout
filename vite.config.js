import {defineConfig} from 'vite';
import {publicConfig,googleConfigured} from './api/config.js';
import {steamConfig} from './api/steam.js';
import stratzHandler from './api/stratz.js';
// Public Supabase URL/anon key and sign-in flags are baked into the bundle so the
// app can reach Supabase without first waiting for /api/config. Only values that
// /api/config already serves publicly are included; publicConfig() rejects non-anon keys.
async function inlineConfig(){const config=publicConfig();if(!config.url)return null;return {...config,steamAuth:!!steamConfig(),googleAuth:await googleConfigured(config)};}
export default defineConfig(async()=>({define:{__BOARD_CONFIG__:JSON.stringify(await inlineConfig())},root:'web',publicDir:false,envFile:false,server:{host:'127.0.0.1',port:5173},build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{input:{main:'web/index.html',privacy:'web/privacy.html',terms:'web/terms.html'}}},plugins:[{name:'public-config',configureServer(server){server.middlewares.use('/api/config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(publicConfig()));});
// Same STRATZ reader as on Vercel; needs SUPABASE_URL and SUPABASE_ANON_KEY in the shell environment.
server.middlewares.use('/api/stratz',(req,res)=>{res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};req.url='/api/stratz'+(req.url||'');void stratzHandler(req,res);});}}]}));
