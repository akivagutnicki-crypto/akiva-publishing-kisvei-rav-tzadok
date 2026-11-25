// SeferStudio's private, explicitly paired open-tab MCP bridge.
// The public Torah library /mcp is deliberately independent of this module.
// No document, browser credential, or command is returned before session authorization.

// A paired Sefer Pro workspace stays connected for 30 days after it was last open (sliding).
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const PAIR_MS = 10 * 60 * 1000;
const ACCESS_MS = 15 * 60 * 1000;
const AUTH_CODE_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 15000;
const JOB_MS = 30000;
const RESULT_MS = 15 * 60 * 1000;
const MAX_BODY = 262144;
const MAX_IMAGE_BODY = 1572864;
const MAX_IMAGE_BYTES = 1048576;
const MAX_QUEUE = 12;
const MAX_JOBS = 100;
const SCOPES = ['studio:read', 'studio:write'];
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_ID = /^[0-9a-f]{32}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const PAIR_SECRET = /^[A-Za-z0-9_-]{22}$/;
const textEncoder = new TextEncoder();
const now = () => Date.now();
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomSecret = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
const digest = async value => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value))));
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};
const html = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers}});
class StudioError extends Error {
  constructor(message, status = 400, code = 'invalid_request') { super(message); this.status = status; this.code = code; }
}
const fail = (message, status, code) => { throw new StudioError(message, status, code); };
const assert = (condition, message, status = 400, code = 'invalid_request') => { if (!condition) fail(message, status, code); };
const record = x => x && typeof x === 'object' && !Array.isArray(x);

const props = (properties, required = []) => ({type:'object', properties, required, additionalProperties:false});
const string = (maxLength, minLength = 0) => ({type:'string', minLength, maxLength});
const integer = (minimum, maximum = 1000000) => ({type:'integer', minimum, maximum});
const revision = {documentId:string(128,1), expectedRevision:string(128,1)};
const replacement = {...revision, paragraphIndex:integer(0), runIndex:integer(0), expectedText:string(10000), replacementText:string(10000)};
const definitions = [
  ['studio_get_state', 'Inspect the document and PDF metadata in the paired open SeferStudio tab. Does not include document text or OCR output. Returns a job receipt; use studio_get_job for its result.', props({}), false],
  ['studio_read_paragraphs', 'Read up to 30 manuscript paragraphs with stable indices, text runs, document identity and revision, preserving Hebrew. Results are bounded; use studio_get_job.', props({start:integer(0), count:integer(1,30)}), false],
  ['studio_search', 'Find a word or phrase in the open manuscript, with optional Hebrew nikkud-insensitive matching. At most 30 results. Use studio_get_job.', props({query:string(200,1), ignoreNikkud:{type:'boolean'}, limit:integer(1,30)}, ['query']), false],
  ['studio_read_footnotes', 'Read up to ten existing footnotes, including their paragraph/run indices, before editing. Use studio_get_job.', props({ids:{type:'array', minItems:1, maxItems:10, uniqueItems:true, items:string(100,1)}}, ['ids']), false],
  ['studio_replace_text', 'Replace one exact existing text run in the manuscript. Requires the document identity, current revision and entire expected text from a read. Retains formatting and footnote anchors. Reversible; never adds/removes paragraphs. RequestId must be a fresh UUID; reuse it only to retry this identical command.', props({...replacement, requestId:{type:'string',format:'uuid'}}, [...Object.keys(replacement),'requestId']), true],
  ['studio_update_footnote', 'Replace one exact text run in an existing footnote while preserving the note and its anchor. Read the note first. Requires current document identity/revision and exact expected text. RequestId is a UUID for this mutation.', props({...replacement, footnoteId:string(100,1), requestId:{type:'string',format:'uuid'}}, [...Object.keys(replacement),'footnoteId','requestId']), true],
  ['studio_undo', 'Undo a specific most recent bridge edit only if its undoId, document identity and current revision still match. Never overwrites intervening manual edits. Use a unique requestId UUID.', props({...revision, undoId:string(128,1), requestId:{type:'string',format:'uuid'}}, [...Object.keys(revision),'undoId','requestId']), true],
  ['studio_navigate', 'Bring exactly one page, paragraph or existing footnote into view in the paired tab. Does not edit text. Page numbers are 1-based and paragraph indices 0-based. Use studio_get_job.', {...props({page:integer(1),paragraphIndex:integer(0),footnoteId:string(100,1)}),oneOf:[{required:['page']},{required:['paragraphIndex']},{required:['footnoteId']}]}, false],
  ['studio_prepare_export', 'Open the paired app’s DOCX, PDF or HTML export controls. This prepares an export; it does not create or download a finished file. PDF still requires the browser Print/Save as PDF step and final page review. Use studio_get_job.', props({format:{type:'string',enum:['docx','pdf','html']}}), false],
  ['studio_get_pdf_state', 'Inspect the loaded PDF identity, revision, page count, current page and OCR source-page metadata. Does not expose private AI configuration or document images. Use studio_get_job.',props({}),false],
  ['studio_get_pdf_page', 'Read one page of the loaded PDF as a bounded JPEG image for visual inspection or Hebrew transcription. Requires its current documentId. The acknowledged studio_get_job response includes an image, not a finished OCR transcription.',props({documentId:string(128,1),page:integer(1),maxWidth:integer(400,1600)},['documentId','page']),false],
  ['studio_get_ocr_text', 'Read the current PDF OCR editor text (at most 40,000 characters) with document identity, revision and actual source page. Check truncation before proposing an exact edit. Use studio_get_job.',props({}),false],
  ['studio_set_ocr_text', 'Replace the OCR editor text for the current PDF page after visual review. Requires exact complete expectedText, document identity, revision and page. Keeps a reversible OCR-only undo record. Does not rewrite pixels or add a PDF text layer; no OCR provider is invoked. Use a unique requestId UUID.',props({...revision,page:integer(1),expectedText:string(40000),replacementText:string(40000),requestId:{type:'string',format:'uuid'}},[...Object.keys(revision),'page','expectedText','replacementText','requestId']),true],
  ['studio_undo_ocr', 'Undo the latest identified MCP OCR-text edit only while its PDF identity, revision and undoId match. Does not undo manuscript edits. Use a unique requestId UUID.',props({...revision,undoId:string(128,1),requestId:{type:'string',format:'uuid'}},[...Object.keys(revision),'undoId','requestId']),true],
  ['studio_get_job', 'Get the queued/running/completed/error/expired status and acknowledged result of a prior command. A queued receipt is not proof an edit or export finished.', props({jobId:{type:'string',format:'uuid'}}, ['jobId']), false],
];
const mutationNames = new Set(definitions.filter(x => x[3]).map(x => x[0]));
const navigationNames = new Set(['studio_navigate', 'studio_prepare_export']);
export const STUDIO_TOOLS = definitions.map(([name,description,inputSchema,write]) => ({
  name, description, inputSchema,
  annotations:{readOnlyHint:!write && !navigationNames.has(name), destructiveHint:false, idempotentHint:true, openWorldHint:false},
  securitySchemes:[{type:'oauth2', scopes:write ? SCOPES : [SCOPES[0]]}],
  _meta:{securitySchemes:[{type:'oauth2', scopes:write ? SCOPES : [SCOPES[0]]}]},
}));

