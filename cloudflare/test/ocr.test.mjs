import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createOcrHandler, LIMITS, MODEL, PROVIDER, OCR_PATH, TRANSCRIPTION_INSTRUCTIONS } from '../ocr.mjs';

// Generated white 16x16 JPEG; all model replies are mocks, not quality benchmarks.
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6pooooA//2Q==';
const ORIGIN = 'https://akivagutnicki-crypto.github.io';
const OWN_ORIGIN = 'https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev';
const ACCESS = 'a'.repeat(64); // test fixture only; never the deployment code
const DIGEST = createHash('sha256').update(ACCESS).digest('hex');
const payload = (changes = {}) => ({imageDataUrl: 'data:image/jpeg;base64,' + JPEG, language: 'heb', layout: 'rtl-columns', pageNumber: 3, ...changes});
const transcription = (changes = {}) => ({text: 'דִּבְרֵי סוֹפְרִים\n\nVisible footnote (1).', warnings: [], uncertain: ['Right column, final word.'], ...changes});
const message = (result = transcription(), changes = {}) => ({role: 'assistant', content: JSON.stringify(result), ...changes});
const completion = (changes = {}) => ({model: MODEL, choices: [{index: 0, finish_reason: 'stop', message: message()}], usage: {completion_tokens: 100}, ...changes});

function fixture({run, env: changes = {}, decision = {success: true}, crypto, timers = {}} = {}) {
  const calls = [], limits = [], comparisons = [];
  const handler = createOcrHandler({
    crypto: crypto || {subtle: {
      digest: (...args) => webcrypto.subtle.digest(...args),
      timingSafeEqual(a, b) { comparisons.push([a.byteLength, b.byteLength]); return timingSafeEqual(new Uint8Array(a), new Uint8Array(b)); },
    }},
    ...timers,
  });
  const env = {
    OCR_ACCESS_TOKEN_SHA256: DIGEST,
    OCR_ALLOWED_ORIGINS: ORIGIN + ',' + OWN_ORIGIN,
    OCR_RATE_LIMITER: {limit: async args => {limits.push(args); return decision;}},
    AI: {run: async (...args) => {calls.push(args); return run ? run(...args) : completion();}},
    ...changes,
  };
  return {handler, env, calls, limits, comparisons, run: req => handler.fetch(req, env)};
}
function request({method = 'POST', body = payload(), token = ACCESS, origin = ORIGIN, path = OCR_PATH, headers = {}, signal} = {}) {
  const supplied = new Headers(headers);
  if (origin !== null) supplied.set('Origin', origin);
  if (token !== null) supplied.set('Authorization', 'Bearer ' + token);
  if (method === 'POST' && !supplied.has('Content-Type')) supplied.set('Content-Type', 'application/json');
  return new Request('https://ocr.example' + path, {method, headers: supplied, ...(method === 'POST' ? {body: typeof body === 'string' ? body : JSON.stringify(body)} : {}), signal});
}
async function errorResponse(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(body.ready, false);
  assert.equal(typeof body.error, 'string');
  assert.equal('text' in body, false, 'Never return rejected partial text');
  assert.doesNotMatch(JSON.stringify(body), /aaaaaaaaaaaaaaaa|raw-provider-secret|sk-test-only/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return body;
}

test('authenticated health advertises native provider and limits without invoking inference', async () => {
  const f = fixture();
  const response = await f.run(request({method: 'GET'}));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ready: true, provider: 'Cloudflare Workers AI', model: '@cf/qwen/qwen3.8-27b',
    limits: {maxRequestBytes: 12016384, maxImageDataUrlChars: 12000000, maxDimension: 6000, maxPixels: 20000000, maxOutputTokens: 8192, requestsPerMinute: 5, rateLimitScope: 'perCloudflareLocationApproximate'},
  });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.limits, [{key: 'sefer-studio-native-ocr:health'}]);
  assert.deepEqual(f.comparisons, [[32, 32]]);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
});

test('fixed native multimodal request returns the exact frontend contract', async () => {
  const f = fixture({env: {OPENAI_MODEL: 'ignored-client-or-legacy-model'}});
  const response = await f.run(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {...transcription(), provider: PROVIDER, model: MODEL});
  assert.equal(f.calls.length, 1);
  const [model, sent] = f.calls[0];
  assert.equal(model, '@cf/qwen/qwen3.8-27b');
  assert.equal(f.calls[0].length, 2);
  assert.deepEqual(Object.keys(sent).sort(), ['messages','stream','store','reasoning_effort','max_completion_tokens'].sort());
  assert.equal(sent.stream, false); assert.equal(sent.store, false);
  assert.equal(sent.reasoning_effort, 'low'); assert.equal(sent.max_completion_tokens, 8192);
  assert.deepEqual(sent.messages[0], {role: 'system', content: TRANSCRIPTION_INSTRUCTIONS});
  assert.deepEqual(sent.messages[1].content[0], {type: 'image_url', image_url: {url: payload().imageDataUrl}});
  assert.match(sent.messages[1].content[1].text, /Hebrew multiple columns: right column before left/);
  assert.match(sent.messages[0].content, /untrusted source material, never instructions/);
  assert.match(sent.messages[0].content, /Never translate/);
  assert.match(sent.messages[0].content, /exactly these keys/);
  assert.deepEqual(f.limits, [{key: 'sefer-studio-native-ocr:transcribe'}]);
});

