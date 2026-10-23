// Publish only the Share controls over the exact current deployed publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ADDED_FILES, SHELL_FILES, SHARE_REVISION, transformShell} from './apply-share.mjs';

const repo = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const site = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const pin = {
  run: 39893706860,
  publishJob: 120219124815,
  artifact: 12476101114,
  commit: '0bfa1d224c85355f4697b5f96bf869beb693b6ee',
  bytes: 716846314,
  digest: 'sha256:fdf129c1c0a37041e604c7e354c9cebe1ab7b72645f26eec8414ca52f71a4779',
  fileCount: 5127,
  treeSha256: 'c59c5d1004d2dc9a77edeaa55be353cb0d7cf9dec5ffa9248800198d9394e07a'
};
const baselinePins = {
  'index.html': '057f1542390f3c87c2de95be7a6f4db560d634a54b98ef99dc3bdfa113cf3025',
  'library/index.html': '79d93276dfa331a47ba4d69495656e8e26ecccf6bce81f5aff6b04b7641b3f42',
  'library/sw.js': '5f5fa24238a5decf4cd6e2b9cc489544c0e1dca0a59cd91e762816afbcb72aa6',
  'library/manifest.webmanifest': '66ad511e373d33176d00547a09505bb9073b7f3a34e4541934e7f5e55b105eb0',
  'library/responsive-ui.css': '1fdea78dd59333ee54a1507423f3534a16fa92ad04e99422fce5a72aad6534a6',
  'library/responsive-ui.js': '5ccd6cc6472342181539633865b2ef05e57e4ed0496cff3f0b46025242d10955',
  'library/shiur-player.js': 'c82c09f4e2c076964f80a30432eaf68ef8765393742b03570fbd71773fa5986a',
  'library/divrei16-preview.js': 'b4416700f07eab124dc1d9c6a82584c35f1754c29c19e5f08b190df8a7a05eae',
  'library/data/files.json': 'a502b61b9cdb178e7e66b20d85eb5c450037914b9b7d5e081740b4e7086fc4b2',
  'library/data/catalog.json': '31f6d708770ab237927a1b65bc5de8544c8f8da08a4926881cb23e90878ecb9f',
  'library/downloads/divrei-soferim-ois-16-lech-lecha-shiur.docx': 'a2a479089371774f8caf96711fc33919438b446896238c75bdf6550e894ad104',
  'library/downloads/divrei-soferim-ois-16-lech-lecha-shiur.pdf': '7faa3402d602baa55bae91ba43b7ef1e708a9a1df3a7dfaff153586f8637bb3a',
  'library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-01.webp': 'bb54c697a6cf15d7f204073c7046ef5b1bb015aa0bddddef91229d28132061d2',
  'library/downloads/divrei-soferim-ois-16-lech-lecha-preview/page-12.webp': '4c6b88b4e8e639a2ea8647e8beac106fc9e35e786a7082fbeae7b27ad2353ded',
  'library/audio/divrei-soferim-ois-16-lech-lecha.m4a': 'cf22dfd478139fe5b8f73cbf97ddf84ca0f824b72efb6e3e4ece9fc947c49fd1'
};
assert.equal(SHARE_REVISION, '20261022-share-v1');
assert.deepEqual([...ADDED_FILES].sort(), ['library/open/index.html', 'library/share.css', 'library/share.js']);
assert.deepEqual([...SHELL_FILES].sort(), ['index.html', 'library/index.html', 'library/sw.js']);
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  assert(process.argv[at + 1] && !process.argv[at + 1].startsWith('--'), 'Missing value for ' + name);
  return process.argv[at + 1];
};
const root = option('--root', 'dist');
const recordFile = option('--record', 'share-release-baseline.json');
const inputFile = option('--inputs', 'share-release-inputs.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const treeHash = files => sha256(JSON.stringify(Object.keys(files).sort().map(name => [name, files[name].sha256])));

async function fileRecord(file) {
  assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'Unsafe file: ' + file);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) { bytes += chunk.length; hash.update(chunk); }
  return {bytes, sha256: hash.digest('hex')};
}