function validateValue(value, schema, name) {
  if (schema.type === 'string') {
    assert(typeof value === 'string' && value.length >= (schema.minLength || 0) && value.length <= (schema.maxLength || 1000), name + ' must be a bounded string.');
    if (schema.format === 'uuid') assert(UUID.test(value), name + ' must be a UUID.');
    if (schema.enum) assert(schema.enum.includes(value), name + ' has an unsupported value.');
  } else if (schema.type === 'integer') {
    assert(Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum, name + ' is out of range.');
  } else if (schema.type === 'boolean') assert(typeof value === 'boolean', name + ' must be a boolean.');
  else if (schema.type === 'array') {
    assert(Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems, name + ' must be a bounded array.');
    value.forEach((v,i) => validateValue(v,schema.items,name+'['+i+']'));
    if (schema.uniqueItems) assert(new Set(value).size === value.length, name + ' must contain distinct values.');
  }
}

export function validateStudioArguments(name, input) {
  const tool = STUDIO_TOOLS.find(t => t.name === name);
  assert(tool, 'Unknown SeferStudio tool.');
  const args = input === undefined ? {} : input;
  assert(record(args), 'Arguments must be an object.');
  const schema = tool.inputSchema;
  for (const key of Object.keys(args)) {
    assert(Object.hasOwn(schema.properties,key), 'Unknown argument: '+key);
    validateValue(args[key],schema.properties[key],key);
  }
  for (const key of schema.required || []) assert(Object.hasOwn(args,key), 'Missing argument: '+key);
  if (name === 'studio_navigate') assert(Object.keys(args).length === 1, 'Choose exactly one navigation target.');
  const result = Object.fromEntries(Object.keys(args).sort().map(key => [key,args[key]]));
  if (result.requestId) result.requestId = result.requestId.toLowerCase();
  if (result.jobId) result.jobId = result.jobId.toLowerCase();
  if (name === 'studio_read_paragraphs') { result.start ??= 0; result.count ??= 10; }
  if (name === 'studio_search') { result.ignoreNikkud ??= true; result.limit ??= 20; }
  if (name === 'studio_prepare_export') result.format ??= 'pdf';
  if (name === 'studio_get_pdf_page') result.maxWidth ??= 1400;
  return result;
}

async function readBody(request, form = false, maximum = MAX_BODY) {
  const length = Number(request.headers.get('content-length'));
  assert(!length || length <= maximum, 'Request is too large.',413,'request_too_large');
  const chunks = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); fail('Request is too large.',413,'request_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  if (form) return Object.fromEntries(new URLSearchParams(raw));
  let value;
  try { value = JSON.parse(raw); } catch { fail('Request body must be JSON.'); }
  assert(record(value), 'Request body must be an object.');
  return value;
}

