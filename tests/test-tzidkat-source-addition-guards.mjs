// Meaningful rejection checks for the one explicitly approved source addition.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadSourceAddition,validateSourceAdditionPack} from '../scripts/tzidkat-source-addition-transition.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const prepared=loadSourceAddition(repo);assert(prepared);
const pack=prepared.pack,added=copy=>copy.chapters[0].after.find(row=>row.n===1).footnotes.find(note=>note.number===4031);
const cases=[
  ['author text changed',copy=>{copy.chapters[0].after[0].p[0][0]+='x';}],
  ['an old note changed',copy=>{copy.chapters[0].after[0].footnotes.find(n=>n.number!==4031).paragraphs[0].text+='x';}],
  ['an old note removed',copy=>{copy.chapters[0].after[0].footnotes=copy.chapters[0].after[0].footnotes.filter(n=>n.number!==20);}],
  ['a second source note added',copy=>{copy.additions.push(structuredClone(copy.additions[0]));}],
  ['wrong Hebrew offset',copy=>{copy.additions[0].note.heCharOffset=92;added(copy).heCharOffset=92;}],
  ['wrong English offset',copy=>{copy.additions[0].note.enCharOffset=112;added(copy).enCharOffset=112;}],
  ['wrong English prefix',copy=>{copy.additions[0].note.enAnchorPrefix+='x';added(copy).enAnchorPrefix+='x';}],
  ['a different public number',copy=>{copy.additions[0].note.number=4032;added(copy).number=4032;}],
  ['different source identity',copy=>{copy.additions[0].note.sourceId='TZ-4032';added(copy).sourceId='TZ-4032';}],
  ['a different original source URL',copy=>{copy.additions[0].note.sources[0].url+='?different';added(copy).sources[0].url+='?different';}],
  ['a truncated primary Hebrew comment',copy=>{copy.audit.entries[0].sourceEvidence[0].he=copy.audit.entries[0].sourceEvidence[0].he.slice(0,-1);}],
  ['an unreviewed note',copy=>{copy.audit.entries[0].status='pending';}],
];
const result=[];
for(const [name,mutate]of cases){const copy=structuredClone(pack);mutate(copy);assert.throws(()=>validateSourceAdditionPack(copy),undefined,name);result.push({name,rejected:true});}
const sha=value=>createHash('sha256').update(value).digest('hex');
const report={ok:true,packSha256:prepared.packSha256,descriptorSha256:prepared.descriptorSha256,guards:result,
  immutablePackUnchanged:sha(fs.readFileSync(path.join(repo,'sources/akiva/addenda/tzidkat-source-addition-006-20261025.json.gz')))===prepared.packSha256};
const output=path.resolve(process.argv[2]||'source-addition-guard-report.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