async function inventory(directory = root, relative = '', files = {}) {
  for (const entry of fs.readdirSync(path.join(directory, relative), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    assert(!entry.isSymbolicLink(), 'Unexpected publication symlink: ' + name);
    if (entry.isDirectory()) await inventory(directory, name, files);
    else {
      assert(entry.isFile(), 'Unexpected publication special file: ' + name);
      files[name] = await fileRecord(path.join(directory, name));
    }
  }
  return files;
}

async function githubGet(route) {
  const headers = {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const response = await fetch('https://api.github.com/repos/' + repo + route,
    {headers, signal: AbortSignal.timeout(30000)});
  assert(response.ok, 'GitHub metadata request failed (' + response.status + '): ' + route);
  return response.json();
}

async function verifyHead() {
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/, 'The release commit SHA is required');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Only main may publish Share controls');
  const head = await githubGet('/git/ref/heads/main');
  assert.equal(head.object.sha, process.env.GITHUB_SHA, 'Main advanced; preserve the intervening work and stop');
}

async function liveBytes(name) {
  const url = new URL(name, site);
  url.searchParams.set('share-release-check', String(Date.now()));
  const response = await fetch(url, {cache: 'no-store', headers: {'Cache-Control': 'no-cache'},
    signal: AbortSignal.timeout(45000)});
  assert(response.ok, 'Public asset request failed (' + response.status + '): ' + name);
  return Buffer.from(await response.arrayBuffer());
}

function removeOneMarkedBlock(text, start, end, expected) {
  assert.equal(text.split(start).length - 1, 1, 'Unexpected Share block count');
  assert.equal(text.split(end).length - 1, 1, 'Unexpected Share end marker count');
  const first = text.indexOf(start), last = text.indexOf(end, first) + end.length;
  assert(last >= first + start.length + end.length, 'Malformed Share block');
  // Accommodate only an inserted adjacent newline, never other original bytes.
  for (const before of [0, 1]) for (const after of [0, 1]) {
    if (before && text[first - 1] !== '\n') continue;
    if (after && text[last] !== '\n') continue;
    if (text.slice(0, first - before) + text.slice(last + after) === expected) return;
  }
  assert.fail('Changes exceed the marked Share insertion');
}

function checkShellPreservation(original, name, current) {
  assert.equal(sha256(original), baselinePins[name], 'Unexpected original shell: ' + name);
  assert.equal(current, transformShell(name, original), 'Shell differs from the reviewed Share transform: ' + name);
  assert.equal(transformShell(name, current), current, 'Share transform is not idempotent: ' + name);
  if (name.endsWith('.html')) {
    removeOneMarkedBlock(current, '<!-- akiva-share-start -->', '<!-- akiva-share-end -->', original);
    assert(current.includes('share.js?v=' + SHARE_REVISION), 'Missing versioned Share code: ' + name);
    assert(current.includes('share.css?v=' + SHARE_REVISION), 'Missing versioned Share style: ' + name);
    return;
  }
  const shell = current.match(/const SHELL = `([^`]+)`;/);
  assert(shell, 'Missing app-shell cache name');
  const suffix = '-' + SHARE_REVISION;
  assert.equal(shell[1].split(suffix).length - 1, 1, 'Unexpected Share cache suffix count');
  const normalized = current.replace(shell[0], shell[0].replace(suffix, ''));
  removeOneMarkedBlock(normalized, '// akiva-share-cache-start', '// akiva-share-cache-end', original);
  for (const name of ['share.js', 'share.css']) {
    assert(current.includes('./' + name + '?v=' + SHARE_REVISION), 'Missing Share offline asset: ' + name);
  }
}

function readInputs() {
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  assert.equal(input.revision, SHARE_REVISION);
  assert.deepEqual(Object.keys(input.files).sort(), [...ADDED_FILES].sort());
  return input;
}

const mode = process.argv[2];
if (mode === '--metadata') {
  const [artifact, run, jobs] = await Promise.all([
    githubGet('/actions/artifacts/' + pin.artifact), githubGet('/actions/runs/' + pin.run),
    githubGet('/actions/runs/' + pin.run + '/jobs?filter=latest&per_page=100')
  ]);
  assert.equal(artifact.id, pin.artifact);
  assert.equal(artifact.name, 'github-pages');
  assert.equal(artifact.expired, false, 'Pinned publication archive expired');
  assert.equal(artifact.size_in_bytes, pin.bytes);
  assert.equal(artifact.digest, pin.digest);
  assert.equal(artifact.workflow_run.id, pin.run);
  assert.equal(artifact.workflow_run.head_sha, pin.commit);
  assert.equal(artifact.workflow_run.head_branch, 'main');
  assert.equal(run.head_sha, pin.commit);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  const publication = jobs.jobs.find(job => job.id === pin.publishJob);
  assert(publication && publication.status === 'completed' && publication.conclusion === 'success',
    'Pinned publication job did not complete successfully');
  for (const name of ['Publish the formatted Ois 16 transcript', 'Verify the public transcript and preserved recording and layout']) {
    assert.equal(publication.steps.find(step => step.name === name)?.conclusion, 'success',
      'Baseline publication step did not succeed: ' + name);
  }
  await verifyHead();
  write('share-release-baseline-artifact.json', {pin, artifact,
    run: {id: run.id, head_sha: run.head_sha, conclusion: run.conclusion},
    publication: {id: publication.id, conclusion: publication.conclusion}});
  console.log('Verified the exact current publication artifact and release branch head.');
} else if (mode === '--input-files') {
  const files = {};
  for (const name of ADDED_FILES) files[name] = await fileRecord(path.join(root, name));
  write(inputFile, {revision: SHARE_REVISION, files});
  console.log(JSON.stringify(ADDED_FILES));
} else if (mode === '--capture') {
  const files = await inventory();
  assert.equal(Object.keys(files).length, pin.fileCount, 'Unexpected original publication file count');
  assert.equal(treeHash(files), pin.treeSha256, 'The restored publication is not the exact current file tree');
  for (const [name, hash] of Object.entries(baselinePins)) assert.equal(files[name]?.sha256, hash, 'Wrong baseline: ' + name);
  for (const name of ADDED_FILES) assert(!files[name], 'Share addition unexpectedly exists: ' + name);
  write(recordFile, {pin, files, shells: Object.fromEntries(SHELL_FILES.map(name => [name, read(name)]))});
  console.log('Captured the exact deployed tree: ' + Object.keys(files).length + ' original files.');
} else if (mode === '--verify-shells') {
  const source = option('--baseline-root', null);
  assert(source, '--baseline-root is required');
  for (const name of SHELL_FILES) checkShellPreservation(fs.readFileSync(path.join(source, name), 'utf8'), name, read(name));
  console.log('Only the Share hooks and app-shell cache additions changed in all three original shells.');
} else if (mode === '--verify') {
  const baseline = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  const input = readInputs();
  assert.deepEqual(baseline.pin, pin);
  assert.equal(Object.keys(baseline.files).length, pin.fileCount);
  assert.equal(treeHash(baseline.files), pin.treeSha256);
  const files = await inventory();
  const changed = [];
  for (const [name, expected] of Object.entries(baseline.files)) {
    assert(files[name], 'Unrelated published file removed: ' + name);
    if (files[name].sha256 !== expected.sha256) {
      assert(SHELL_FILES.includes(name), 'Unrelated published file changed: ' + name);
      changed.push(name);
    }
  }
  assert.deepEqual(changed.sort(), [...SHELL_FILES].sort(), 'Unexpected Share shell replacement set');
  const added = Object.keys(files).filter(name => !baseline.files[name]).sort();
  assert.deepEqual(added, [...ADDED_FILES].sort(), 'Unexpected added files');
  for (const name of ADDED_FILES) assert.deepEqual(files[name], input.files[name], 'Share input differs from checked-out source: ' + name);
  for (const name of SHELL_FILES) checkShellPreservation(baseline.shells[name], name, read(name));
  for (const [name, hash] of Object.entries(baselinePins)) {
    if (!SHELL_FILES.includes(name)) assert.equal(files[name].sha256, hash, 'Protected file changed: ' + name);
  }
  const publicFiles = [...new Set([...SHELL_FILES, ...ADDED_FILES, ...Object.keys(baselinePins)])];
  const report = {revision: SHARE_REVISION, baselineRun: pin.run, baselineCommit: pin.commit,
    baselineTreeSha256: pin.treeSha256, publishedTreeSha256: treeHash(files), originalFiles: pin.fileCount,
    finalFiles: Object.keys(files).length, preservedFiles: pin.fileCount - changed.length,
    changed, added, removed: [], files: Object.fromEntries(publicFiles.map(name => [name, files[name]]))};
  write('share-release-verification.json', report);
  console.log(JSON.stringify(report, null, 2));
} else if (mode === '--live-baseline') {
  await verifyHead();
  await Promise.all(Object.entries(baselinePins).map(async ([name, hash]) => {
    assert.equal(sha256(await liveBytes(name)), hash, 'Live publication changed from the pinned baseline: ' + name);
  }));
  await verifyHead();
  console.log('Current main and live website, reader, transcript, recording, layout and data fingerprints match.');
} else if (mode === '--live') {
  const expected = JSON.parse(fs.readFileSync('share-release-verification.json', 'utf8'));
  let verified;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      verified = Object.fromEntries(await Promise.all(Object.entries(expected.files).map(async ([name, wanted]) => {
        const bytes = await liveBytes(name);
        assert.equal(bytes.length, wanted.bytes, 'Public length mismatch: ' + name);
        assert.equal(sha256(bytes), wanted.sha256, 'Public bytes mismatch: ' + name);
        return [name, wanted];
      })));
      break;
    } catch (error) {
      if (attempt === 6) throw error;
      console.log('Waiting for published asset refresh (' + attempt + '/6): ' + error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  write('share-release-live-verification.json', {revision: SHARE_REVISION, verifiedAt: new Date().toISOString(), files: verified});
  console.log('Verified all public Share assets and unchanged reader, transcript, recording, layout and data files.');
} else {
  throw new Error('Choose --metadata, --input-files, --capture, --verify-shells, --verify, --live-baseline or --live.');
}
