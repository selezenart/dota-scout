import {defineConfig} from 'vite';
import {publicConfig} from './api/config.js';
import stratzHandler from './api/stratz.js';
export default defineConfig({root:'web',publicDir:false,envFile:false,server:{host:'127.0.0.1',port:5173},build:{outDir:'../dist',emptyOutDir:true},plugins:[{name:'public-config',configureServer(server){server.middlewares.use('/api/config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(publicConfig()));});
// Same STRATZ reader as on Vercel; needs SUPABASE_URL and SUPABASE_ANON_KEY in the shell environment.
server.middlewares.use('/api/stratz',(req,res)=>{res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};req.url='/api/stratz'+(req.url||'');void stratzHandler(req,res);});}}]});
