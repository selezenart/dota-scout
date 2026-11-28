import {fileURLToPath} from 'node:url';
import {build} from 'vite';

// Browser module loading is disabled in JSDOM. Compile the board branch into
// the single script these DOM tests can evaluate.
export function buildBoard({inlineConfig=false,...options}){
 const input=fileURLToPath(new URL('../web/app.js',import.meta.url));
 // Keep test builds offline and deterministic: no baked-in config unless a test asks for it.
 const define=inlineConfig?options.define:{__BOARD_CONFIG__:'null',...options.define};
 return build({...options,define,build:{...options.build,rollupOptions:{input}}});
}

// Replace whole modules by path suffix. A value is the module source, or a
// function of the resolved path for stubs that re-import the real module.
export function stubModules(name,modules){
 return {name,enforce:'pre',load(id){
  const path=id.replaceAll('\\','/');
  for(const [suffix,source] of Object.entries(modules))if(path.endsWith(suffix))return typeof source==='function'?source(path):source;
 }};
}

// One build per distinct stub set per process. The key is the stub source text,
// so function stubs must not close over values that change between calls.
const builds=new Map();
export function boardCode(modules={},{inlineConfig=false}={}){
 const key=JSON.stringify([inlineConfig,Object.entries(modules).map(([suffix,source])=>[suffix,String(source)])]);
 if(!builds.has(key))builds.set(key,buildBoard({inlineConfig,logLevel:'silent',plugins:[stubModules('board-test-stubs',modules)],build:{write:false,minify:false}})
  .then(result=>result.output.find(o=>o.type==='chunk'&&o.isEntry).code));
 return builds.get(key);
}
