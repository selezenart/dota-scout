import {fileURLToPath} from 'node:url';
import {build} from 'vite';

// Browser module loading is disabled in JSDOM. Compile the board branch into
// the single script these DOM tests can evaluate.
export function buildBoard(options){
 const input=fileURLToPath(new URL('../web/app.js',import.meta.url));
 return build({...options,build:{...options.build,rollupOptions:{input}}});
}
