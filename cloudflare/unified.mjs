import { HttpProblem, deadline, json, parseAllowedOrigins, readBoundedText, responseHeaders } from './ocr.mjs';
import audio, { audioUrl } from './audio.mjs';
import { runDesign } from './design.mjs';
import { runAssistant } from './assistant.mjs';
import ocr from './provider-ocr.mjs';

const tokenPattern = /^sfpro_[0-9a-f]{64}$/;
const adminPath = '/v1/admin/keys';
const apiPaths = new Set(['/v1/health', '/v1/audio', '/v1/transcribe', '/v1/ocr', '/v1/ocr/json', '/v1/nikkud', '/v1/audio-link', '/v1/design', '/v1/assistant']);
const sizeLimit = 26 * 1024 * 1024;
const problem = (status, code, message) => new HttpProblem(status, code, message);
const bad = (message) => problem(400, 'invalid_request', message);
const invalid = () => problem(401, 'invalid_key', 'Enter an active SoferStudio key (sfpro_…).');
const unavailable = (message) => problem(503, 'not_configured', message);
const hex = (bytes) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const hash = async (value) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

export function handlesUnifiedPath(path) {
  return apiPaths.has(path) || path === adminPath || path.startsWith(adminPath + '/');
}

export class SoferKeyStore {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS keys (
      digest TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      created INTEGER NOT NULL, revoked INTEGER, requests INTEGER NOT NULL DEFAULT 0
    )`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created)');
  }
  async fetch(request) {
    const action = new URL(request.url).pathname;
    const data = await request.json();
    const rows = (...args) => this.sql.exec(...args).toArray();
    if (action === '/validate') {
      const valid = rows('UPDATE keys SET requests = requests + 1 WHERE digest = ? AND revoked IS NULL RETURNING id', data.digest);
      return Response.json({ valid: valid.length === 1 });
    }
    if (action === '/job-record') {
      this.sql.exec('DELETE FROM jobs WHERE created < ?', Date.now() - 30 * 86400_000);
      this.sql.exec('INSERT INTO jobs (id, owner, created) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING', data.id, data.owner, Date.now());
      return Response.json({ recorded: true });
    }
    if (action === '/job-read') {
      const allowed = rows('SELECT 1 FROM jobs WHERE id = ? AND owner = ? AND created >= ?', data.id, data.owner, Date.now() - 30 * 86400_000);
      return Response.json({ allowed: allowed.length === 1 });
    }
    if (action === '/mint') {
      this.sql.exec('INSERT INTO keys (digest, id, label, created) VALUES (?, ?, ?, ?)', data.digest, data.id, data.label, Date.now());
      return Response.json({ id: data.id, label: data.label }, { status: 201 });
    }
    if (action === '/list') {
      const keys = rows('SELECT id, label, created, revoked, requests FROM keys ORDER BY created DESC LIMIT 500');
      return Response.json({ keys });
    }
    if (action === '/revoke') {
      const revoked = rows('UPDATE keys SET revoked = ? WHERE id = ? AND revoked IS NULL RETURNING id', Date.now(), data.id);
      return Response.json({ revoked: revoked.length === 1 });
    }
    return Response.json({ error: 'Unknown operation.' }, { status: 404 });
  }
}

async function keyStore(env, action, data = {}) {
  const store = env.SOFER_KEY_STORE;
  if (!store) throw unavailable('The SoferStudio key store is not configured.');
  const response = await store.get(store.idFromName('production')).fetch('https://keystore.invalid/' + action, {
    method: 'POST', body: JSON.stringify(data),
  });
  if (!response.ok) throw unavailable('The SoferStudio key store is unavailable.');
  return response.json();
}

async function authorize(request, env) {
  const found = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!found || !tokenPattern.test(found[1])) throw invalid();
  const digest = await hash(found[1]);
  const bootstrap = (env.SOFERSTUDIO_API_KEY_HASHES || '').split(',').map(value => value.trim());
  if (bootstrap.includes(digest)) return digest;
  if (!(await keyStore(env, 'validate', { digest })).valid) throw invalid();
  return digest;
}

async function admin(request, env, path) {
  const expected = env.SOFERSTUDIO_ADMIN_KEY;
  if (!expected || expected.length < 32) throw unavailable('SOFERSTUDIO_ADMIN_KEY is not configured.');
  const supplied = request.headers.get('X-Admin-Key') || '';
  const [givenHash, adminHash] = await Promise.all([hash(supplied), hash(expected)]);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= givenHash.charCodeAt(i) ^ adminHash.charCodeAt(i);
  if (diff !== 0) throw problem(403, 'invalid_admin_key', 'Admin key rejected.');
  if (path === adminPath && request.method === 'GET') return json(await keyStore(env, 'list'), 200);
  if (path === adminPath && request.method === 'POST') {
    const data = await parseBody(request, 2048);
    if (typeof data.label !== 'string' || !data.label.trim() || data.label.length > 120) throw bad('Enter a key label of 1–120 characters.');
    const key = 'sfpro_' + hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const info = await keyStore(env, 'mint', { digest: await hash(key), id: crypto.randomUUID(), label: data.label.trim() });
    return json({ ...info, key }, 201);
  }
  if (path.startsWith(adminPath + '/') && request.method === 'DELETE') {
    const id = path.slice(adminPath.length + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Use the issued key ID.');
    const result = await keyStore(env, 'revoke', { id });
    return json(result, result.revoked ? 200 : 404);
  }
  return json({ error: 'Use GET or POST on the key collection, or DELETE on one key.' }, 405);
}

async function boundedBytes(request, cap, signal, error) {
  const reader = request.body?.getReader();
  if (!reader) throw bad('A request body is required.');
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    let size = 0;
    const chunks = [];
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > cap) throw error;
      chunks.push(value);
    }
    return new Blob(chunks);
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

const toBase64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  const parts = [];
  for (let i = 0; i < bytes.length; i += 24_576) parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24_576))));
  return parts.join('');
};

async function parseBody(request, cap = sizeLimit) {
  const type = request.headers.get('Content-Type') || '';
  const oversized = problem(413, 'body_too_large', 'The uploaded source is too large.');
  if (Number(request.headers.get('Content-Length')) > cap) throw oversized;
  if (!['', 'identity'].includes(request.headers.get('Content-Encoding') || '')) throw bad('Send uncompressed JSON or multipart form data.');
  const timeout = deadline(request.signal, 60_000, problem(408, 'upload_timeout', 'The upload timed out.'), globalThis);
  try {
    if (/^application\/json(?:;|$)/i.test(type)) {
      const body = JSON.parse(await readBoundedText(request.body, cap, timeout.signal, oversized));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Send a JSON object.');
      return body;
    }
    if (/^multipart\/form-data;/i.test(type)) {
      const bytes = await boundedBytes(request, cap, timeout.signal, oversized);
      const form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData();
      const body = Object.fromEntries(form);
      const upload = body.audio_file instanceof File ? body.audio_file : body.file;
      if (upload instanceof File) {
        if (body.audio_file instanceof File) {
          body.audio = await toBase64(upload);
          body.mime = upload.type;
          body.audio_file = undefined;
        } else {
          body.file = await toBase64(upload);
          body.content_type = upload.type;
        }
      }
      return body;
    }
    throw problem(415, 'unsupported_media_type', 'Use application/json or multipart/form-data.');
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    throw bad('The request body could not be parsed.');
  } finally { timeout.close(); }
}

const trustedOrigin = (env, incoming) => {
  const origins = parseAllowedOrigins(env.OCR_ALLOWED_ORIGINS);
  if (incoming && !origins.has(incoming)) throw problem(403, 'origin_not_allowed', 'This browser origin is not allowed.');
  return incoming || origins.values().next().value;
};

const bool = (raw, fallback) => raw === undefined ? fallback : raw === true || raw === 'true';
const audioConfig = (body) => ({
  language: body.language || body.primary_language || 'en',
  format: body.format || ({ he_en: 'both' }[body.hebrew_word_format] ?? body.hebrew_word_format) || 'he',
  speakers: bool(body.speakers ?? body.include_timestamps, true), nikkud: bool(body.nikkud ?? body.add_nikkud, true),
  expand: bool(body.expand ?? body.expand_roshei_teivos, false),
});

function ocrConfig(body) {
  return {
    imageDataUrl: body.imageDataUrl,
    documentDataUrl: typeof body.file === 'string' ? 'data:' + (body.content_type || 'application/pdf') + ';base64,' + body.file : undefined,
    language: body.language || ({ square_hebrew: 'heb', rashi: 'heb_rashi', mixed_tzurat_hadaf: 'heb_rashi' }[body.script_mode]) || 'eng+heb',
    layout: body.layout || ({ two_column_rtl: 'rtl-columns', single_column: 'single', tzurat_hadaf: 'tzurat-hadaf' }[body.layout_mode]) || 'rtl-columns',
    pageNumber: body.pageNumber ?? 1,
    engine: body.engine === 'gemini' ? body.gemini_model || 'gemini-4-neon' : body.engine || 'hybrid',
    soferMode: body.soferMode || body.sofer_ocr_mode || body.mode || 'enhanced',
    nikkud: bool(body.nikkud ?? body.add_nikkud, true), oldPrint: bool(body.oldPrint ?? body.older_print, true),
    ...(body.tiles !== undefined ? { tiles: body.tiles } : {}), ...(body.proofread !== undefined ? { proofread: body.proofread === true } : {}), ...(body.speed !== undefined ? { speed: body.speed } : {}),
  };
}

function requireProviders(env, sofer, gemini) {
  if (sofer && !env.SOFERAI_API_KEY?.trim()) throw unavailable('The server operator must configure SOFERAI_API_KEY.');
  if (gemini && !env.GEMINI_API_KEY?.trim()) throw unavailable('The server operator must configure GEMINI_API_KEY.');
}

function internalRequest(request, origin, body, env) {
  const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json' });
  if (env.SOFERAI_API_KEY) headers.set('X-Sofer-API-Key', env.SOFERAI_API_KEY.trim());
  if (env.GEMINI_API_KEY) headers.set('X-Gemini-API-Key', env.GEMINI_API_KEY.trim());
  if (env.ANTHROPIC_API_KEY) headers.set('X-Anthropic-API-Key', env.ANTHROPIC_API_KEY.trim());
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) headers.set('CF-Connecting-IP', ip);
  return new Request(request.url, { method: 'POST', headers, body: JSON.stringify(body), signal: request.signal });
}

async function runAudio(request, origin, body, env, owner) {
  const soferAction = ['sofer-start', 'sofer-poll'].includes(body.action);
  if (body.action === 'claude-review') {
    if (!env.ANTHROPIC_API_KEY?.trim()) throw unavailable('The server operator must configure ANTHROPIC_API_KEY.');
  } else if (body.action === 'whisper') {
    // Workers AI: no provider key
  } else if (!soferAction && ['nikkud', 'expand', 'translate'].includes(body.action) && env.ANTHROPIC_API_KEY?.trim()) {
    // Claude does the text passes when it is configured
  } else requireProviders(env, soferAction, !soferAction);
  if (body.action === 'sofer-poll' && !(await keyStore(env, 'job-read', { id: String(body.id || '').slice(0, 36), owner })).allowed) {
    throw problem(404, 'job_not_found', 'No recent transcription matches this key and job ID.');
  }
  const response = await audio.fetch(internalRequest(request, origin, body, env), env);
  if (response.ok && body.action === 'sofer-start') {
    const { id } = await response.clone().json();
    await keyStore(env, 'job-record', { id, owner });
  }
  return response;
}

async function audioResult(request, origin, body, env, owner) {
  const result = await runAudio(request, origin, body, env, owner);
  const data = await result.json();
  if (!result.ok) throw problem(result.status, data.code || 'audio_failed', data.error || 'Audio processing failed.');
  return data;
}

async function transcribe(request, origin, body, env, owner) {
  const config = audioConfig(body);
  const engine = body.engine || 'hybrid';
  if (!['claude', 'whisper-claude', 'sofer', 'hybrid', 'gemini', 'gemini-4-neon', 'gemini-4-carbon'].includes(engine)) throw bad('Unknown transcription engine.');
  const source = { audio: body.audio ?? body.audio_file, mime: body.mime || body.content_type, url: body.url || body.audio_url };
  if (source.url && !['sofer', 'claude'].includes(engine)) throw bad('Audio links use Sofer.Ai. Upload a file to use Gemini or Hybrid.');
  if (engine === 'sofer' || engine === 'claude') {   // claude: the client sends Sofer.Ai's transcript to action claude-review
    const job = await audioResult(request, origin, { ...config, ...source, action: 'sofer-start' }, env, owner);
    return json({ status: 'pending', engine, id: job.id }, 202, request.headers.get('Origin'));
  }
  if (engine === 'whisper-claude') {
    if (source.url) throw bad('Send the recording itself (POST /v1/audio-link downloads a public link for you).');
    const draft = await audioResult(request, origin, { ...config, ...source, action: 'whisper' }, env, owner);
    let text = draft.text, warning;
    if (env.ANTHROPIC_API_KEY?.trim()) {
      try { text = (await audioResult(request, origin, { ...config, whisper: draft.text, action: 'claude-review' }, env, owner)).text; }
      catch (error) { warning = 'Claude review did not finish: ' + error.message; }
    } else warning = 'ANTHROPIC_API_KEY is not configured; showing the Whisper draft.';
    return json({ status: 'completed', engine, text, ...(warning ? { warning } : {}) }, 200, request.headers.get('Origin'));
  }
  if (engine !== 'hybrid') return runAudio(request, origin, { ...config, ...source, action: 'gemini', model: engine === 'gemini' ? body.gemini_model || 'gemini-4-neon' : engine }, env);
  requireProviders(env, true, true);
  // Sofer jobs can take minutes. Return the job ID and Neon draft so clients
  // can resume polling without having to submit the same recording again.
  const [sofer, neon] = await Promise.allSettled([
    audioResult(request, origin, { ...config, ...source, action: 'sofer-start' }, env, owner),
    audioResult(request, origin, { ...config, ...source, action: 'gemini', model: 'gemini-4-neon' }, env, owner),
  ]);
  if (sofer.status === 'rejected' && neon.status === 'rejected') throw sofer.reason;
  return json({
    status: sofer.status === 'fulfilled' ? 'pending' : 'partial', engine, id: sofer.value?.id ?? null,
    neon: neon.value?.text ?? null, errors: [sofer, neon].filter(entry => entry.status === 'rejected').map(entry => entry.reason.message),
  }, sofer.status === 'fulfilled' ? 202 : 200, request.headers.get('Origin'));
}

// A public shiur link: the Worker downloads the recording and streams it back, so the browser splits it and
// Whisper + Claude transcribe it like an upload (no third-party transcription service).
const LINK_MAX = 200 * 1024 * 1024;
async function audioLink(body, incoming) {
  let href;
  try { href = audioUrl(body.url); } catch (error) { throw bad(error.message || 'Enter a public HTTPS audio or shiur link.'); }
  let upstream;
  try { upstream = await fetch(href, { redirect: 'follow', headers: { Accept: 'audio/*,video/*;q=0.8,*/*;q=0.5' } }); }
  catch { throw problem(502, 'link_failed', 'The audio link could not be reached.'); }
  if (!upstream.ok || !upstream.body) throw problem(502, 'link_failed', 'The audio link returned an error (' + upstream.status + ').');
  if (!/^https:/i.test(upstream.url || href)) throw bad('Enter a public HTTPS audio or shiur link.');
  const type = (upstream.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type && !/^(audio|video)\//.test(type) && type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
    throw bad('That link opens a web page, not an audio file. Use the direct link to the recording (.mp3, .m4a …).');
  }
  const size = Number(upstream.headers.get('Content-Length') || 0);
  if (size > LINK_MAX) throw problem(413, 'audio_too_large', 'The recording at this link is over 200 MB.');
  let seen = 0;
  const capped = upstream.body.pipeThrough(new TransformStream({ transform(chunk, ctl) {
    seen += chunk.byteLength;
    if (seen > LINK_MAX) ctl.error(new Error('too large')); else ctl.enqueue(chunk);
  } }));
  const name = decodeURIComponent(new URL(upstream.url || href).pathname.split('/').pop() || 'shiur').slice(0, 120);
  return new Response(capped, { status: 200, headers: responseHeaders(incoming, {
    'Content-Type': type || 'application/octet-stream', ...(size ? { 'Content-Length': String(size) } : {}),
    'X-Audio-Name': encodeURIComponent(name), 'Access-Control-Expose-Headers': 'X-Audio-Name',
  }) });
}

export default async function unified(request, env) {
  const path = new URL(request.url).pathname;
  const incoming = request.headers.get('Origin');
  let origin = null;
  try {
    if (path === adminPath || path.startsWith(adminPath + '/')) {
      // Sefer Pro pages on the allowed origins may mint a key (POST, admin key required); listing and revoking stay direct-only.
      const site = path === adminPath && incoming && parseAllowedOrigins(env.OCR_ALLOWED_ORIGINS).has(incoming) ? incoming : null;
      if (request.method === 'OPTIONS') {
        if (!site) throw problem(403, 'origin_not_allowed', 'This browser origin is not allowed.');
        return new Response(null, { status: 204, headers: responseHeaders(site, {
          'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'X-Admin-Key, Content-Type', 'Access-Control-Max-Age': '600',
        }) });
      }
      if (site && request.method === 'POST') {
        origin = site;
        const limit = await env.STUDIO_RATE_LIMITER?.limit({ key: 'sofer-admin:' + (request.headers.get('CF-Connecting-IP') || 'unknown') });
        if (!limit?.success) throw problem(limit ? 429 : 503, 'rate_limit', 'Too many attempts. Try again later.');
      }
      const response = await admin(request, env, path);
      if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
      return response;
    }
    origin = trustedOrigin(env, incoming);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(incoming, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600',
    }) });
    if (path === '/v1/health' && request.method === 'GET') {
      const authorized = request.headers.has('Authorization') ? Boolean(await authorize(request, env)) : false;
      return json({ ready: Boolean(env.SOFER_KEY_STORE), authorized, providers: { sofer: Boolean(env.SOFERAI_API_KEY), gemini: Boolean(env.GEMINI_API_KEY), claude: Boolean(env.ANTHROPIC_API_KEY), whisper: typeof env.AI?.run === 'function' } }, 200, incoming);
    }
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, incoming);
    const limit = await env.STUDIO_RATE_LIMITER?.limit({ key: 'sofer-unified:' + (request.headers.get('CF-Connecting-IP') || 'unknown') });
    if (!limit?.success) throw problem(limit ? 429 : 503, 'rate_limit', 'The SoferStudio API is busy. Try again later.');
    const owner = await authorize(request, env);
    const body = await parseBody(request);
    if (path === '/v1/audio') return await runAudio(request, origin, body, env, owner);
    if (path === '/v1/audio-link') return await audioLink(body, origin && incoming);
    if (path === '/v1/design') return json(await runDesign(body, env, request.signal), 200, origin && incoming);
    if (path === '/v1/assistant') return json(await runAssistant(body, env, request.signal), 200, origin && incoming);
    if (path === '/v1/transcribe') return await transcribe(request, origin, body, env, owner);
    if (path === '/v1/nikkud') return await runAudio(request, origin, { action: 'nikkud', text: body.text, style: body.style }, env);
    const options = ocrConfig(body);
    if (options.engine === 'akiva') { if (!env.ANTHROPIC_API_KEY?.trim()) throw unavailable('The server operator must configure ANTHROPIC_API_KEY.'); }
    else requireProviders(env, ['sofer', 'hybrid'].includes(options.engine), options.engine !== 'sofer' || options.nikkud);
    return await ocr.fetch(internalRequest(request, origin, options, env), env);
  } catch (error) {
    const issue = error instanceof HttpProblem ? error : unavailable('The SoferStudio API could not complete this request.');
    return json({ error: issue.message, code: issue.code }, issue.status, origin && incoming);
  }
}
