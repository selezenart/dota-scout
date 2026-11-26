import {readdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
async function walk(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(async e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]))).flat();}
for(const path of await walk('dist')){assert(/^dist\/(index\.html|assets\/[\w.-]+\.(js|css|json|woff2?|svg|png))$/.test(path),'Unexpected output: '+path);const s=await readFile(path,'utf8');assert(!/sb_secret_[A-Za-z0-9_-]{16,}|"role"\s*:\s*"service_role"|steam_api_key|SUPABASE_SERVICE_ROLE_KEY/.test(s),'Forbidden content: '+path);}
const rules=(await readFile('.vercelignore','utf8').catch(error => { if (error.code === 'ENOENT' && process.env.VERCEL === '1') return '*'; throw error; })).split(/\r?\n/);assert.equal(rules[0],'*');for(const rule of rules.filter(r=>r.startsWith('!'))){assert(/^!(web|api|scripts|package(?:-lock)?\.json|vite\.config\.js|vercel\.json)(?:$|\/)/.test(rule),'Unsafe upload rule');assert(!rule.includes('*'),'No wildcard includes');}// Inlined public config must only ever carry anon keys: decode every JWT-shaped string in the bundle.
for(const path of await walk('dist')){const s=await readFile(path,'utf8');for(const [jwt] of s.matchAll(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)){let role;try{role=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString()).role;}catch{continue;}assert(role==='anon','Non-anon Supabase key in '+path);}}
// Every file the app ships from web/ and api/ must be re-included in .vercelignore (it starts with '*'),
// otherwise Vercel silently leaves it out. Skipped on Vercel, where .vercelignore itself is not uploaded.
if(rules.length>1){const allowed=new Set(rules.filter(r=>r.startsWith('!')).map(r=>r.slice(1)));for(const dir of ['web','api'])for(const path of await walk(dir))assert(allowed.has(path),'Missing from .vercelignore allowlist: '+path);}
console.log('Build and upload allowlist safety checks passed');
