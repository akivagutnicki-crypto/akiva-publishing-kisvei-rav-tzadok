// Preserve the published site while attaching the supplied Ois 16 shiur.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const repo = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const site = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const pin = {
  run: 39885179226,
  artifact: 12472516539,
  commit: '95f5fa985fc2551cd6ffa115cd72c9c83b72574b',
  bytes: 701891145,
  digest: 'sha256:9c19d8904c9dd726251a366a10b37e63c25f85bfda6c2dd2ee90ca8898e42ba0'
};
const baselinePins = {
  'library/index.html': '33e75b7a8e7a2b65ea3168adb0df16fa3da2fc8a7de12edd4f0ceaf6101036c4',
  'library/shiur-player.js': '0a5c86d7af1a4977f33889c7bfb555ffa7b6c389a256d7315bc7f7713ef6e152',
  'library/sw.js': '4a1464d9eecaebb32bac4c2f4b1956b96df7662ec5891d3897c7e2d8cac06093',
  'library/data/files.json': 'a502b61b9cdb178e7e66b20d85eb5c450037914b9b7d5e081740b4e7086fc4b2'
};
const newFiles = {
  "library/audio/divrei-soferim-ois-16-lech-lecha.m4a": {
    "bytes": 13929206,
    "sha256": "cf22dfd478139fe5b8f73cbf97ddf84ca0f824b72efb6e3e4ece9fc947c49fd1"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-shiur.pdf": {
    "bytes": 151164,
    "sha256": "7bafaa4c87ac72376d45164e65779d82d7baa4d943928bc1f3cb04b85f11f0d5"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-shiur.docx": {
    "bytes": 23507,
    "sha256": "41842c3408fdbbf0281384e7a34f788e68e48297c34f2522129aa9968100af6f"
  },
  "library/divrei16-preview.js": {
    "bytes": 3446,
    "sha256": "8307c4f9dbec0d12f1c07c216686dde90ebee80da8337466e3cc69cc0d5b42e8"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-01.webp": {
    "bytes": 118668,
    "sha256": "dae3e8eab54c2e481315539a111af2cbc23919ffb60e1dfea3892e33a6216d4c"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-02.webp": {
    "bytes": 109150,
    "sha256": "496c9b06c2966fdc01b57dc4590c6e06a034d225ec74439da5a331f7ed7960d8"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-03.webp": {
    "bytes": 84976,
    "sha256": "093d1dcdf3ea5e753d3f17b38abf65681fd466b5aa2a9a1a91110325c431161a"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-04.webp": {
    "bytes": 107174,
    "sha256": "a9450123628c60f978575c70e96d61836ede0eb4146d01e1b902faa08b3c68b7"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-05.webp": {
    "bytes": 85602,
    "sha256": "a46f27f850f1f2f987079e3d22e591eb4767b6c72433ce45c1cd29d49cbaed99"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-06.webp": {
    "bytes": 100958,
    "sha256": "55d9bbf16ff460765520f6adf2e3f1f42262d08f38bd0305617eccb198283efa"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-07.webp": {
    "bytes": 93660,
    "sha256": "50a420a7ca43430df68bdbe7a4c80e71da55c6e6b77a6b0fb302e270051d1051"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-08.webp": {
    "bytes": 98776,
    "sha256": "7d3986b902ef861bf18496bf4b38df5e8ee89ca3054b9db0b5c8af6b4a5422c0"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-09.webp": {
    "bytes": 71810,
    "sha256": "e67f21a849cf3652f7d509722bb97d2b8eed129c1457fd391ddeed50124e8fc4"
  }
};
const mutableFiles = ['library/index.html', 'library/shiur-player.js', 'library/sw.js'];
const recordFile = 'divrei16-media-baseline.json';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

async function fileRecord(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return {bytes, sha256: hash.digest('hex')};
}

async function inventory(root = 'dist', rel = '', result = {}) {
  for (const entry of fs.readdirSync(path.join(root, rel), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `Unexpected site symlink: ${name}`);
    if (entry.isDirectory()) await inventory(root, name, result);
    else {
      assert(entry.isFile(), `Unexpected special file: ${name}`);
      result[name] = await fileRecord(path.join(root, name));
    }
  }
  return result;
}

