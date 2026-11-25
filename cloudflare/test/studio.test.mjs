import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import studio,{SeferStudioSession,STUDIO_TOOLS,TEST_LIMITS,validateStudioArguments} from '../studio.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const ORIGIN = 'https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev';
const BROWSER = 'https://akivagutnicki-crypto.github.io';
const RESOURCE = ORIGIN+'/studio-mcp';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const b64url = bytes => Buffer.from(bytes).toString('base64url');
const hash = async x => b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)));
const realNow = Date.now;
let clock = 1900000000000;
Date.now = () => clock;

class Storage {
  constructor() { this.values = new Map(); this.alarm = null; this.largest = 0; }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key,value) {
    const size = value instanceof Uint8Array ? value.byteLength : Buffer.byteLength(JSON.stringify(value));
    assert.ok(size <= 131072,'A storage value exceeded the conservative 128KiB bound');
    this.largest = Math.max(this.largest,size);
    this.values.set(key,structuredClone(value));
  }
  async delete(key) { this.values.delete(key); }
  async deleteAll() { this.values.clear(); }
  async setAlarm(at) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
}
function environment() {
  clock += 10000000;
  const objects = new Map();
  const env = {MCP_SITE_ORIGIN:BROWSER+'/akiva-publishing-kisvei-rav-tzadok',STUDIO_RATE_LIMITER:{limit:async()=>({success:true})},objects};
  env.STUDIO_SESSIONS = {
    idFromName:name=>name,
    get(name) {
      if (!objects.has(name)) {
        const storage = new Storage();
        const state = {storage,blockConcurrencyWhile:fn=>fn()};
        objects.set(name,{storage,state,instance:new SeferStudioSession(state,env)});
      }
      return {fetch:req=>objects.get(name).instance.fetch(req)};
    },
  };
  return env;
}
async function request(env,path,{method='POST',body={},headers={},raw}={}) {
  const req = new Request(ORIGIN+path,{method,headers:{...(method==='POST'?{'content-type':'application/json'}:{}),...headers},...(method==='POST'?{body:raw ?? JSON.stringify(body)}:{})});
  const response = await studio(req,env);
  const text = await response.text();
  let data;
  try { data=JSON.parse(text); } catch { data=null; }
  return {status:response.status,headers:response.headers,text,data};
}
async function createSession(env,allowEditing=false) {
  const r = await request(env,'/studio-api/session/create',{body:{allowEditing},headers:{origin:BROWSER}});
  assert.equal(r.status,201,'Session creation failed'); return r.data;
}
async function register(env,overrides={}) {
  const r = await request(env,'/studio-oauth/register',{body:{redirect_uris:[REDIRECT],client_name:'ChatGPT test',token_endpoint_auth_method:'none',...overrides}});
  assert.equal(r.status,201,'Client registration failed'); return r.data;
}
async function begin(env,client,scopes='studio:read',overrides={}) {
  const verifier=b64url(crypto.getRandomValues(new Uint8Array(32)));
  const params={response_type:'code',client_id:client.client_id,redirect_uri:REDIRECT,resource:RESOURCE,scope:scopes,state:'state-'+crypto.randomUUID(),code_challenge:await hash(verifier),code_challenge_method:'S256',...overrides};
  const r=await request(env,'/studio-oauth/authorize?'+new URLSearchParams(params),{method:'GET'});
  const requestId=/name="request_id" value="([^"]+)"/.exec(r.text)?.[1];
  const csrf=/name="csrf" value="([^"]+)"/.exec(r.text)?.[1];
  const cookie=r.headers.get('set-cookie')?.split(';')[0];
  return {...r,params,verifier,requestId,csrf,cookie};
}
async function approve(env,session,start,overrides={}) {
  return request(env,'/studio-oauth/authorize',{raw:new URLSearchParams({request_id:start.requestId,csrf:start.csrf,pairing_code:session.pairingCode,...overrides}).toString(),headers:{'content-type':'application/x-www-form-urlencoded',origin:ORIGIN,cookie:start.cookie}});
}
async function exchange(env,client,start,code,overrides={}) {
  return request(env,'/studio-oauth/token',{raw:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:REDIRECT,resource:RESOURCE,code_verifier:start.verifier,code,...overrides}).toString(),headers:{'content-type':'application/x-www-form-urlencoded'}});
}
async function flow(env,write=false) {
  const session=await createSession(env,write),client=await register(env),start=await begin(env,client,write?'studio:read studio:write':'studio:read');
  assert.equal(start.status,200,'OAuth authorization page failed');
  const consent=await approve(env,session,start);
  assert.equal(consent.status,303,'OAuth pairing failed');
  const destination=new URL(consent.headers.get('location'));
  assert.equal(destination.searchParams.get('state'),start.params.state);
  assert.equal(destination.searchParams.get('iss'),ORIGIN+'/studio-oauth');
  const code=destination.searchParams.get('code');
  const tokens=await exchange(env,client,start,code);
  assert.equal(tokens.status,200,'OAuth token exchange failed');
  return {session,client,start,code,tokens:tokens.data};
}
async function rpc(env,tokens,name,args={}) {
  return request(env,'/studio-mcp',{body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},headers:{...(tokens?{authorization:'Bearer '+tokens.access_token}:{})}});
}
async function browser(env,session,method,body={}) {
  return request(env,'/studio-api/session/'+session.sessionId+'/'+method,{body,headers:{origin:BROWSER,authorization:'Bearer '+session.ownerToken}});
}
const edit = () => ({documentId:'document-test',expectedRevision:'revision-1',paragraphIndex:0,runIndex:0,expectedText:'old',replacementText:'new',requestId:crypto.randomUUID()});
const output = response => response.data.result.structuredContent;

