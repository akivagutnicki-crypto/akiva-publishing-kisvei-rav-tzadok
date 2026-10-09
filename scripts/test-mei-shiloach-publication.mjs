import fs from 'node:fs';
import path from 'node:path';
const root = 'dist/library/data';
const file = path.join(root,'mei-ha-shiloach','interlinear.json');
if (!fs.existsSync(file)) throw new Error('Missing Mei HaShiloach study overlay');
const source = JSON.parse(fs.readFileSync('sources/akiva/overlays/mei-hashiloach-interlinear.json','utf8'));
const study = JSON.parse(fs.readFileSync(file,'utf8'));
const expected = [15,8,10,2,3,1];
const refs = [
  'Mei HaShiloach, Volume I, Genesis, Bereshit',
  'Mei HaShiloach, Volume I, Genesis, Noach',
  'Mei HaShiloach, Volume II, Genesis, Bereshit',
  'Mei HaShiloach, Volume II, Genesis, Noach',
  'Mei HaShiloach, Mei HaShiloach Anthology, Genesis, Bereshit',
  'Mei HaShiloach, Mei HaShiloach Anthology, Genesis, Noach'
];
if (Object.keys(study).length !== 6) throw new Error('Expected six Mei HaShiloach groups');
let passages = 0, phrases = 0, nikkud = 0;
for (let i = 0; i < refs.length; i++) {
  const list = study[refs[i]];
  if (!Array.isArray(list) || list.length !== expected[i])
    throw new Error('Wrong passage count in '+refs[i]);
  const original = source.sections[i].paragraphs;
  for (let j=0; j<list.length; j++) {
    if (list[j].length !== original[j].length)
      throw new Error('Phrase count changed for '+refs[i]+' #'+(j+1));
    passages++;
    for (const [he,en] of list[j]) {
      if (!/[א-ת]/.test(he) || !/[A-Za-z]/.test(en))
        throw new Error('Unaligned Hebrew-English text');
      if (/[\[\]]/.test(en)) throw new Error('English brackets leaked into interlinear translation');
      nikkud += (he.match(/[\u0591-\u05c7]/g)||[]).length;
      phrases++;
    }
  }
}
if (passages !== 39 || phrases !== 1022 || nikkud < 1000)
  throw new Error('Mei HaShiloach coverage regression: '+JSON.stringify({passages,phrases,nikkud}));
const catalog = JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
if (catalog.some(x => x.title==='Mei HaShiloach'))
  throw new Error('The overlay must not replace Sefaria original English by shadowing its catalog entry');
const linksFile = path.join(root,'mei-ha-shiloach','links.json');
const links = fs.existsSync(linksFile) ? JSON.parse(fs.readFileSync(linksFile,'utf8')) : {};
const connectionCount = Object.values(links).flat().length;
const html = fs.readFileSync('dist/library/index.html','utf8');
if (!html.includes('withMeiStudy') || !html.includes('phrases:overlay') || !html.includes('Mei HaShiloach'))
  throw new Error('Reader is not wired for Mei HaShiloach overlay');
console.log('PASS Mei HaShiloach: '+passages+' paragraphs, '+phrases+' aligned phrases, '+nikkud+' nikkud marks, '+connectionCount+' detected local source links; Sefaria English is separate');