async function githubGet(route) {
  const headers = {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repo}${route}`, {headers, signal: AbortSignal.timeout(30000)});
  assert(response.ok, `GitHub metadata request failed (${response.status}): ${route}`);
  return response.json();
}

async function verifyHead() {
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/, 'The release commit SHA is required');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Only main may publish this release');
  const head = await githubGet('/git/ref/heads/main');
  assert.equal(head.object.sha, process.env.GITHUB_SHA, 'Main has advanced; refuse to replace an intervening release');
}

async function liveBytes(name) {
  const url = new URL(name, site);
  url.searchParams.set('divrei16-media-check', String(Date.now()));
  const response = await fetch(url, {cache: 'no-store', headers: {'Cache-Control': 'no-cache'}, signal: AbortSignal.timeout(45000)});
  assert(response.ok, `Live asset request failed (${response.status}): ${name}`);
  return Buffer.from(await response.arrayBuffer());
}

function checkMarkup(index, player, sw, preview) {
  assert(index.includes("d.sectionRef === 'Divrei Soferim 16'"), 'Ois 16 section condition missing');
  assert(index.includes('class="noach6-media divrei16-media"'), 'Compact media grouping missing');
  assert(index.includes('<details class="noach6-pdf divrei16-pdf">'), 'Transcript must start collapsed');
  for (const filename of Object.keys(newFiles).filter(name => /\.(m4a|pdf|docx)$/.test(name))) {
    const relative = filename.replace(/^library\//, '');
    assert((index + player).includes(relative), `Reader link missing: ${relative}`);
  }
  assert(index.includes("if (d.sectionRef === 'Peri Tzadik, Noach 6') {"), 'Existing Noach 6 card missing');
  assert(player.includes("'Divrei Soferim 16'"), 'Ois 16 audio track missing');
  assert(player.includes("duration: '36:57'"), 'Ois 16 recording duration missing');
  assert(index.includes('shiur-player.js?v=20261022-divrei16-media'), 'Reader player cache version missing');
  assert(sw.includes('shiur-player.js?v=20261022-divrei16-media'), 'Offline player cache version missing');
  assert(sw.includes('-divrei16-media-20261022'), 'App shell refresh missing');
  assert(index.includes('divrei16-preview.js?v=20261022-divrei16-page-preview-v1'), 'Mobile transcript viewer is missing');
  assert(sw.includes('divrei16-preview.js?v=20261022-divrei16-page-preview-v1'), 'Mobile transcript viewer cache entry is missing');
  assert(sw.includes('-divrei16-page-preview-20261022'), 'Mobile transcript shell refresh missing');
  assert(preview.includes('divrei-soferim-ois-16-lech-lecha-preview/'), 'Transcript page source is missing');
  assert(preview.includes('const PAGES = 9;'), 'Mobile transcript page count is incorrect');
  const mediaBlock = index.split("} else if (d.sectionRef === 'Divrei Soferim 16') {")[1]?.split('} else html += shiurMarkup;')[0];
  assert(mediaBlock && !mediaBlock.includes('<iframe'), 'Mobile preview must render transcript pages directly');
  const image = mediaBlock.match(/<img class="divrei16-page-image"[^>]+>/)?.[0];
  assert(image && !/\ssrc=/.test(image), 'Transcript page images must load when the preview opens');
  for (const action of ['previous', 'next', 'zoom-out', 'zoom-in', 'fit']) {
    assert(mediaBlock.includes(`data-preview-action="${action}"`), `Mobile transcript control missing: ${action}`);
  }
}

const mode = process.argv[2];
if (mode === '--metadata') {
  const [artifact, run] = await Promise.all([
    githubGet(`/actions/artifacts/${pin.artifact}`), githubGet(`/actions/runs/${pin.run}`)
  ]);
  assert.equal(artifact.id, pin.artifact);
  assert.equal(artifact.name, 'github-pages');
  assert.equal(artifact.expired, false, 'The pinned publication artifact expired');
  assert.equal(artifact.size_in_bytes, pin.bytes);
  assert.equal(artifact.digest, pin.digest);
  assert.equal(artifact.workflow_run.id, pin.run);
  assert.equal(artifact.workflow_run.head_sha, pin.commit);
  assert.equal(run.head_sha, pin.commit);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  await verifyHead();
  write('divrei16-media-baseline-artifact.json', {pin, artifact, run: {id: run.id, head_sha: run.head_sha, conclusion: run.conclusion}});
  console.log('Verified the exact successful publication artifact and release branch head.');
} else if (mode === '--capture') {
  const files = await inventory();
  for (const [name, hash] of Object.entries(baselinePins)) assert.equal(files[name]?.sha256, hash, `Wrong baseline: ${name}`);
  for (const name of Object.keys(newFiles)) assert(!files[name], `Unexpected pre-existing Ois 16 asset: ${name}`);
  assert(files['mcp-data/text/divrei-soferim.json'], 'Published Divrei Soferim index missing');
  write(recordFile, {pin, files});
  console.log(`Captured ${Object.keys(files).length} original files for exact preservation checks.`);
} else if (mode === '--verify') {
  const baseline = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.deepEqual(baseline.pin, pin);
  const files = await inventory();
  const changed = [];
  for (const [name, expected] of Object.entries(baseline.files)) {
    assert(files[name], `Original published file deleted: ${name}`);
    if (files[name].sha256 !== expected.sha256) {
      assert(mutableFiles.includes(name), `Unrelated published file changed: ${name}`);
      changed.push(name);
    }
  }
  assert.deepEqual(changed.sort(), [...mutableFiles].sort(), 'Unexpected reader shell change set');
  const added = Object.keys(files).filter(name => !baseline.files[name]).sort();
  assert.deepEqual(added, Object.keys(newFiles).sort(), 'Unexpected added files');
  for (const [name, expected] of Object.entries(newFiles)) assert.deepEqual(files[name], expected, `Supplied attachment changed: ${name}`);
  for (const name of Object.keys(newFiles).filter(name => name.endsWith('.webp'))) {
    const image = fs.readFileSync(path.join('dist', name));
    assert.equal(image.subarray(0, 4).toString(), 'RIFF', `Invalid preview page: ${name}`);
    assert.equal(image.subarray(8, 12).toString(), 'WEBP', `Invalid preview image type: ${name}`);
  }
  checkMarkup(...[...mutableFiles, 'library/divrei16-preview.js'].map(name => fs.readFileSync(path.join('dist', name), 'utf8')));
  const report = {baselineRun: pin.run, originalFiles: Object.keys(baseline.files).length, preservedFiles: Object.keys(baseline.files).length - changed.length, changed, added, files: Object.fromEntries([...mutableFiles, ...added, 'library/data/files.json'].map(name => [name, files[name]]))};
  write('divrei16-media-verification.json', report);
  console.log(JSON.stringify(report, null, 2));
} else if (mode === '--live-baseline') {
  await verifyHead();
  await Promise.all(Object.entries(baselinePins).map(async ([name, hash]) => {
    assert.equal(sha256(await liveBytes(name)), hash, `Live publication changed since the pinned baseline: ${name}`);
  }));
  console.log('Current main and live reader match the expected publication baseline.');
} else if (mode === '--live') {
  const expected = JSON.parse(fs.readFileSync('divrei16-media-verification.json', 'utf8'));
  let verified;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const results = await Promise.all(Object.entries(expected.files).map(async ([name, wanted]) => {
        const bytes = await liveBytes(name);
        assert.equal(bytes.length, wanted.bytes, `Live length mismatch: ${name}`);
        assert.equal(sha256(bytes), wanted.sha256, `Live content mismatch: ${name}`);
        return [name, wanted];
      }));
      verified = Object.fromEntries(results);
      break;
    } catch (error) {
      if (attempt === 6) throw error;
      console.log(`Waiting for the published asset refresh (${attempt}/6): ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  write('divrei16-media-live-verification.json', {verifiedAt: new Date().toISOString(), files: verified});
  console.log('Verified the public reader shell, complete recording, PDF, original Word file, nine mobile preview pages, and unchanged data manifest.');
} else {
  throw new Error('Choose --metadata, --capture, --verify, --live-baseline, or --live.');
}
