// Replace only the formatted Ois 16 transcript, preserving the actual live publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const repo = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const site = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const revision = '20261022-divrei16-transcript-v2';
// This successful publication includes the current responsive layout and route guard.
const pin = {
  run: 39892885124,
  publishJob: 120217239160,
  runConclusion: 'success',
  artifact: 12475726255,
  commit: 'cb39518489c13f1b4cc539f8fb765d1a207d9835',
  bytes: 716374153,
  digest: 'sha256:2faff25ac7c00cef6a5a1889fcc38b0d0ab0cb0f22b1529bb393d64e71bbb1ce',
  fileCount: 5124,
  treeSha256: '60e424ccdf3e4265ba45bf64c76c11178b49a0c235a088005860ad6940ea2913'
};
const previousAssets = {
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
const baselinePins = {
  'library/index.html': 'b7ec9c0653a53d2d25f493d79665825d94039108b8ebe0519d84836d8ad85da1',
  'library/sw.js': 'cb5d1f4df0924eb207b81ee9d02021b04c73ba860782bb7f3055a1f32f1b244d',
  'library/shiur-player.js': 'c82c09f4e2c076964f80a30432eaf68ef8765393742b03570fbd71773fa5986a',
  'library/data/files.json': 'a502b61b9cdb178e7e66b20d85eb5c450037914b9b7d5e081740b4e7086fc4b2',
  'library/data/catalog.json': '31f6d708770ab237927a1b65bc5de8544c8f8da08a4926881cb23e90878ecb9f',
  'library/responsive-ui.css': '1fdea78dd59333ee54a1507423f3534a16fa92ad04e99422fce5a72aad6534a6',
  'library/responsive-ui.js': '5ccd6cc6472342181539633865b2ef05e57e4ed0496cff3f0b46025242d10955',
  ...Object.fromEntries(Object.entries(previousAssets).map(([name, record]) => [name, record.sha256]))
};
// Exact files approved after rendering the formatted twelve-page transcript.
const revisedFiles = {
  "library/downloads/divrei-soferim-ois-16-lech-lecha-shiur.docx": {
    "bytes": 26489,
    "sha256": "a2a479089371774f8caf96711fc33919438b446896238c75bdf6550e894ad104"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-shiur.pdf": {
    "bytes": 261706,
    "sha256": "7faa3402d602baa55bae91ba43b7ef1e708a9a1df3a7dfaff153586f8637bb3a"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-01.webp": {
    "bytes": 122652,
    "sha256": "bb54c697a6cf15d7f204073c7046ef5b1bb015aa0bddddef91229d28132061d2"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-02.webp": {
    "bytes": 118016,
    "sha256": "ced05bb80bbc6013866a6c0a8ddce6af96b2e8319dc3b1c7ef691fb349b4ad20"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-03.webp": {
    "bytes": 117128,
    "sha256": "35a1231d3c6b625a1fefb24e65387a55778cbe3f90c2b5cbb53355d449dcdf4a"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-04.webp": {
    "bytes": 86652,
    "sha256": "c3f455035fca9c18f7e91f16672b1a9ee5a76d367b13c14d1b450b32b636723c"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-05.webp": {
    "bytes": 112756,
    "sha256": "5a42d23265eac4a42e7a8282c70f897e785b54eafe6b2dc0f549d987988b2aa0"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-06.webp": {
    "bytes": 96460,
    "sha256": "a958fbb143920ef712f250e449d50fdab6e45d275ec8356d6238c432274b6a4b"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-07.webp": {
    "bytes": 106054,
    "sha256": "43d000a4716f1f9cd84cd7a82beb6a275dba600734a63287b29dc02c0bc8e649"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-08.webp": {
    "bytes": 114248,
    "sha256": "936800c477104715990d1cab0c5a91f5a962ceab055ee25b21183e1c6a9dfdd9"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-09.webp": {
    "bytes": 108588,
    "sha256": "4b08aad8991cc6d03859def789a3f93a60ce47e27ea91aa6283e8ecac2967a9d"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-10.webp": {
    "bytes": 109374,
    "sha256": "fda47ec65575deb06933a559afe7d6768cd76970302189fb169b719b455f5688"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-11.webp": {
    "bytes": 116384,
    "sha256": "7ae47e2e73785829dc51c53f842ff38f8e8a5aac7460c675eeab46b78a8f7cb5"
  },
  "library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-12.webp": {
    "bytes": 43304,
    "sha256": "4c6b88b4e8e639a2ea8647e8beac106fc9e35e786a7082fbeae7b27ad2353ded"
  },
  "library/divrei16-preview.js": {
    "bytes": 3643,
    "sha256": "b4416700f07eab124dc1d9c6a82584c35f1754c29c19e5f08b190df8a7a05eae"
  }
};

const previewDirectory = 'library/downloads/divrei-soferim-ois-16-lech-lecha-preview';
const previewFiles = Object.keys(revisedFiles).filter(name => name.endsWith('.webp')).sort();
const previousPreviewFiles = Object.keys(previousAssets).filter(name => name.endsWith('.webp')).sort();
assert.equal(previewFiles.length, 12, 'The formatted PDF contains exactly twelve pages');
assert.deepEqual(previewFiles, Array.from({length: 12}, (_, index) =>
  previewDirectory + '/page-' + String(index + 1).padStart(2, '0') + '.webp'));
const shellFiles = ['library/index.html', 'library/sw.js'];
const replacementFiles = Object.keys(revisedFiles).filter(name => name in previousAssets);
const addedFiles = Object.keys(revisedFiles).filter(name => !(name in previousAssets));
const removedFiles = previousPreviewFiles.filter(name => !(name in revisedFiles));
const mutableFiles = [...shellFiles, ...replacementFiles].sort();
const immutablePins = Object.fromEntries(Object.entries(baselinePins).filter(([name]) =>
  !shellFiles.includes(name) && !(name in revisedFiles) && !removedFiles.includes(name)));
const recordFile = 'divrei16-media-baseline.json';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const treeHash = files => sha256(JSON.stringify(Object.keys(files).sort().map(name => [name, files[name].sha256])));
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  assert(process.argv[at + 1] && !process.argv[at + 1].startsWith('--'), 'Missing argument for ' + name);
  return process.argv[at + 1];
};
const root = option('--root', 'dist');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

