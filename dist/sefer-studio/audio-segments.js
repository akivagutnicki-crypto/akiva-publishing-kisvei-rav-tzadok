'use strict';

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.';
const SCRIPT_INTEGRITY = 'sha384-sKfkiFtvUk+vexk+0EUhEh366190/4WpgUAsUvaxEfyg7+E1Zt5Y5hrsU808g8Q9';
const WASM_INTEGRITY = 'sha384-U1VDhkPYrM3wTCT4/vjSpSsKqG/UjljYrYCI4hBSJ02svbCkxuCi6U6u/peg5vpW';
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const SEGMENT_SECONDS = 240;
const output = '/segment.wav';
let core, input;

async function download(extension, integrity) {
  const response = await fetch(CORE + extension, { integrity, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('The audio decoder could not be downloaded. Check your connection and try again.');
  return response.arrayBuffer();
}

async function open(file) {
  const [script, wasmBinary] = await Promise.all([
    download('js', SCRIPT_INTEGRITY), download('wasm', WASM_INTEGRITY),
  ]);
  const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
  try {
    importScripts(url);
    core = await self.createFFmpegCore({ wasmBinary });
  } finally {
    URL.revokeObjectURL(url);
  }
  const name = 'recording.' + file.name.toLowerCase().split('.').pop();
  input = '/source/' + name;
  core.FS.mkdir('/source');
  // WORKERFS reads ranges of the original File without copying it into WASM memory.
  core.FS.mount(core.FS.filesystems.WORKERFS, { blobs: [{ name, data: file }] }, '/source');
}

function pcmLength(bytes) {
  if (bytes.length < 12) throw new Error('The audio decoder did not produce a valid WAV segment.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 12; i + 8 <= bytes.length;) {
    const size = view.getUint32(i + 4, true);
    if (view.getUint32(i) === 0x64617461 && size <= bytes.length - i - 8) return size;
    i += 8 + size + (size % 2);
  }
  throw new Error('The audio decoder did not produce a valid WAV segment.');
}

function segment(index) {
  const offset = index * SEGMENT_SECONDS;
  try {
    const code = core.exec('-loglevel', 'error', '-protocol_whitelist', 'file',
      '-ss', String(offset), '-i', input, '-t', String(SEGMENT_SECONDS),
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
      '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', output);
    if (code !== 0) throw new Error('This recording could not be decoded. Try saving it as MP3, M4A, or WAV.');
    const bytes = core.FS.readFile(output);
    const pcmBytes = pcmLength(bytes);
    // Some codecs start a few milliseconds late after seeking, even before EOF.
    const last = pcmBytes < (SEGMENT_SECONDS - 1) * SAMPLE_RATE * BYTES_PER_SAMPLE;
    if (pcmBytes === 0) return { offset, last: true };
    return { offset, last, bytes };
  } finally {
    if (core.FS.analyzePath(output).exists) core.FS.unlink(output);
    core.reset();
  }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.file) {
      await open(data.file);
      self.postMessage({ ready: true });
      return;
    }
    const result = segment(data.index);
    self.postMessage(result, result.bytes ? [result.bytes.buffer] : []);
  } catch (error) {
    self.postMessage({ error: error instanceof TypeError
      ? 'The audio decoder could not be loaded. Check your connection and try again.'
      : error.message || 'The recording could not be prepared.' });
  }
};
