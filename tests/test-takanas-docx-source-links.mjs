import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {patchTakanasSeifNavigation} from '../scripts/patch-takanas-seif-navigation.mjs';

const html = patchTakanasSeifNavigation(fs.readFileSync(process.argv[2] || 'dist/library/index.html', 'utf8'));
const start = html.indexOf('async function sourceTextData(link) {');
const end = html.indexOf('\nfunction alignedSourceRows(', start);
assert(start >= 0 && end > start);
const calls = [];
const context = vm.createContext({
  window:{}, sourceConnections:{normalizeRef:ref => ref},
  preferredSourceText:async () => null,
  publishedSourceTranslation:async () => null,
  fetchText:async (ref, options) => { calls.push({ref, options}); return {ref, he:['exact original source'], en:[], local:false}; },
  alignedSourceRows:(he,en) => [[he[0] || '',en[0] || '']],
});
vm.runInContext(html.slice(start,end) + '\nglobalThis.readSource = sourceTextData;', context);
const ref = 'Takanat HaShavin 15:44:4';
await context.readSource({sourceRef:ref, sourceUrl:'https://www.sefaria.org/Takanat_HaShavin.15.44.4'});
assert.equal(calls.at(-1).ref,ref);
assert.equal(calls.at(-1).options.remoteOnly,true,'Original three-level source must not resolve to a Reader paragraph');
const quote = {ref,he:'source excerpt',en:'complete translated Word excerpt',provenance:'KDP Word'};
const result = await context.readSource({sourceRef:ref,sourceUrl:'https://www.sefaria.org/Takanat_HaShavin.15.44.4',fallbackQuote:quote});
assert.equal(calls.at(-1).options.remoteOnly,true);
assert.equal(result.footnoteExcerpt,quote,'Keep the exact Word translation when the cited source has no English');
await context.readSource({sourceRef:'Takanat HaShavin 15:44',sourceUrl:'#/read/Takanat_HaShavin_15:44'});
assert.equal(calls.at(-1).options,undefined,'Existing Reader links keep their own coordinates');
await context.readSource({sourceRef:'Berakhot 2a',sourceUrl:'https://www.sefaria.org/Berakhot.2a'});
assert.equal(calls.at(-1).options,undefined,'Other books retain their existing source behavior');
console.log(JSON.stringify({ok:true,tests:4,exactOriginalSourceAddresses:true,wordTranslationFallbackPreserved:true}));