const tokenParts = token => {
  const parts = String(token || '').split('.');
  assert(parts.length === 2 && HEX_ID.test(parts[0]) && SECRET.test(parts[1]), 'Authorization is required.',401,'invalid_token');
  return {id:parts[0],secret:parts[1]};
};
const bearer = request => {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('authorization') || '');
  assert(match, 'Authorization is required.',401,'invalid_token');
  return match[1];
};
const resourceUrl = request => new URL('/studio-mcp',request.url).href;
const issuerUrl = request => new URL('/studio-oauth',request.url).href;
const sessionStub = (env,kind,id) => {
  assert(env.STUDIO_SESSIONS, 'The private studio bridge is not deployed yet.',503,'bridge_unavailable');
  return env.STUDIO_SESSIONS.get(env.STUDIO_SESSIONS.idFromName(kind+':'+id));
};
async function internal(env,kind,id,path,body = {}) {
  const response = await sessionStub(env,kind,id).fetch(new Request('https://studio.internal/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
  const data = await response.json();
  if (!response.ok) fail(data.message || 'The studio session could not complete this request.', response.status, data.error || 'session_error');
  return data;
}

function allowedOrigins(request,env) {
  const list = new Set([new URL(request.url).origin]);
  for (const item of String(env.STUDIO_ALLOWED_ORIGINS || env.MCP_SITE_ORIGIN || '').split(',')) {
    try { list.add(new URL(item.trim()).origin); } catch { /* ignore incomplete deployment values */ }
  }
  return list;
}
function cors(request,env) {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins(request,env);
  if (['https://chatgpt.com','https://claude.ai','https://claude.com'].includes(origin)) allowed.add(origin);
  if (origin && !allowed.has(origin)) fail('This origin is not allowed.',403,'origin_denied');
  return { ...(origin ? {'access-control-allow-origin':origin,'vary':'Origin'} : {}), 'access-control-allow-methods':'GET, POST, OPTIONS', 'access-control-allow-headers':'Content-Type, Authorization, Accept, MCP-Protocol-Version, Mcp-Session-Id', 'access-control-expose-headers':'WWW-Authenticate', 'access-control-max-age':'600' };
}
function requireBrowserOrigin(request,env) {
  const origin = request.headers.get('origin');
  assert(origin && allowedOrigins(request,env).has(origin), 'Open this connection from SeferStudio.',403,'origin_denied');
}
async function rateLimit(request,env,label) {
  assert(env.STUDIO_RATE_LIMITER, 'Studio connection rate limiting is not configured.',503,'bridge_unavailable');
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const result = await env.STUDIO_RATE_LIMITER.limit({key:label+':'+ip});
  assert(result.success,'Please wait before creating another connection.',429,'rate_limited');
}

function validRedirect(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search) return false;
    if (url.origin === 'https://chatgpt.com') return url.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]{8,200}$/.test(url.pathname);
    // Claude (claude.ai web, desktop and mobile custom connectors)
    return (url.origin === 'https://claude.ai' || url.origin === 'https://claude.com') && url.pathname === '/api/mcp/auth_callback';
  } catch { return false; }
}
function scopeList(raw) {
  assert(typeof raw === 'string' && raw.length <= 100,'Invalid OAuth scope.');
  const scopes = [...new Set(raw.trim().split(/\s+/).filter(Boolean))].sort();
  assert(scopes.length && scopes.includes('studio:read') && scopes.every(s => SCOPES.includes(s)), 'Only studio:read and studio:write scopes are supported.',400,'invalid_scope');
  return scopes;
}
function consentPage(data,error = '') {
  const edit = data.scopes.includes('studio:write');
  const scopes = edit ? 'Read this open document and make targeted, reversible text edits.' : 'Read this open document. Text editing is disabled.';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Sefer Pro</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#18243a;background:#f2f5fa;margin:0;padding:28px}main{max-width:620px;margin:6vh auto;background:white;border:1px solid #d9e0eb;border-radius:18px;padding:30px}h1{line-height:1.2;font-size:27px}label{display:block;font-weight:650;margin-top:22px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #8996ac;border-radius:6px;font:14px monospace}button{background:#1e40af;color:white;font:600 16px system-ui;border:0;border-radius:7px;padding:12px 18px;margin-top:20px}small{color:#526079}.notice{padding:15px;background:#eef3ff;border-radius:8px}.error{color:#a31926}code{overflow-wrap:anywhere}</style><main><h1>Connect your open Sefer Pro tab to ${html(data.clientName)}</h1><p>This connection grants access only to the tab whose one-time connection code you enter below. Keep that tab open.</p><div class="notice"><b>Requested access</b><br>${html(scopes)}<br><small>Client: ${html(data.clientName)}<br>Return destination: ${html(new URL(data.redirectUri).origin)}<br>Scopes: ${html(data.scopes.join(', '))}</small></div><p>The connection stays active on that computer until you click Disconnect in Sefer Pro, or after 30 days without opening Sefer Pro. While Sefer Pro is closed, Claude is asked to wait until you open it again. Manuscript snippets and command receipts pass through your Cloudflare service while connected; this does not publish your manuscript.</p>${error?'<p class="error">'+html(error)+'</p>':''}<form method="post" action="/studio-oauth/authorize"><input type="hidden" name="request_id" value="${html(data.requestId)}"><input type="hidden" name="csrf" value="${html(data.csrf)}"><label for="pairing">One-time connection code</label><p><small>In Sefer Pro, click “Connect Claude / ChatGPT” in the toolbar, start a connection, then copy the code. ${edit?'Enable text editing there before connecting with write access.':''}</small></p><input id="pairing" name="pairing_code" type="password" autocomplete="off" spellcheck="false" required maxlength="60"><button type="submit">Allow this connection</button></form><p><small>You can revoke access any time with Disconnect in Sefer Pro.</small></p></main></html>`;
}
// same-origin: with no-referrer, browsers send `Origin: null` when the consent form posts back, and the form is refused.
const pageHeaders = cookie => ({'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'",...(cookie?{'set-cookie':cookie}:{})});

async function authorize(request,env) {
  if (request.method === 'GET') {
    await rateLimit(request,env,'authorize');
    const p = Object.fromEntries(new URL(request.url).searchParams);
    assert(p.response_type === 'code', 'Only the authorization-code flow is supported.');
    assert(HEX_ID.test(p.client_id || ''), 'Unknown OAuth client.',400,'invalid_client');
    const client = await internal(env,'client',p.client_id,'client/read');
    assert(client.redirectUris.includes(p.redirect_uri) && validRedirect(p.redirect_uri), 'The callback does not match this client.');
    if (p.resource === undefined) p.resource = resourceUrl(request); // RFC 8707 resource is optional for clients
    assert(p.resource === resourceUrl(request), 'The requested resource is not this studio MCP server.');
    assert(p.code_challenge_method === 'S256' && SECRET.test(p.code_challenge || ''), 'S256 PKCE is required.');
    assert(typeof p.state === 'string' && p.state.length >= 8 && p.state.length <= 512,'A valid OAuth state is required.');
    const scopes = scopeList(p.scope || 'studio:read');
    const csrf = randomSecret();
    const requestId = randomId();
    const data = {requestId, clientId:p.client_id, clientName:client.name, redirectUri:p.redirect_uri, resource:p.resource, state:p.state, challenge:p.code_challenge, scopes, expiresAt:now()+PAIR_MS, csrfHash:await digest(csrf)};
    await internal(env,'auth',requestId,'auth/init',data);
    return new Response(consentPage({...data,csrf}),{headers:pageHeaders('__Host-ss-oauth-'+requestId+'='+csrf+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600')});
  }
  assert(request.method === 'POST','Use GET or POST.',405);
  assert(request.headers.get('origin') === new URL(request.url).origin,'The authorization form must be submitted from this service.',403,'origin_denied');
  const p = await readBody(request,true);
  assert(HEX_ID.test(p.request_id || ''), 'Invalid authorization request.');
  const cookie = new RegExp('(?:^|;\\s*)__Host-ss-oauth-'+p.request_id.toLowerCase()+'=([^;]+)','i').exec(request.headers.get('cookie') || '')?.[1];
  // The per-form cookie is defence in depth only: same-origin Origin (checked above) plus the
  // server-side csrfHash bound to request_id (auth/read below) already stop cross-site posts.
  // Some browsers/profiles drop the cookie, so a missing cookie is allowed; a wrong one is not.
  assert(SECRET.test(p.csrf || '') && (cookie === undefined || equal(p.csrf,cookie)),'The authorization form expired. Open the connection again.',403,'invalid_csrf');
  const data = await internal(env,'auth',p.request_id,'auth/read',{csrfHash:await digest(p.csrf)});
  if (data.consumed) return new Response(null,{status:303,headers:{location:data.redirect,'cache-control':'no-store','referrer-policy':'no-referrer'}});
  const parts = String(p.pairing_code || '').trim().split('.');
  assert(parts.length === 2 && HEX_ID.test(parts[0]) && PAIR_SECRET.test(parts[1]), 'Invalid one-time connection code.');
  let grant;
  try { grant = await internal(env,'session',parts[0],'session/authorize',{...data,pairHash:await digest(parts[1])}); }
  catch (error) {
    if (!(error instanceof StudioError)) throw error;
    return new Response(consentPage({...data,csrf:p.csrf},error.message),{status:error.status,headers:pageHeaders()});
  }
  const destination = new URL(data.redirectUri);
  destination.searchParams.set('code',parts[0]+'.'+grant.code);
  destination.searchParams.set('state',data.state);
  destination.searchParams.set('iss',issuerUrl(request));
  await internal(env,'auth',p.request_id,'auth/consume',{csrfHash:await digest(p.csrf),redirect:destination.href});
  return new Response(null,{status:303,headers:{location:destination.href,'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':'__Host-ss-oauth-'+p.request_id.toLowerCase()+'=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});
}

async function oauthToken(request,env) {
  assert(request.method === 'POST','Use POST.',405);
  const p = await readBody(request,true);
  assert(['authorization_code','refresh_token'].includes(p.grant_type),'Unsupported grant type.',400,'unsupported_grant_type');
  assert(HEX_ID.test(p.client_id || ''),'Unknown OAuth client.',400,'invalid_client');
  const client = await internal(env,'client',p.client_id,'client/read');
  if (p.resource === undefined) p.resource = resourceUrl(request);
  assert(p.resource === resourceUrl(request),'The token resource does not match this studio MCP server.');
  if (p.grant_type === 'authorization_code') {
    assert(validRedirect(p.redirect_uri) && client.redirectUris.includes(p.redirect_uri),'The callback does not match this client.');
    assert(/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier || ''),'A valid PKCE verifier is required.',400,'invalid_grant');
    const parsed = tokenParts(p.code);
    return json(await internal(env,'session',parsed.id,'session/token',{codeHash:await digest(parsed.secret),clientId:p.client_id,redirectUri:p.redirect_uri,resource:p.resource,challenge:await digest(p.code_verifier)}));
  }
  const parsed = tokenParts(p.refresh_token);
  return json(await internal(env,'session',parsed.id,'session/refresh',{refreshHash:await digest(parsed.secret),clientId:p.client_id,resource:p.resource,...(p.scope ? {scopes:scopeList(p.scope)} : {})}));
}

async function browserApi(request,env,path) {
  requireBrowserOrigin(request,env);
  assert(request.method === 'POST','Use POST.',405);
  const body = await readBody(request,false,/\/result$/.test(path) ? MAX_IMAGE_BODY : MAX_BODY);
  if (path === '/studio-api/session/create') {
    await rateLimit(request,env,'create');
    assert(Object.keys(body).every(k => k === 'allowEditing') && (body.allowEditing === undefined || typeof body.allowEditing === 'boolean'),'Invalid session options.');
    const id = randomId(), ownerToken = randomSecret(), pairSecret = randomSecret(16);
    const result = await internal(env,'session',id,'session/init',{id,ownerHash:await digest(ownerToken),pairHash:await digest(pairSecret),allowEditing:body.allowEditing === true,resource:resourceUrl(request),createdAt:now()});
    return json({...result,ownerToken,pairingCode:id+'.'+pairSecret,mcpUrl:resourceUrl(request)},201);
  }
  const match = /^\/studio-api\/session\/([a-f0-9]{32})\/(poll|result|pairing|disconnect)$/.exec(path);
  assert(match,'Unknown studio session route.',404);
  const owner = bearer(request);
  assert(SECRET.test(owner),'Invalid browser connection.',401,'invalid_token');
  const args = {...body,ownerHash:await digest(owner)};
  if (match[2] === 'pairing') {
    const secret = randomSecret(16);
    const data = await internal(env,'session',match[1],'session/pairing',{...args,pairHash:await digest(secret)});
    return json({...data,pairingCode:match[1]+'.'+secret});
  }
  return json(await internal(env,'session',match[1],'session/'+match[2],args));
}

const rpcError = (id,code,message) => ({jsonrpc:'2.0',id:id ?? null,error:{code,message}});
async function mcp(request,env) {
  assert(request.method === 'POST','SeferStudio MCP uses JSON-RPC POST requests.',405);
  const msg = await readBody(request);
  assert(msg.jsonrpc === '2.0' && typeof msg.method === 'string','Expected JSON-RPC 2.0.');
  const version = request.headers.get('mcp-protocol-version');
  assert(!version || VERSIONS.includes(version),'Unsupported MCP protocol version.');
  if (msg.id === undefined && msg.method.startsWith('notifications/')) return new Response(null,{status:202});
  assert(typeof msg.id === 'string' || typeof msg.id === 'number','A JSON-RPC request id is required.');
  const response = result => json({jsonrpc:'2.0',id:msg.id,result});
  if (msg.method === 'initialize') return response({protocolVersion:VERSIONS.includes(msg.params?.protocolVersion)?msg.params.protocolVersion:VERSIONS[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'sefer-studio',version:'1.0.0'},instructions:'Work only in the explicitly paired open SeferStudio tab. Read the document identity and revision before edits. Use exact text preimages, never structural edits. Every command returns a job id; use studio_get_job and verify completed acknowledgments before claiming success. Prepare export only opens browser controls; do not claim a PDF was generated. Disconnected or expired tabs cannot execute commands.'});
  if (msg.method === 'ping') return response({});
  if (msg.method === 'tools/list') return response({tools:STUDIO_TOOLS});
  if (['resources/list','resources/templates/list','prompts/list'].includes(msg.method)) return response(msg.method === 'resources/list'?{resources:[]}:msg.method === 'prompts/list'?{prompts:[]}:{resourceTemplates:[]});
  if (msg.method !== 'tools/call') return json(rpcError(msg.id,-32601,'Method not found.'));
  const parsed = tokenParts(bearer(request));
  const tokenHash = await digest(parsed.secret);
  const name = msg.params?.name;
  let args;
  try { args = validateStudioArguments(name,msg.params?.arguments); }
  catch (error) { return json(rpcError(msg.id,-32602,error.message)); }
  try {
    const data = await internal(env,'session',parsed.id,name === 'studio_get_job' ? 'session/job' : 'session/enqueue',{tokenHash,resource:resourceUrl(request),name,args});
    const image = data.name === 'studio_get_pdf_page' && data.status === 'completed' ? data.result?.image : null;
    if (image) {
      const summary = {...data,result:{...data.result,image:{mimeType:image.mimeType,byteLength:Math.floor(image.data.length*3/4)-(image.data.endsWith('==')?2:image.data.endsWith('=')?1:0)}}};
      return response({content:[{type:'text',text:JSON.stringify(summary)},{type:'image',mimeType:image.mimeType,data:image.data}],structuredContent:summary,isError:false});
    }
    return response({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false});
  } catch (error) {
    if (!(error instanceof StudioError) || [401,403].includes(error.status)) throw error;
    const data = {error:error.code,message:error.message};
    return response({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:true});
  }
}

export default async function studio(request,env) {
  const path = new URL(request.url).pathname.replace(/\/$/,'');
  let headers = {};
  try {
    headers = cors(request,env);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (path === '/.well-known/oauth-protected-resource/studio-mcp') return json({resource:resourceUrl(request),authorization_servers:[issuerUrl(request)],scopes_supported:SCOPES,bearer_methods_supported:['header']},200,headers);
    if (['/.well-known/oauth-authorization-server/studio-oauth','/studio-oauth/.well-known/oauth-authorization-server'].includes(path)) return json({issuer:issuerUrl(request),authorization_endpoint:issuerUrl(request)+'/authorize',token_endpoint:issuerUrl(request)+'/token',registration_endpoint:issuerUrl(request)+'/register',scopes_supported:SCOPES,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true},200,headers);
    if (path === '/studio-oauth/authorize') return await authorize(request,env);
    let response;
    if (path === '/studio-oauth/register') {
      assert(request.method === 'POST','Use POST.',405);
      await rateLimit(request,env,'register');
      const body = await readBody(request);
      assert(Array.isArray(body.redirect_uris) && body.redirect_uris.length >= 1 && body.redirect_uris.length <= 5 && body.redirect_uris.every(validRedirect),'Only exact Claude or ChatGPT OAuth callback URLs can be registered.');
      assert(!body.token_endpoint_auth_method || body.token_endpoint_auth_method === 'none','Only public PKCE clients are supported.');
      assert(!body.grant_types || Array.isArray(body.grant_types) && body.grant_types.every(g => ['authorization_code','refresh_token'].includes(g)),'Unsupported OAuth grant.');
      assert(!body.response_types || Array.isArray(body.response_types) && body.response_types.every(g => g === 'code'),'Unsupported OAuth response type.');
      const id = randomId();
      const name = typeof body.client_name === 'string' ? body.client_name.slice(0,100) : 'AI assistant';
      await internal(env,'client',id,'client/init',{id,name,redirectUris:[...new Set(body.redirect_uris)]});
      response = json({client_id:id,client_id_issued_at:Math.floor(now()/1000),redirect_uris:[...new Set(body.redirect_uris)],client_name:name,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},201);
    } else if (path === '/studio-oauth/token') response = await oauthToken(request,env);
    else if (path === '/studio-api/health') response = json({ok:!!env.STUDIO_SESSIONS,service:'SeferStudio private bridge',mcp:'/studio-mcp'});
    else if (path.startsWith('/studio-api/')) response = await browserApi(request,env,path);
    else if (path === '/studio-mcp') response = await mcp(request,env);
    else fail('Unknown studio route.',404);
    const output = new Response(response.body,response);
    for (const [key,value] of Object.entries(headers)) output.headers.set(key,value);
    return output;
  } catch (error) {
    const status = error instanceof StudioError ? error.status : 500;
    const code = error instanceof StudioError ? error.code : 'internal_error';
    const message = error instanceof StudioError ? error.message : 'The studio service could not complete this request.';
    if (status === 405) headers.allow = 'POST, OPTIONS';
    if (status === 401 || status === 403 && code === 'insufficient_scope') headers['www-authenticate'] = 'Bearer resource_metadata="'+new URL('/.well-known/oauth-protected-resource/studio-mcp',request.url).href+'", scope="studio:read studio:write", error="'+code+'"';
    return json({error:code,message},status,headers);
  }
}

// One serialized mailbox per browser workspace. The same class stores separately
// named OAuth client/authorization records; none of those contain manuscripts.
export class SeferStudioSession {
  constructor(state,env) {
    this.state = state;
    this.env = env;
    this.data = null;
    this.tail = Promise.resolve();
    this.ready = state.blockConcurrencyWhile(async () => { this.data = await state.storage.get('state') || null; });
  }
  async fetch(request) {
    await this.ready;
    const run = this.tail.then(async () => {
      try { return json(await this.handle(new URL(request.url).pathname,await request.json())); }
      catch (error) { return json({error:error.code || 'internal_error',message:error instanceof StudioError ? error.message : 'Session operation failed.'},error.status || 500); }
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async save() {
    await this.state.storage.put('state',this.data);
    let at = this.data?.expiresAt;
    if (this.data?.kind === 'session') {
      for (const job of Object.values(this.data.jobs)) {
        const expiry = ['queued','running'].includes(job.status) ? job.expiresAt : job.resultExpiresAt;
        if (expiry && expiry > now()) at = Math.min(at,expiry);
      }
    }
    if (at) await this.state.storage.setAlarm(at);
  }
  async purge() { this.data = null; await this.state.storage.deleteAll(); await this.state.storage.deleteAlarm(); }
  async alarm() {
    await this.ready;
    const run = this.tail.then(async () => {
      if (!this.data) return;
      if (this.data.expiresAt && this.data.expiresAt <= now()) return this.purge();
      await this.prune();
      await this.save();
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async deletePayload(job,kind) {
    const key = kind+'Chunks';
    for (let i=0;i<(job[key] || 0);i++) await this.state.storage.delete('payload/'+job.jobId+'/'+kind+'/'+i);
    delete job[key];
  }
  async putPayload(job,kind,value) {
    const bytes = textEncoder.encode(JSON.stringify(value));
    let count = 0;
    for (let offset=0;offset<bytes.byteLength;offset+=49152) {
      await this.state.storage.put('payload/'+job.jobId+'/'+kind+'/'+count,bytes.slice(offset,offset+49152));
      count++;
    }
    job[kind+'Chunks'] = count;
  }
  async getPayload(job,kind) {
    const chunks = [];
    let size = 0;
    for (let i=0;i<(job[kind+'Chunks'] || 0);i++) {
      const chunk = await this.state.storage.get('payload/'+job.jobId+'/'+kind+'/'+i);
      assert(chunk instanceof Uint8Array,'The command payload is no longer available.',409,'payload_expired');
      chunks.push(chunk); size += chunk.byteLength;
    }
    assert(chunks.length,'The command payload is no longer available.',409,'payload_expired');
    const bytes = new Uint8Array(size);
    let offset=0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async prune() {
    if (this.data?.kind !== 'session') return;
    for (const job of Object.values(this.data.jobs)) {
      if (['queued','running'].includes(job.status) && job.expiresAt <= now()) {
        job.status = 'expired'; await this.deletePayload(job,'args'); await this.deletePayload(job,'result');
      }
      if (job.resultExpiresAt && job.resultExpiresAt <= now()) {
        await this.deletePayload(job,'result'); delete job.resultExpiresAt;
        if (['completed','failed'].includes(job.status)) job.status = 'result_expired';
      }
    }
    for (const collection of ['codes','tokens','refresh']) for (const [key,value] of Object.entries(this.data[collection])) if (value.expiresAt <= now()) delete this.data[collection][key];
  }
  async live(kind) {
    assert(this.data && this.data.kind === kind,'This connection is unavailable or expired.',401,'invalid_token');
    if (this.data.expiresAt && this.data.expiresAt <= now()) { await this.purge(); fail('This connection expired. Pair the tab again.',401,'invalid_token'); }
    await this.prune();
    return this.data;
  }
  owner(body) { assert(equal(body.ownerHash,this.data.ownerHash),'The browser connection is not authorized.',401,'invalid_token'); }
  access(body,write = false) {
    const token = this.data.tokens[body.tokenHash];
    assert(token && token.expiresAt > now() && body.resource === this.data.resource && token.resource === body.resource,'This access token is invalid or expired.',401,'invalid_token');
    assert(token.scopes.includes('studio:read'),'Read access is required.',403,'insufficient_scope');
    if (write) assert(this.data.allowEditing && token.scopes.includes('studio:write'),'This connection has read-only access. Enable editing in a new session and authorize studio:write.',403,'insufficient_scope');
    return token;
  }
  sessionInfo() {
    const browserOnline = now()-this.data.lastSeen <= HEARTBEAT_MS;
    const grants = new Set([...Object.values(this.data.tokens),...Object.values(this.data.refresh)].filter(token=>token.expiresAt>now()).map(token=>token.grantId));
    const authorized = grants.size > 0;
    return {id:this.data.id,expiresAt:this.data.expiresAt,allowEditing:this.data.allowEditing,browserOnline,authorized,grantCount:grants.size,connected:browserOnline && authorized};
  }
  async jobInfo(job) {
    const out = {jobId:job.jobId,status:job.status,name:job.name,createdAt:job.createdAt,expiresAt:job.expiresAt};
    if (job.resultChunks) out.result = await this.getPayload(job,'result');
    if (Object.hasOwn(job,'isError')) out.isError = job.isError;
    return out;
  }
  async issueTokens(claims) {
    const accessSecret = randomSecret(), refreshSecret = randomSecret();
    const accessHash = await digest(accessSecret), refreshHash = await digest(refreshSecret);
    const expiresAt = Math.min(now()+ACCESS_MS,this.data.expiresAt);
    const grantId = claims.grantId || randomId();
    this.data.tokens[accessHash] = {...claims,grantId,expiresAt};
    this.data.refresh[refreshHash] = {...claims,grantId,accessHash,expiresAt:this.data.expiresAt};
    await this.save();
    return {access_token:this.data.id+'.'+accessSecret,token_type:'Bearer',expires_in:Math.max(0,Math.floor((expiresAt-now())/1000)),refresh_token:this.data.id+'.'+refreshSecret,scope:claims.scopes.join(' ')};
  }
  async handle(path,body) {
    if (path === '/client/init') {
      assert(!this.data,'Client already exists.',409);
      this.data = {kind:'client',id:body.id,name:body.name,redirectUris:body.redirectUris};
      await this.save(); return {ok:true};
    }
    if (path === '/client/read') { const data=await this.live('client'); return {id:data.id,name:data.name,redirectUris:data.redirectUris}; }
    if (path === '/auth/init') {
      assert(!this.data,'Authorization request already exists.',409);
      this.data = {...body,kind:'auth'};
      await this.save(); return {ok:true};
    }
    if (path === '/auth/read' || path === '/auth/consume') {
      const data = await this.live('auth');
      assert(equal(body.csrfHash,data.csrfHash),'The authorization form expired.',403,'invalid_csrf');
      if (path === '/auth/consume') {
        // Keep a 2-minute record so a double-submitted Allow repeats the same redirect instead of failing.
        this.data = {kind:'auth',consumed:true,redirect:body.redirect,csrfHash:data.csrfHash,expiresAt:now()+2*60*1000};
        await this.save(); return {ok:true};
      }
      const copy = {...data}; delete copy.csrfHash; delete copy.kind; return copy;
    }
    if (path === '/session/init') {
      assert(!this.data,'Session already exists.',409);
      this.data = {kind:'session',id:body.id,ownerHash:body.ownerHash,pairHash:body.pairHash,pairingExpiresAt:now()+PAIR_MS,allowEditing:body.allowEditing,resource:body.resource,createdAt:now(),expiresAt:now()+SESSION_MS,lastSeen:now(),codes:{},tokens:{},refresh:{},spentRefresh:{},jobs:{},requests:{}};
      await this.save(); return {sessionId:this.data.id,expiresAt:this.data.expiresAt,pairingExpiresAt:this.data.pairingExpiresAt,allowEditing:this.data.allowEditing};
    }
    await this.live('session');
    if (['/session/poll','/session/result','/session/pairing','/session/disconnect'].includes(path)) this.owner(body);
    if (path === '/session/disconnect') { await this.purge(); return {ok:true,disconnected:true}; }
    if (path === '/session/pairing') {
      this.data.pairHash = body.pairHash;
      this.data.pairingExpiresAt = Math.min(now()+PAIR_MS,this.data.expiresAt);
      await this.save(); return {pairingExpiresAt:this.data.pairingExpiresAt,expiresAt:this.data.expiresAt};
    }
    if (path === '/session/authorize') {
      assert(this.data.pairHash && equal(body.pairHash,this.data.pairHash) && this.data.pairingExpiresAt > now(),'This one-time code is invalid, used or expired. Generate a new code in the open tab.',400,'invalid_grant');
      assert(now()-this.data.lastSeen <= HEARTBEAT_MS,'The SeferStudio tab is offline. Return to the tab and try again.',409,'browser_offline');
      assert(body.resource === this.data.resource,'The authorization resource does not match.');
      assert(Array.isArray(body.scopes) && body.scopes.includes('studio:read') && body.scopes.every(s=>SCOPES.includes(s)),'Invalid permission scopes.');
      // Clients ask for edit access by default; a tab that did not enable editing grants read-only instead of failing.
      const scopes = this.data.allowEditing ? body.scopes : body.scopes.filter(s => s !== 'studio:write');
      assert(Object.keys(this.data.codes).length < 5 && Object.keys(this.data.refresh).length < 5,'This tab has reached its connection limit.',429,'connection_limit');
      const secret = randomSecret();
      this.data.codes[await digest(secret)] = {clientId:body.clientId,redirectUri:body.redirectUri,resource:body.resource,challenge:body.challenge,scopes,expiresAt:Math.min(now()+AUTH_CODE_MS,this.data.expiresAt)};
      this.data.pairHash = null;
      await this.save(); return {code:secret};
    }
    if (path === '/session/token') {
      const code = this.data.codes[body.codeHash];
      assert(code && code.expiresAt > now() && code.clientId === body.clientId && code.redirectUri === body.redirectUri && code.resource === body.resource && equal(code.challenge,body.challenge),'The authorization code, client, resource or PKCE verifier is invalid.',400,'invalid_grant');
      delete this.data.codes[body.codeHash];
      return this.issueTokens({clientId:code.clientId,resource:code.resource,scopes:code.scopes});
    }
    if (path === '/session/refresh') {
      const spentGrant = this.data.spentRefresh[body.refreshHash];
      if (spentGrant) {
        for (const [key,value] of Object.entries(this.data.tokens)) if (value.grantId === spentGrant) delete this.data.tokens[key];
        for (const [key,value] of Object.entries(this.data.refresh)) if (value.grantId === spentGrant) delete this.data.refresh[key];
        for (const job of Object.values(this.data.jobs)) if (job.grantId === spentGrant && ['queued','running'].includes(job.status)) {
          job.status = job.status === 'queued' ? 'cancelled' : 'authorization_revoked';
          await this.deletePayload(job,'args');
        }
        await this.save();
        fail('A refresh token was reused. This connection has been revoked; pair it again.',400,'invalid_grant');
      }
      const old = this.data.refresh[body.refreshHash];
      assert(old && old.expiresAt > now() && old.clientId === body.clientId && old.resource === body.resource,'The refresh token is invalid or expired.',400,'invalid_grant');
      const scopes = body.scopes || old.scopes;
      assert(scopes.every(s => old.scopes.includes(s)) && scopes.includes('studio:read'),'A refresh cannot expand permissions.',400,'invalid_scope');
      // Long-lived pairings rotate refresh tokens many times; remember only the newest 128 spent ones.
      for (const key of Object.keys(this.data.spentRefresh).slice(0,Math.max(0,Object.keys(this.data.spentRefresh).length-127))) delete this.data.spentRefresh[key];
      this.data.spentRefresh[body.refreshHash] = old.grantId;
      delete this.data.refresh[body.refreshHash]; delete this.data.tokens[old.accessHash];
      return this.issueTokens({clientId:old.clientId,resource:old.resource,scopes,grantId:old.grantId});
    }
    if (path === '/session/poll') {
      this.data.lastSeen = now();
      this.data.expiresAt = Math.max(this.data.expiresAt,now()+SESSION_MS);
      for (const refresh of Object.values(this.data.refresh)) refresh.expiresAt = this.data.expiresAt;
      let command = null;
      // Deliver only once. A lost receipt never causes a mutation to be replayed.
      const running = Object.values(this.data.jobs).some(job => job.status === 'running');
      if (!running) {
        const job = Object.values(this.data.jobs).find(job => job.status === 'queued' && job.expiresAt > now());
        if (job) { job.status='running'; command={jobId:job.jobId,name:job.name,arguments:await this.getPayload(job,'args'),createdAt:job.createdAt,expiresAt:job.expiresAt,canWrite:job.canWrite}; }
      }
      await this.save(); return {session:this.sessionInfo(),command};
    }
    if (path === '/session/result') {
      assert(UUID.test(body.jobId || ''),'Invalid job id.');
      const job = this.data.jobs[body.jobId];
      assert(job,'Unknown job.',404,'job_not_found');
      const raw = JSON.stringify({result:body.result,isError:body.isError === true});
      const imageJob = job.name === 'studio_get_pdf_page' && body.isError !== true;
      assert(textEncoder.encode(raw).byteLength <= (imageJob ? MAX_IMAGE_BODY : MAX_BODY) - 1024,'Command result is too large.',413,'result_too_large');
      if (imageJob) {
        const image = body.result?.image;
        assert(image && image.mimeType === 'image/jpeg' && typeof image.data === 'string' && image.data.length <= Math.ceil(MAX_IMAGE_BYTES/3)*4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data),'A bounded JPEG image result is required.');
        const binary = atob(image.data);
        assert(binary.length >= 3 && binary.length <= MAX_IMAGE_BYTES && binary.charCodeAt(0)===255 && binary.charCodeAt(1)===216 && binary.charCodeAt(2)===255,'The result is not a valid bounded JPEG image.');
      }
      const resultHash = await digest(raw);
      if (['completed','failed'].includes(job.status)) {
        assert(equal(job.resultHash,resultHash),'This job already has a different result.',409,'result_conflict');
        return {ok:true,duplicate:true,jobId:job.jobId};
      }
      assert(job.status === 'running' && job.expiresAt > now(),'This job expired or was not dispatched. It will not be replayed.',409,'job_expired');
      assert(Object.hasOwn(body,'result'),'A command result is required.');
      await this.putPayload(job,'result',body.result);
      job.status=body.isError === true?'failed':'completed';job.isError=body.isError === true;job.resultHash=resultHash;job.resultExpiresAt=Math.min(now()+RESULT_MS,this.data.expiresAt);await this.deletePayload(job,'args');
      this.data.lastSeen = now();
      await this.save(); return {ok:true,jobId:job.jobId,status:job.status};
    }
    if (path === '/session/enqueue' || path === '/session/job') {
      const write = mutationNames.has(body.name);
      const token = this.access(body,write);
      if (path === '/session/job') {
        const job = this.data.jobs[body.args.jobId];
        assert(job,'Unknown job in this connection.',404,'job_not_found');
        assert(job.grantId === token.grantId,'This job belongs to a different connection.',403,'job_not_found');
        return {...await this.jobInfo(job),session:this.sessionInfo()};
      }
      const args = validateStudioArguments(body.name,body.args);
      const requestId = args.requestId;
      const commandArgs = {...args}; delete commandArgs.requestId;
      const hash = await digest(JSON.stringify({name:body.name,args:commandArgs,grantId:token.grantId}));
      if (requestId && this.data.requests[requestId]) {
        const prior = this.data.requests[requestId];
        assert(equal(prior.hash,hash),'This requestId was already used for a different command.',409,'idempotency_conflict');
        return {...await this.jobInfo(this.data.jobs[prior.jobId]),duplicate:true};
      }
      assert(now()-this.data.lastSeen <= HEARTBEAT_MS,'The paired SeferStudio tab is offline. Open it before submitting another command.',409,'browser_offline');
      assert(Object.values(this.data.jobs).filter(job=>['queued','running'].includes(job.status)).length < MAX_QUEUE,'The tab command queue is full. Wait for current results.',429,'queue_full');
      // Long-lived pairings: forget the oldest finished commands (and their idempotency keys) to stay under MAX_JOBS.
      for (const old of Object.values(this.data.jobs).filter(job=>!['queued','running'].includes(job.status)).sort((a,b)=>a.createdAt-b.createdAt)) {
        if (Object.keys(this.data.jobs).length < MAX_JOBS) break;
        await this.deletePayload(old,'args'); await this.deletePayload(old,'result'); delete this.data.jobs[old.jobId];
        for (const [key,value] of Object.entries(this.data.requests)) if (value.jobId === old.jobId) delete this.data.requests[key];
      }
      assert(Object.keys(this.data.jobs).length < MAX_JOBS,'Too many commands are still pending. Wait for current results.',429,'queue_full');
      const jobId = crypto.randomUUID();
      const job = {jobId,name:body.name,grantId:token.grantId,canWrite:write && token.scopes.includes('studio:write') && this.data.allowEditing,status:'queued',createdAt:now(),expiresAt:Math.min(now()+JOB_MS,this.data.expiresAt)};
      await this.putPayload(job,'args',commandArgs);
      this.data.jobs[jobId] = job;
      if (requestId) this.data.requests[requestId] = {jobId,hash};
      await this.save(); return {...await this.jobInfo(job),next:'Call studio_get_job with this jobId. A queued receipt does not mean the browser action finished.'};
    }
    fail('Unknown session operation.',404);
  }
}

export const TEST_LIMITS = {SESSION_MS,PAIR_MS,ACCESS_MS,AUTH_CODE_MS,HEARTBEAT_MS,JOB_MS,MAX_BODY,MAX_IMAGE_BODY,MAX_IMAGE_BYTES,MAX_QUEUE,MAX_JOBS};
