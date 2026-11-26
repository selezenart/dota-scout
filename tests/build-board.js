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