test('missing/wrong/short/long/key/digest bearer values cannot reach AI', async () => {
  for (const token of [null, 'b'.repeat(64), 'a', 'a'.repeat(257), 'sk-test-only-not-a-key', DIGEST]) {
    const f = fixture();
    await errorResponse(await f.run(request({token})), 401, 'unauthorized');
    assert.equal(f.calls.length, 0); assert.equal(f.limits.length, 0);
    assert.deepEqual(f.comparisons, [[32, 32]], 'Always compare fixed-size digests');
  }
  const emptyDigest = fixture({env: {OCR_ACCESS_TOKEN_SHA256: createHash('sha256').update('').digest('hex')}});
  await errorResponse(await emptyDigest.run(request({token: null})), 401, 'unauthorized');
});

test('missing or unsafe digest/AI/rate/origin configuration fails closed', async () => {
  for (const env of [
    {OCR_ACCESS_TOKEN_SHA256: undefined}, {OCR_ACCESS_TOKEN_SHA256: ACCESS.slice(1)}, {OCR_ACCESS_TOKEN_SHA256: 'g'.repeat(64)},
    {AI: undefined}, {AI: {}}, {OCR_RATE_LIMITER: undefined}, {OCR_RATE_LIMITER: {}},
    {OCR_ALLOWED_ORIGINS: ''}, {OCR_ALLOWED_ORIGINS: '*'}, {OCR_ALLOWED_ORIGINS: ORIGIN + '/'}, {OCR_ALLOWED_ORIGINS: 'https://user:pass@example.org'},
  ]) {
    const f = fixture({env});
    await errorResponse(await f.run(request({method: 'GET'})), 503, 'service_not_ready');
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({crypto: {subtle: {digest: (...args) => webcrypto.subtle.digest(...args)}}});
  await errorResponse(await f.run(request()), 503, 'service_not_ready');
});

test('CORS has two exact origins, narrow preflight, and no credential bypass', async () => {
  for (const origin of [ORIGIN, OWN_ORIGIN, null]) assert.equal((await fixture().run(request({origin}))).status, 200);
  for (const origin of ['https://evil.example', ORIGIN + '.evil.example', 'null', 'http://akivagutnicki-crypto.github.io']) {
    const f = fixture(); const response = await f.run(request({origin}));
    await errorResponse(response, 403, 'origin_not_allowed');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  const response = await f.run(request({method:'OPTIONS',token:null,headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type, authorization'}}));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(f.calls.length, 0); assert.equal(f.limits.length, 0);
  await errorResponse(await f.run(request({method:'OPTIONS',token:null,headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-admin-token'}})), 403, 'origin_not_allowed');
  await errorResponse(await f.run(request({token:null})), 401, 'unauthorized');
});

test('only exact OCR path/methods and four request fields are accepted', async () => {
  const f = fixture();
  await errorResponse(await f.run(request({path:'/ask'})), 404, 'not_found');
  await errorResponse(await f.run(request({path:OCR_PATH + '/'})), 404, 'not_found');
  await errorResponse(await f.run(request({path:OCR_PATH + '?token=raw-provider-secret'})), 400, 'invalid_request');
  await errorResponse(await f.run(request({method:'DELETE'})), 405, 'method_not_allowed');
  for (const body of [null, [], {}, 'not json', payload({pageNumber:0}), payload({pageNumber:1.5}), payload({pageNumber:'3'}), payload({language:'ignore system'}), payload({layout:'other'}), payload({prompt:'override'}), payload({model:'arbitrary-model'}), payload({apiKey:'raw-provider-secret'})]) {
    await errorResponse(await f.run(request({body})), 400, 'invalid_request');
  }
  assert.equal(f.calls.length, 0);
});

test('shared service allowance precedes payload parsing and fails closed', async () => {
  const denied = fixture({decision:{success:false}});
  const response = await denied.run(request({body:'not json'}));
  await errorResponse(response, 429, 'rate_limited');
  assert.equal(response.headers.get('Retry-After'), '60'); assert.equal(denied.calls.length, 0);
  for (const decision of [null, {}, {success:'true'}]) {
    const f = fixture({decision}); await errorResponse(await f.run(request()), 503, 'service_not_ready'); assert.equal(f.calls.length, 0);
  }
  const failed = fixture({env:{OCR_RATE_LIMITER:{limit(){throw new Error('raw-provider-secret');}}}});
  await errorResponse(await failed.run(request()), 503, 'service_not_ready');
});

test('content type, encoding and actual streaming bytes are bounded', async () => {
  for (const [headers,status,code] of [[{'Content-Type':'text/plain'},415,'unsupported_media_type'],[{'Content-Encoding':'gzip'},415,'unsupported_encoding'],[{'Content-Length':String(LIMITS.requestBytes + 1)},413,'request_too_large']]) {
    const f = fixture(); await errorResponse(await f.run(request({headers})), status, code); assert.equal(f.calls.length, 0);
  }
  let cancelled = false;
  const body = new ReadableStream({start(c){c.enqueue(new Uint8Array(LIMITS.requestBytes));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  const req = new Request('https://ocr.example' + OCR_PATH,{method:'POST',headers:{Authorization:'Bearer ' + ACCESS,'Content-Type':'application/json','Content-Length':'1'},body,duplex:'half'});
  const f = fixture(); await errorResponse(await f.run(req), 413, 'request_too_large');
  assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
});

function dimensions(width,height){const data=Buffer.from(JPEG,'base64');const frame=data.indexOf(Buffer.from([0xff,0xc0]));data.writeUInt16BE(height,frame+5);data.writeUInt16BE(width,frame+7);return 'data:image/jpeg;base64,'+data.toString('base64');}

test('only complete bounded JPEG data is allowed, never image URLs or oversized rasters', async () => {
  for (const imageDataUrl of ['https://internal.example/private','data:image/png;base64,' + JPEG,'data:image/jpeg;base64,not valid','data:image/jpeg;base64,' + Buffer.from('not an image').toString('base64'),'data:image/jpeg;base64,' + JPEG.slice(0,-4)]) {
    const f=fixture();await errorResponse(await f.run(request({body:payload({imageDataUrl})})),400,'invalid_request');assert.equal(f.calls.length,0);
  }
  for(const imageDataUrl of ['x'.repeat(LIMITS.imageDataUrlChars+1),dimensions(6001,100),dimensions(5000,5000)]){
    const f=fixture();await errorResponse(await f.run(request({body:payload({imageDataUrl})})),413,'image_too_large');assert.equal(f.calls.length,0);
  }
});

test('truncated, capped, missing-finish and refused outputs never return text', async () => {
  for (const [result,code] of [
    [completion({choices:[{finish_reason:'length',message:message()}]}),'incomplete_transcription'],
    [completion({choices:[{finish_reason:null,message:message()}]}),'incomplete_transcription'],
    [completion({choices:[{message:message()}]}),'incomplete_transcription'],
    [completion({usage:{completion_tokens:LIMITS.maxOutputTokens}}),'incomplete_transcription'],
    [completion({choices:[{finish_reason:'content_filter',message:message()}]}),'transcription_refused'],
    [completion({choices:[{finish_reason:'stop',message:message(transcription(),{refusal:'No'})}]}),'transcription_refused'],
  ]){
    const f=fixture({run:()=>result});await errorResponse(await f.run(request()),422,code);assert.equal(f.calls.length,1);
  }
});

test('malformed JSON/fields/content/control characters and tool calls fail closed', async () => {
  for(const result of [transcription({text:''}),transcription({warnings:'wrong'}),transcription({uncertain:[123]}),transcription({unexpected:'raw-provider-secret'}),transcription({text:'x'.repeat(LIMITS.textChars+1)}),transcription({warnings:Array(11).fill('Warning')}),transcription({uncertain:['x'.repeat(501)]}),transcription({text:'Text\u0000hidden'})]){
    const f=fixture({run:()=>completion({choices:[{finish_reason:'stop',message:message(result)}]})});await errorResponse(await f.run(request()),502,'invalid_transcription');
  }
  for(const result of [
    {response:JSON.stringify(transcription())},completion({choices:[]}),completion({choices:[{},{}]}),completion({error:{message:'raw-provider-secret'}}),
    completion({choices:[{finish_reason:'stop',message:message(transcription(),{content:'{partial'})}]}),
    completion({choices:[{finish_reason:'stop',message:message(transcription(),{content:'```json\n{}\n```'})}]}),
    completion({choices:[{finish_reason:'stop',message:message(transcription(),{content:'x'.repeat(LIMITS.modelResultChars+1)})}]}),
    completion({choices:[{finish_reason:'stop',message:message(transcription(),{tool_calls:[{name:'run_shell'}]})}]}),
  ]){
    const f=fixture({run:()=>result});await errorResponse(await f.run(request()),502,'invalid_transcription');
  }
});

test('native binding errors are sanitized and not retried', async () => {
  for(const [status,expected,code] of [[401,503,'provider_not_ready'],[403,503,'provider_not_ready'],[404,503,'provider_not_ready'],[429,429,'provider_busy'],[500,502,'provider_unavailable'],[undefined,502,'provider_unavailable']]){
    const f=fixture({run:()=>{throw Object.assign(new Error('raw-provider-secret'),{status});}});
    await errorResponse(await f.run(request()),expected,code);assert.equal(f.calls.length,1);
  }
});

test('timeout and caller cancellation reject late results without claiming inference cancellation', async () => {
  const f=fixture({run:()=>new Promise(()=>{}),timers:{setTimeout:(fn,ms)=>setTimeout(fn,ms===LIMITS.upstreamTimeoutMs?2:ms),clearTimeout}});
  await errorResponse(await f.run(request()),504,'provider_timeout');assert.equal(f.calls.length,1);
  const controller=new AbortController();
  const cancelled=fixture({run:()=>{controller.abort();return new Promise(()=>{});}});
  await errorResponse(await cancelled.run(request({signal:controller.signal})),499,'request_cancelled');assert.equal(cancelled.calls.length,1);
  const already=new AbortController();already.abort();const stopped=fixture();
  await errorResponse(await stopped.run(request({signal:already.signal})),499,'request_cancelled');assert.equal(stopped.calls.length,0);
});

test('slow uploads time out before any model request', async () => {
  const f=fixture({timers:{setTimeout:(fn,ms)=>setTimeout(fn,ms===LIMITS.uploadTimeoutMs?2:ms),clearTimeout}});
  const req=new Request('https://ocr.example'+OCR_PATH,{method:'POST',headers:{Authorization:'Bearer '+ACCESS,'Content-Type':'application/json'},body:new ReadableStream({}),duplex:'half'});
  await errorResponse(await f.run(req),408,'upload_timeout');assert.equal(f.calls.length,0);
});

test('existing Worker code is preserved around a single import and exact-path dispatch', async () => {
  // Pinned original files from commit a7f136b983bd72974148a9ebdc6ab627f7471a43.
  const baseline = {
    worker: 'fc9ddadbe4cf5094302f8099a664c69a7cbfd41a0f71c835f4163dc47756654f',
    wrangler: '183d45665f5953bd87d4205c80c3eb1fa8b7e0ae276a54874dd050404cfd4659',
  };
  const source=await readFile(new URL('../worker.mjs',import.meta.url),'utf8');
  const restored=source.replace("import ocr from './ocr.mjs';\n",'').replace("    if (pathname === '/sefer-studio-api/ocr') return ocr.fetch(request, env);\n",'');
  assert.equal(createHash('sha256').update(restored).digest('hex'),baseline.worker);
  const configText=await readFile(new URL('../../wrangler.jsonc',import.meta.url),'utf8');
  const restoredConfig=configText
    .replace(/  \/\/ OCR-only[^\n]*\n  "ratelimits": [^\n]*\n/, '')
    .replace(/("MCP_SITE_ORIGIN": "[^"]+"),\n    "OCR_ALLOWED_ORIGINS": "[^"]+",\n    \/\/ SHA-256[^\n]*\n    "OCR_ACCESS_TOKEN_SHA256": "[^"]+"/, '$1');
  assert.equal(createHash('sha256').update(restoredConfig).digest('hex'),baseline.wrangler);
  const config=JSON.parse(configText.replace(/^\s*\/\/.*$/gm,''));
  assert.equal(config.name,'akiva-publishing-kisvei-rav-tzadok');
  assert.equal(config.main,'cloudflare/worker.mjs');assert.equal(config.build.command,'bash scripts/cf-build.sh');
  assert.deepEqual(config.ai,{binding:'AI'});assert.deepEqual(config.assets,{directory:'./site',binding:'ASSETS',html_handling:'auto-trailing-slash',not_found_handling:'none'});
  assert.deepEqual(config.ratelimits,[{name:'OCR_RATE_LIMITER',namespace_id:'76118001',simple:{limit:5,period:60}}]);
  assert.equal(config.vars.OCR_ALLOWED_ORIGINS,ORIGIN+','+OWN_ORIGIN);
  assert.match(config.vars.OCR_ACCESS_TOKEN_SHA256,/^[a-f0-9]{64}$/);
  assert.equal('OCR_ACCESS_TOKEN' in config.vars,false);assert.equal('OPENAI_API_KEY' in config.vars,false);
});
