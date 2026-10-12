import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const source = 'sources/akiva/audio';
const output = 'dist/library/audio';
const tracks = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
fs.mkdirSync(output, {recursive: true});
for (const track of tracks) {
  const recording = Buffer.concat(track.parts.map(part => fs.readFileSync(path.join(source, part))));
  const hash = createHash('sha256').update(recording).digest('hex');
  if (recording.length !== track.bytes || hash !== track.sha256) {
    throw new Error(`The supplied recording for ${track.ref} is incomplete or changed.`);
  }
  fs.writeFileSync(path.join(output, track.output), recording);
  console.log(`Verified and prepared ${track.ref}: ${recording.length} bytes.`);
}
