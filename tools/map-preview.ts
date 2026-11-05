import { relayYard, mapToAscii } from '../src/content/relayYard';
import { validateMap } from '../src/sim/map';

const m = relayYard();
console.log(mapToAscii(m).join('\n'));
const errs = validateMap(m);
console.log(errs.length ? errs.join('\n') : 'map valid');