await test('SeferStudio private MCP security and mailbox contract',async t=>{
  await t.test('publishes 15 typed tools and OAuth metadata without document data',async()=>{
    const env=environment();
    const init=await request(env,'/studio-mcp',{body:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}}});
    assert.equal(init.status,200);assert.equal(init.data.result.protocolVersion,'2024-11-05');
    const listed=await request(env,'/studio-mcp',{body:{jsonrpc:'2.0',id:2,method:'tools/list'}});
    assert.equal(listed.data.result.tools.length,15);assert.equal(env.objects.size,0);
    const meta=await request(env,'/.well-known/oauth-protected-resource/studio-mcp',{method:'GET'});
    assert.equal(meta.data.resource,RESOURCE);
    const auth=await request(env,'/.well-known/oauth-authorization-server/studio-oauth',{method:'GET'});
    assert.deepEqual(auth.data.code_challenge_methods_supported,['S256']);assert.equal(auth.data.authorization_response_iss_parameter_supported,true);
    const health=await request(env,'/studio-api/health',{method:'GET'});assert.equal(health.status,200);assert.equal(health.data.ok,true);
  });
  await t.test('requires OAuth on tools/call and challenges with exact resource metadata',async()=>{
    const env=environment();const r=await rpc(env,null,'studio_get_state');
    assert.equal(r.status,401);assert.ok(r.headers.get('www-authenticate').includes('/.well-known/oauth-protected-resource/studio-mcp'));
  });
  await t.test('browser session requires allowed Origin and creation rate limiter',async()=>{
    const env=environment();
    assert.equal((await request(env,'/studio-api/session/create')).status,403);
    assert.equal((await request(env,'/studio-api/session/create',{headers:{origin:'https://evil.test'}})).status,403);
    env.STUDIO_RATE_LIMITER.limit=async()=>({success:false});
    assert.equal((await request(env,'/studio-api/session/create',{headers:{origin:BROWSER}})).status,429);
  });
  await t.test('DCR rejects hostile redirects and accepts callback-ID ChatGPT URLs',async()=>{
    const env=environment();
    for(const uri of ['https://evil.test/callback','https://chatgpt.com.evil.test/connector_platform_oauth_redirect','https://name:password@chatgpt.com/connector_platform_oauth_redirect',REDIRECT+'?to=evil',REDIRECT+'#fragment']) {
      const r=await request(env,'/studio-oauth/register',{body:{redirect_uris:[uri]}});assert.equal(r.status,400);
    }
    await register(env,{redirect_uris:['https://chatgpt.com/connector/oauth/abcde_12345']});
    await register(env,{redirect_uris:['https://claude.ai/api/mcp/auth_callback','https://claude.com/api/mcp/auth_callback']});
    for(const uri of ['https://claude.ai/api/mcp/other','https://claude.ai.evil.test/api/mcp/auth_callback','https://claude.ai/api/mcp/auth_callback?x=1']) {
      const r=await request(env,'/studio-oauth/register',{body:{redirect_uris:[uri]}});assert.equal(r.status,400);
    }
  });
  await t.test('rejects invalid authorization client/resource/redirect/PKCE/state without raw 500',async()=>{
    const env=environment(),client=await register(env);
    for(const override of [{client_id:'f'.repeat(32)},{resource:ORIGIN+'/mcp'},{redirect_uri:'https://evil.test/cb'},{code_challenge_method:'plain'},{code_challenge:'short'},{state:''},{response_type:'token'}]) {
      const r=await begin(env,client,'studio:read',override);assert.ok([400,401].includes(r.status));assert.ok(r.data?.error);
    }
  });
  await t.test('OAuth form uses CSP, no-referrer and CSRF cookie binding',async()=>{
    const env=environment(),session=await createSession(env),client=await register(env),start=await begin(env,client);
    assert.ok(start.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert.equal(start.headers.get('referrer-policy'),'same-origin');
    assert.ok(start.text.includes('Read this open document. Text editing is disabled.'));
    const invalid=await approve(env,session,{...start,cookie:'__Host-ss-oauth=invalid'});assert.equal(invalid.status,403);
    const good=await approve(env,session,start);assert.equal(good.status,303);
  });
  await t.test('an older authorization form still works after a newer one is opened',async()=>{
    const env=environment(),session=await createSession(env),client=await register(env),first=await begin(env,client),second=await begin(env,client);
    const jar=new Map();for(const c of [first.cookie,second.cookie]){const i=c.indexOf('=');jar.set(c.slice(0,i),c.slice(i+1));}const both=[...jar].map(([k,v])=>k+'='+v).join('; ');
    const ok=await approve(env,session,{...first,cookie:both});assert.equal(ok.status,303);
  });
  await t.test('one-time pairing code cannot be reused',async()=>{
    const env=environment(),f=await flow(env);const second=await begin(env,f.client);
    assert.equal((await approve(env,f.session,second)).status,400);
  });
  await t.test('read-only browser session cannot authorize write scope',async()=>{
    const env=environment(),session=await createSession(env),client=await register(env),start=await begin(env,client,'studio:read studio:write');
    const r=await approve(env,session,start);assert.equal(r.status,403);assert.ok(r.text.includes('This tab is read-only'));
  });
  await t.test('PKCE, client, redirect and resource must all match; codes single-use',async()=>{
    const env=environment(),session=await createSession(env),client=await register(env),other=await register(env),start=await begin(env,client);
    const consent=await approve(env,session,start),code=new URL(consent.headers.get('location')).searchParams.get('code');
    for(const override of [{code_verifier:b64url(crypto.getRandomValues(new Uint8Array(32)))},{client_id:other.client_id},{resource:ORIGIN+'/mcp'},{redirect_uri:'https://chatgpt.com/connector/oauth/different_12345'}]) {
      assert.equal((await exchange(env,client,start,code,override)).status,400);
    }
    assert.equal((await exchange(env,client,start,code)).status,200);
    assert.equal((await exchange(env,client,start,code)).status,400);
  });
  await t.test('pairing and authorization-code expiry are enforced',async()=>{
    const env=environment(),session=await createSession(env),client=await register(env),start=await begin(env,client);
    clock+=TEST_LIMITS.PAIR_MS+1;
    assert.equal((await approve(env,session,start)).status,401);
    const env2=environment(),s2=await createSession(env2),c2=await register(env2),a2=await begin(env2,c2),ok=await approve(env2,s2,a2);
    const code=new URL(ok.headers.get('location')).searchParams.get('code');clock+=TEST_LIMITS.AUTH_CODE_MS+1;
    assert.equal((await exchange(env2,c2,a2,code)).status,400);
  });
  await t.test('heartbeat alone never claims OAuth authorization',async()=>{
    const env=environment(),session=await createSession(env);const r=await browser(env,session,'poll');
    assert.equal(r.data.session.browserOnline,true);assert.equal(r.data.session.authorized,false);assert.equal(r.data.session.connected,false);
    const f=await flow(env);const linked=await browser(env,f.session,'poll');assert.equal(linked.data.session.authorized,true);assert.equal(linked.data.session.connected,true);
  });
  await t.test('access tokens cannot cross sessions or access another grant job',async()=>{
    const env=environment(),a=await flow(env),b=await flow(env);
    const forged={access_token:b.session.sessionId+'.'+a.tokens.access_token.split('.')[1]};
    assert.equal((await rpc(env,forged,'studio_get_state')).status,401);
    const r=await rpc(env,a.tokens,'studio_get_state');const id=output(r).jobId;
    const missing=await rpc(env,b.tokens,'studio_get_job',{jobId:id});assert.equal(missing.data.result.isError,true);assert.equal(output(missing).error,'job_not_found');
  });
  await t.test('read-only token cannot mutate and cannot gain scope by refreshing',async()=>{
    const env=environment(),f=await flow(env);
    assert.equal((await rpc(env,f.tokens,'studio_replace_text',edit())).status,403);
    const refreshed=await request(env,'/studio-oauth/token',{raw:new URLSearchParams({grant_type:'refresh_token',refresh_token:f.tokens.refresh_token,client_id:f.client.client_id,resource:RESOURCE,scope:'studio:read studio:write'}).toString()});
    assert.equal(refreshed.status,400);assert.equal(refreshed.data.error,'invalid_scope');
  });
  await t.test('queued command is acknowledged once, then queryable as completed',async()=>{
    const env=environment(),f=await flow(env,true),args=edit(),queued=await rpc(env,f.tokens,'studio_replace_text',args),jobId=output(queued).jobId;
    assert.equal(output(queued).status,'queued');
    const poll=await browser(env,f.session,'poll');assert.equal(poll.data.command.jobId,jobId);assert.equal(poll.data.command.canWrite,true);assert.equal(poll.data.command.arguments.requestId,undefined);
    assert.equal((await browser(env,f.session,'poll')).data.command,null);
    const receipt={jobId,result:{status:'updated',revision:'revision-2',undoId:'undo-1'},isError:false};
    assert.equal((await browser(env,f.session,'result',receipt)).status,200);
    const complete=await rpc(env,f.tokens,'studio_get_job',{jobId});assert.equal(output(complete).status,'completed');assert.equal(output(complete).result.revision,'revision-2');
    const duplicate=await browser(env,f.session,'result',receipt);assert.equal(duplicate.data.duplicate,true);
    const conflict=await browser(env,f.session,'result',{...receipt,result:{status:'different'}});assert.equal(conflict.status,409);
  });
  await t.test('idempotency prevents duplicate mutations and rejects changed arguments',async()=>{
    const env=environment(),f=await flow(env,true),args=edit();
    const a=await rpc(env,f.tokens,'studio_replace_text',args),b=await rpc(env,f.tokens,'studio_replace_text',args);
    assert.equal(output(a).jobId,output(b).jobId);assert.equal(output(b).duplicate,true);
    const conflict=await rpc(env,f.tokens,'studio_replace_text',{...args,replacementText:'different'});assert.equal(output(conflict).error,'idempotency_conflict');
  });
  await t.test('offline browser rejects new commands without queueing writes',async()=>{
    const env=environment(),f=await flow(env,true);clock+=TEST_LIMITS.HEARTBEAT_MS+1;
    const r=await rpc(env,f.tokens,'studio_replace_text',edit());assert.equal(output(r).error,'browser_offline');
    assert.equal(Object.keys(env.objects.get('session:'+f.session.sessionId).instance.data.jobs).length,0);
  });
  await t.test('expired queued commands never dispatch and late receipts are rejected',async()=>{
    const env=environment(),f=await flow(env,true),args=edit();const q=await rpc(env,f.tokens,'studio_replace_text',args),id=output(q).jobId;
    clock+=TEST_LIMITS.JOB_MS+1;const p=await browser(env,f.session,'poll');assert.equal(p.data.command,null);
    const late=await browser(env,f.session,'result',{jobId:id,result:{status:'changed'}});assert.equal(late.status,409);
    const same=await rpc(env,f.tokens,'studio_replace_text',args);assert.equal(output(same).status,'expired');assert.equal(output(same).duplicate,true);
  });
  await t.test('queue bound rejects excess work',async()=>{
    const env=environment(),f=await flow(env);
    for(let i=0;i<TEST_LIMITS.MAX_QUEUE;i++)assert.equal(output(await rpc(env,f.tokens,'studio_get_state')).status,'queued');
    assert.equal(output(await rpc(env,f.tokens,'studio_get_state')).error,'queue_full');
  });
  await t.test('rejects unknown command args, excessive reads, ambiguous navigation and non-UUID request IDs',async()=>{
    const env=environment(),f=await flow(env,true);
    const bad=[['studio_read_paragraphs',{count:31}],['studio_search',{query:'a',limit:31}],['studio_navigate',{page:1,paragraphIndex:0}],['studio_get_state',{url:'https://evil.test'}],['studio_replace_text',{...edit(),requestId:'retry-me'}],['studio_read_footnotes',{ids:['1','1']}]];
    for(const [name,args]of bad){const r=await rpc(env,f.tokens,name,args);assert.equal(r.data.error.code,-32602);}
    assert.throws(()=>validateStudioArguments('studio_eval',{code:'1+1'}));
  });
  await t.test('body limit stops oversized streamed input without trusting Content-Length',async()=>{
    const env=environment();let pulls=0,cancelled=false;
    const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}});
    const req=new Request(RESOURCE,{method:'POST',body:stream,duplex:'half',headers:{'content-type':'application/json'}});
    const r=await studio(req,env);assert.equal(r.status,413);assert.equal(cancelled,true);assert.ok(pulls<=7);
  });
  await t.test('refresh rotation invalidates old access and replay revokes the token family',async()=>{
    const env=environment(),f=await flow(env,true);
    const params={grant_type:'refresh_token',refresh_token:f.tokens.refresh_token,client_id:f.client.client_id,resource:RESOURCE};
    const fresh=await request(env,'/studio-oauth/token',{raw:new URLSearchParams(params).toString()});assert.equal(fresh.status,200);
    assert.equal((await rpc(env,f.tokens,'studio_get_state')).status,401);
    assert.equal((await rpc(env,fresh.data,'studio_get_state')).status,200);
    const replay=await request(env,'/studio-oauth/token',{raw:new URLSearchParams(params).toString()});assert.equal(replay.status,400);
    assert.equal((await rpc(env,fresh.data,'studio_get_state')).status,401);
    assert.equal((await browser(env,f.session,'poll')).data.command,null);
  });
  await t.test('disconnect revokes tokens and removes every payload and stored credential',async()=>{
    const env=environment(),f=await flow(env,true);await rpc(env,f.tokens,'studio_replace_text',edit());
    const disconnected=await browser(env,f.session,'disconnect');assert.equal(disconnected.status,200);
    const object=env.objects.get('session:'+f.session.sessionId);assert.equal(object.storage.values.size,0);assert.equal(object.instance.data,null);
    assert.equal((await rpc(env,f.tokens,'studio_get_state')).status,401);assert.equal((await browser(env,f.session,'poll')).status,401);
  });
  await t.test('session expiry alarm purges private content even without a new request',async()=>{
    const env=environment(),f=await flow(env);const q=await rpc(env,f.tokens,'studio_get_state');await browser(env,f.session,'poll');await browser(env,f.session,'result',{jobId:output(q).jobId,result:{privateText:'synthetic manuscript'}});
    clock+=TEST_LIMITS.SESSION_MS+1;const object=env.objects.get('session:'+f.session.sessionId);await object.instance.alarm();assert.equal(object.storage.values.size,0);assert.equal(object.storage.alarm,null);
    assert.equal((await rpc(env,f.tokens,'studio_get_state')).status,401);
  });
  await t.test('large multilingual receipts are chunked and survive Durable Object restart',async()=>{
    const env=environment(),f=await flow(env);const q=await rpc(env,f.tokens,'studio_get_ocr_text'),jobId=output(q).jobId;await browser(env,f.session,'poll');
    const text='א'.repeat(40000);const ack=await browser(env,f.session,'result',{jobId,result:{text,documentId:'pdf-test',revision:'1'}});assert.equal(ack.status,200);
    const object=env.objects.get('session:'+f.session.sessionId);assert.ok(object.storage.largest<=131072);assert.ok([...object.storage.values.keys()].some(x=>x.includes('/result/1')));
    object.instance=new SeferStudioSession(object.state,env);
    const r=await rpc(env,f.tokens,'studio_get_job',{jobId});assert.equal(output(r).result.text.length,40000);
  });
  await t.test('PDF receipts emit bounded ImageContent without base64 duplication',async()=>{
    const env=environment(),f=await flow(env),q=await rpc(env,f.tokens,'studio_get_pdf_page',{documentId:'pdf-test',page:1}),jobId=output(q).jobId;await browser(env,f.session,'poll');
    const jpeg=Buffer.alloc(800000,7);jpeg[0]=255;jpeg[1]=216;jpeg[2]=255;
    const result={documentId:'pdf-test',page:1,width:1400,height:1800,image:{mimeType:'image/jpeg',data:jpeg.toString('base64')}};
    assert.equal((await browser(env,f.session,'result',{jobId,result})).status,200);
    const r=await rpc(env,f.tokens,'studio_get_job',{jobId});assert.equal(r.data.result.content[1].type,'image');assert.equal(r.data.result.content[1].data.length,result.image.data.length);
    assert.equal(r.data.result.structuredContent.result.image.data,undefined);assert.ok(r.data.result.content[0].text.length<2000);
  });
  await t.test('rejects oversized/non-JPEG images and arbitrary image URLs',async()=>{
    const env=environment(),f=await flow(env),q=await rpc(env,f.tokens,'studio_get_pdf_page',{documentId:'pdf-test',page:1}),jobId=output(q).jobId;await browser(env,f.session,'poll');
    for(const image of [{mimeType:'image/svg+xml',data:btoa('<svg/>')},{mimeType:'image/jpeg',data:btoa('not a jpeg')},{mimeType:'image/jpeg',data:'https://evil.test/image.jpg'}])assert.equal((await browser(env,f.session,'result',{jobId,result:{image}})).status,400);
    const tooBig=Buffer.alloc(TEST_LIMITS.MAX_IMAGE_BYTES+1,8);tooBig[0]=255;tooBig[1]=216;tooBig[2]=255;
    assert.equal((await browser(env,f.session,'result',{jobId,result:{image:{mimeType:'image/jpeg',data:tooBig.toString('base64')}}})).status,400);
  });
  await t.test('simultaneous duplicate mutations serialize to one dispatch',async()=>{
    const env=environment(),f=await flow(env,true),args=edit();
    const all=await Promise.all(Array.from({length:8},()=>rpc(env,f.tokens,'studio_replace_text',args)));
    assert.equal(new Set(all.map(r=>output(r).jobId)).size,1);assert.equal(Object.keys(env.objects.get('session:'+f.session.sessionId).instance.data.jobs).length,1);
  });
  await t.test('results expire and payload chunks are purged on alarm',async()=>{
    const env=environment(),f=await flow(env),q=await rpc(env,f.tokens,'studio_get_state'),jobId=output(q).jobId;await browser(env,f.session,'poll');await browser(env,f.session,'result',{jobId,result:{privateText:'synthetic'}});
    clock+=16*60*1000;const object=env.objects.get('session:'+f.session.sessionId);await object.instance.alarm();
    assert.equal(object.instance.data.jobs[jobId].status,'result_expired');assert.equal([...object.storage.values.keys()].filter(k=>k.startsWith('payload/')).length,0);
  });
});
Date.now=realNow;
