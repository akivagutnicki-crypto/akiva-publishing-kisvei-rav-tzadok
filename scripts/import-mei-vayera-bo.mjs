import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const target='sources/akiva/overlays/mei-hashiloach-interlinear.json';
const payload='sources/akiva/overlays/mei-hashiloach-vayera-to-bo.json.gz.b64';
const expectedHash='771832e6aa208410b3d3b22b73a76c9b45482b10ec743e8b555e70ddbcbed546';
const bytes=gunzipSync(Buffer.from(fs.readFileSync(payload,'utf8').trim(),'base64'));
const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!==expectedHash)throw Error('Mei HaShiloach uploaded source checksum mismatch '+hash);
const incoming=JSON.parse(bytes);
if(incoming.book!=='Mei HaShiloach'||incoming.sections?.length!==12)
 throw Error('Mei HaShiloach import must cover 12 parashiyos');
const existing=JSON.parse(fs.readFileSync(target,'utf8'));
if(existing.book!=='Mei HaShiloach'||!Array.isArray(existing.sections))throw Error('Invalid original Mei overlay');

const lengths=[9,5,13,9,38,7,9,7,10,5,4,7];
let paragraphs=0,phrases=0,linked=0;
for(let k=0;k<incoming.sections.length;k++){
 const s=incoming.sections[k];
 if(existing.sections.some(old=>old.ref===s.ref))throw Error('Would duplicate existing section '+s.ref);
 if(!/^Mei HaShiloach, Volume I, (Genesis|Exodus), [A-Za-z ]+$/.test(s.ref))throw Error('Invalid canonical Mei reference '+s.ref);
 if(s.paragraphs.length!==lengths[k]||s.headings.length!==lengths[k])
  throw Error('Passage/heading count mismatch '+s.ref);
 for(let i=0;i<s.paragraphs.length;i++){
  const pairs=s.paragraphs[i];
  if(!pairs.length)throw Error('Missing teaching '+s.ref+':'+(i+1));
  for(const pair of pairs){
   if(!Array.isArray(pair)||pair.length!==2||!/[א-ת]/.test(pair[0])||!/[A-Za-z]/.test(pair[1])||/[\[\]]/.test(pair[1]))
    throw Error('Misaligned or bracketed text '+s.ref+':'+(i+1));
   phrases++;
  }
  if(!s.headings[i].trim())throw Error('Missing topic heading in '+s.ref+':'+(i+1));
  linked+=(s.sourceLinks?.[i]||[]).length;
  paragraphs++;
 }
 existing.sections.push(s);
}
if(paragraphs!==123||phrases!==1275)throw Error('Mei coverage mismatch '+paragraphs+'/'+phrases);
existing.source='Akiva Publishing interlinear translations; original Bereshit–Lech Lecha + supplied Vayera–Bo DOCX';
fs.writeFileSync(target,JSON.stringify(existing));
console.log('Imported Mei HaShiloach: 12 new canonical sections, '+paragraphs+' Sefaria-aligned passages, '+phrases+' bilingual phrases and '+linked+' explicit citation references.');
