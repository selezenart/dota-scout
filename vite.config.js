import {defineConfig} from 'vite';
import {publicConfig} from './api/config.js';
export default defineConfig({root:'web',publicDir:false,envFile:false,server:{host:'127.0.0.1',port:5173},build:{outDir:'../dist',emptyOutDir:true},plugins:[{name:'public-config',configureServer(server){server.middlewares.use('/api/config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(publicConfig()));});}}]});
