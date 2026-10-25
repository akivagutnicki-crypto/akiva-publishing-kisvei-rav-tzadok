// Recompress a reviewed download with the exact fflate implementation already
// present in the sealed reader. Explicit original dates make output repeatable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const [sourceFile,manifestFile,targetFile,vendorFile] = process.argv.slice(2);
assert(sourceFile && manifestFile && targetFile && vendorFile);
const {unzipSync,zipSync} = createRequire(import.meta.url)(vendorFile);
const source = unzipSync(fs.readFileSync(sourceFile));
const manifest = JSON.parse(fs.readFileSync(manifestFile));
assert.deepEqual(Object.keys(source),manifest.members.map(item => item.name),'ZIP input names/order differ');
const names = new Set();
for (const item of manifest.updates) {
  assert(Object.hasOwn(source,item.name) && !names.has(item.name),'Invalid/repeated ZIP replacement');
  names.add(item.name);
  const bytes = fs.readFileSync(item.file);
  assert.equal(bytes.length,item.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
  source[item.name] = bytes;
}
const entries = Object.fromEntries(manifest.members.map(item => {
  assert(Array.isArray(item.date) && item.date.length === 6);
  const [year,month,day,hour,minute,second] = item.date;
  return [item.name,[source[item.name],{mtime:new Date(year,month-1,day,hour,minute,second),level:6}]];
}));
const output = zipSync(entries,{level:6});
const roundTrip = unzipSync(output);
assert.deepEqual(Object.keys(roundTrip),Object.keys(source));
for (const name of Object.keys(source)) assert.deepEqual(Buffer.from(roundTrip[name]),Buffer.from(source[name]),'ZIP round-trip differs');
fs.writeFileSync(targetFile,output);