async function fileRecord(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return {bytes, sha256: hash.digest('hex')};
}

async function inventory(directory = root, rel = '', result = {}) {
  for (const entry of fs.readdirSync(path.join(directory, rel), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = rel ? rel + '/' + entry.name : entry.name;
    assert(!entry.isSymbolicLink(), 'Unexpected site symlink: ' + name);
    if (entry.isDirectory()) await inventory(directory, name, result);
    else {
      assert(entry.isFile(), 'Unexpected special file: ' + name);
      result[name] = await fileRecord(path.join(directory, name));
    }
  }
  return result;
}

async function githubGet(route) {
  const headers = {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const response = await fetch('https://api.github.com/repos/' + repo + route, {headers, signal: AbortSignal.timeout(30000)});
  assert(response.ok, 'GitHub metadata request failed (' + response.status + '): ' + route);
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
  assert(response.ok, 'Live asset request failed (' + response.status + '): ' + name);
  return Buffer.from(await response.arrayBuffer());
}

function replaceOnce(text, before, after, label) {
  assert.equal(text.split(before).length - 1, 1, 'Unexpected ' + label + ' count');
  return text.replace(before, after);
}

function checkMarkup(index, player, sw, preview) {
  assert(index.includes("d.sectionRef === 'Divrei Soferim 16'"), 'Ois 16 section condition missing');
  assert(index.includes('class="noach6-media divrei16-media"'), 'Compact media grouping missing');
  const details = index.match(/<details\b[^>]*class="noach6-pdf divrei16-pdf"[^>]*>/)?.[0];
  assert(details && !/\sopen(?:\s|=|>)/.test(details), 'Transcript must start collapsed');
  assert(details.includes('data-preview-pages="' + previewFiles.length + '"'), 'Transcript page count does not match the PDF');
  assert(details.includes('data-preview-version="' + revision + '"'), 'Transcript revision metadata missing');
  for (const extension of ['pdf', 'docx']) {
    assert(index.includes('downloads/divrei-soferim-ois-16-lech-lecha-shiur.' + extension + '?v=' + revision),
      'Versioned transcript link missing: ' + extension);
  }
  assert(index.includes("if (d.sectionRef === 'Peri Tzadik, Noach 6') {"), 'Existing Noach 6 card missing');
  assert(player.includes("'Divrei Soferim 16'") && player.includes("duration: '36:57'"), 'Existing Ois 16 audio track missing');
  assert(player.includes('audio/divrei-soferim-ois-16-lech-lecha.m4a'), 'Original recording link missing');
  for (const text of [index, sw]) {
    assert(text.includes('shiur-player.js?v=20261022-divrei16-media'), 'Existing audio player cache version changed');
    assert(text.includes('divrei16-preview.js?v=' + revision), 'Revised transcript viewer cache version missing');
    assert(text.includes('responsive-ui.css?v=20261022-responsive-v1'), 'Current responsive stylesheet missing');
    assert(text.includes('responsive-ui.js?v=20261022-responsive-v1'), 'Current responsive controls missing');
  }
  assert(sw.includes('-' + revision), 'Transcript app-shell refresh missing');
  assert(preview.includes('details.dataset.previewPages') && preview.includes('details.dataset.previewVersion'),
    'Preview must read the revision and page count from the reader');
  assert(preview.includes('encodeURIComponent(revision)'), 'Preview image requests must include the revision');
  const mediaBlock = index.split("} else if (d.sectionRef === 'Divrei Soferim 16') {")[1]?.split('} else html += shiurMarkup;')[0];
  assert(mediaBlock && !mediaBlock.includes('<iframe'), 'Mobile preview must render transcript pages directly');
  const image = mediaBlock.match(/<img class="divrei16-page-image"[^>]+>/)?.[0];
  assert(image && !/\ssrc=/.test(image), 'Transcript page images must load only when the preview opens');
  for (const action of ['previous', 'next', 'zoom-out', 'zoom-in', 'fit']) {
    assert(mediaBlock.includes('data-preview-action="' + action + '"'), 'Mobile transcript control missing: ' + action);
  }
}

// Reverse only the permitted transcript metadata edits. Any other shell change fails.
function checkShellPreservation(before, index, sw) {
  for (const name of shellFiles) {
    assert.equal(sha256(before[name]), baselinePins[name], 'Wrong shell baseline: ' + name);
  }
  const newQuery = 'divrei16-preview.js?v=' + revision;
  const oldQuery = 'divrei16-preview.js?v=20261022-divrei16-page-preview-v1';
  let normalizedIndex = replaceOnce(index, newQuery, oldQuery, 'preview script');
  const startMarker = "} else if (d.sectionRef === 'Divrei Soferim 16') {";
  const endMarker = '} else html += shiurMarkup;';
  assert.equal(normalizedIndex.split(startMarker).length, 2, 'Unexpected Ois 16 block count');
  const start = normalizedIndex.indexOf(startMarker);
  const end = normalizedIndex.indexOf(endMarker, start);
  assert(end > start, 'Ois 16 block boundary missing');
  let block = normalizedIndex.slice(start, end);
  block = replaceOnce(block, ' data-preview-pages="' + previewFiles.length + '" data-preview-version="' + revision + '"', '', 'transcript metadata');
  block = replaceOnce(block, 'Preview the shiur transcript · ' + previewFiles.length + ' pages',
    'Preview the shiur transcript · ' + previousPreviewFiles.length + ' pages', 'transcript summary');
  block = replaceOnce(block, '>Page 1 of ' + previewFiles.length + '</span>',
    '>Page 1 of ' + previousPreviewFiles.length + '</span>', 'transcript page label');
  block = replaceOnce(block, 'page 1 of ' + previewFiles.length + '" decoding="async"',
    'page 1 of ' + previousPreviewFiles.length + '" decoding="async"', 'transcript image description');
  for (const extension of ['pdf', 'docx']) {
    const file = 'downloads/divrei-soferim-ois-16-lech-lecha-shiur.' + extension;
    block = replaceOnce(block, 'href="' + file + '?v=' + revision + '"', 'href="' + file + '"', extension + ' link');
  }
  normalizedIndex = normalizedIndex.slice(0, start) + block + normalizedIndex.slice(end);
  assert.equal(normalizedIndex, before['library/index.html'], 'Reader changes exceed the allowed transcript metadata');
  let normalizedSw = replaceOnce(sw, newQuery, oldQuery, 'preview cache entry');
  const shells = [...normalizedSw.matchAll(/const SHELL = \x60([^\x60]+)\x60;/g)];
  assert.equal(shells.length, 1, 'Unexpected app-shell definition');
  const shell = shells[0];
  const oldShell = replaceOnce(shell[0], '-' + revision, '', 'transcript cache suffix');
  normalizedSw = normalizedSw.replace(shell[0], oldShell);
  assert.equal(normalizedSw, before['library/sw.js'], 'Service-worker changes exceed the transcript cache refresh');
}

async function checkRevisedAssets() {
  const entries = fs.readdirSync(path.join(root, previewDirectory), {withFileTypes: true});
  assert(entries.every(entry => entry.isFile() && !entry.isSymbolicLink()), 'Unexpected preview directory entry');
  assert.deepEqual(entries.map(entry => previewDirectory + '/' + entry.name).sort(), previewFiles,
    'The transcript preview directory contains missing or stale pages');
  for (const [name, expected] of Object.entries(revisedFiles)) {
    const file = path.join(root, name);
    assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'Unsafe transcript input: ' + name);
    assert.deepEqual(await fileRecord(file), expected, 'Revised transcript asset mismatch: ' + name);
    if (name.endsWith('.webp')) {
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', 'Invalid preview page: ' + name);
      assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', 'Invalid preview image type: ' + name);
    }
  }
}

const mode = process.argv[2];
if (mode === '--metadata') {
  const [artifact, run, jobs] = await Promise.all([
    githubGet('/actions/artifacts/' + pin.artifact), githubGet('/actions/runs/' + pin.run),
    githubGet('/actions/runs/' + pin.run + '/jobs?filter=latest&per_page=100')
  ]);
  assert.equal(artifact.id, pin.artifact);
  assert.equal(artifact.name, 'github-pages');
  assert.equal(artifact.expired, false, 'The pinned publication artifact expired');
  assert.equal(artifact.size_in_bytes, pin.bytes);
  assert.equal(artifact.digest, pin.digest);
  assert.equal(artifact.workflow_run.id, pin.run);
  assert.equal(artifact.workflow_run.head_sha, pin.commit);
  assert.equal(artifact.workflow_run.head_branch, 'main');
  assert.equal(run.head_sha, pin.commit);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, pin.runConclusion);
  const publication = jobs.jobs.find(job => job.id === pin.publishJob);
  assert(publication && publication.status === 'completed', 'Pinned deployment job is missing or incomplete');
  const requiredSteps = ['Publish responsive reader', 'Verify the exact live shell'];
  for (const name of requiredSteps) {
    const step = publication.steps.find(value => value.name === name);
    assert(step && step.conclusion === 'success', 'Baseline publication step did not succeed: ' + name);
  }
  await verifyHead();
  write('divrei16-media-baseline-artifact.json', {
    pin, artifact, run: {id: run.id, head_sha: run.head_sha, conclusion: run.conclusion},
    publication: {id: publication.id, conclusion: publication.conclusion,
      steps: publication.steps.filter(step => requiredSteps.includes(step.name))}
  });
  console.log('Verified the exact deployed publication artifact, successful live-shell check and release branch head.');
} else if (mode === '--input-files') {
  await checkRevisedAssets();
  console.log(JSON.stringify(Object.keys(revisedFiles)));
} else if (mode === '--verify-inputs') {
  await checkRevisedAssets();
  checkMarkup(read('library/index.html'), read('library/shiur-player.js'), read('library/sw.js'), read('library/divrei16-preview.js'));
  const baselineLibrary = option('--baseline-library', null);
  if (baselineLibrary) {
    const before = Object.fromEntries(shellFiles.map(name => [name, fs.readFileSync(path.join(baselineLibrary, path.basename(name)), 'utf8')]));
    checkShellPreservation(before, read('library/index.html'), read('library/sw.js'));
  }
  console.log(JSON.stringify({revision, pages: previewFiles.length, revisedAssets: Object.keys(revisedFiles).length,
    shellPreservation: Boolean(baselineLibrary)}, null, 2));
} else if (mode === '--capture') {
  const files = await inventory();
  assert.equal(Object.keys(files).length, pin.fileCount, 'Unexpected baseline file count');
  assert.equal(treeHash(files), pin.treeSha256, 'The restored publication does not match the complete deployed file tree');
  for (const [name, hash] of Object.entries(baselinePins)) assert.equal(files[name]?.sha256, hash, 'Wrong baseline: ' + name);
  for (const [name, expected] of Object.entries(previousAssets)) assert.deepEqual(files[name], expected, 'Previous media asset changed: ' + name);
  assert(files['mcp-data/text/divrei-soferim.json'], 'Published Divrei Soferim index missing');
  write(recordFile, {pin, files, readerShell: Object.fromEntries(shellFiles.map(name => [name, read(name)]))});
  console.log('Captured all ' + Object.keys(files).length + ' deployed files; their complete tree matches the pinned publication.');
} else if (mode === '--verify') {
  const baseline = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.deepEqual(baseline.pin, pin);
  assert.equal(Object.keys(baseline.files).length, pin.fileCount);
  assert.equal(treeHash(baseline.files), pin.treeSha256);
  const files = await inventory();
  const changed = [], removed = [];
  for (const [name, expected] of Object.entries(baseline.files)) {
    if (!files[name]) {
      assert(removedFiles.includes(name), 'Unrelated published file deleted: ' + name);
      removed.push(name);
    } else if (files[name].sha256 !== expected.sha256) {
      assert(mutableFiles.includes(name), 'Unrelated published file changed: ' + name);
      changed.push(name);
    }
  }
  assert.deepEqual(changed.sort(), mutableFiles, 'Unexpected transcript replacement set');
  assert.deepEqual(removed.sort(), removedFiles.sort(), 'Unexpected deleted files');
  const added = Object.keys(files).filter(name => !baseline.files[name]).sort();
  assert.deepEqual(added, addedFiles.sort(), 'Unexpected added files');
  await checkRevisedAssets();
  checkMarkup(read('library/index.html'), read('library/shiur-player.js'), read('library/sw.js'), read('library/divrei16-preview.js'));
  checkShellPreservation(baseline.readerShell, read('library/index.html'), read('library/sw.js'));
  for (const [name, hash] of Object.entries(immutablePins)) assert.equal(files[name]?.sha256, hash, 'Protected asset changed: ' + name);
  const publicFiles = [...new Set([...shellFiles, ...Object.keys(revisedFiles), ...Object.keys(immutablePins)])];
  const report = {
    revision, baselineRun: pin.run, baselineCommit: pin.commit, baselineTreeSha256: pin.treeSha256,
    originalFiles: Object.keys(baseline.files).length, finalFiles: Object.keys(files).length,
    preservedFiles: Object.keys(baseline.files).length - changed.length - removed.length,
    previewPages: previewFiles.length, changed, added, removed,
    files: Object.fromEntries(publicFiles.map(name => [name, files[name]]))
  };
  write('divrei16-media-verification.json', report);
  console.log(JSON.stringify(report, null, 2));
} else if (mode === '--live-baseline') {
  await verifyHead();
  await Promise.all(Object.entries(baselinePins).map(async ([name, hash]) => {
    assert.equal(sha256(await liveBytes(name)), hash, 'Live publication changed since the pinned baseline: ' + name);
  }));
  await verifyHead();
  console.log('Current main and all baseline reader, transcript, recording, layout and data fingerprints match.');
} else if (mode === '--live') {
  const expected = JSON.parse(fs.readFileSync('divrei16-media-verification.json', 'utf8'));
  let verified;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const results = await Promise.all(Object.entries(expected.files).map(async ([name, wanted]) => {
        const bytes = await liveBytes(name);
        assert.equal(bytes.length, wanted.bytes, 'Live length mismatch: ' + name);
        assert.equal(sha256(bytes), wanted.sha256, 'Live content mismatch: ' + name);
        return [name, wanted];
      }));
      verified = Object.fromEntries(results);
      break;
    } catch (error) {
      if (attempt === 6) throw error;
      console.log('Waiting for the published asset refresh (' + attempt + '/6): ' + error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  write('divrei16-media-live-verification.json', {revision, verifiedAt: new Date().toISOString(), files: verified});
  console.log('Verified the formatted PDF and Word transcript, all twelve preview pages, reader metadata, and unchanged recording, responsive layout and data manifests.');
} else {
  throw new Error('Choose --metadata, --input-files, --verify-inputs, --capture, --verify, --live-baseline, or --live.');
}
