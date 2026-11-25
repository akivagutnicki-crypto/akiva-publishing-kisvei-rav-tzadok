import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAssistantRequest, runAssistant } from '../assistant.mjs';

const tool = { name: 'studio_get_state', description: 'state', input_schema: { type: 'object', properties: {} } };
const env = { ANTHROPIC_API_KEY: 'sk-test' };

test('validates the conversation and tools', () => {
  const ok = checkAssistantRequest({ messages: [{ role: 'user', content: 'hi' }], tools: [tool], speed: 'fast' });
  assert.equal(ok.model, 'claude-sonnet-5-5');
  assert.throws(() => checkAssistantRequest({ messages: [] }));
  assert.throws(() => checkAssistantRequest({ messages: [{ role: 'assistant', content: 'x' }] }));
  assert.throws(() => checkAssistantRequest({ messages: [{ role: 'user', content: 'x' }], tools: [{ ...tool, name: 'bad name' }] }));
  assert.throws(() => checkAssistantRequest({ messages: [{ role: 'user', content: 'x' }], tools: [tool, tool] }));
  assert.throws(() => checkAssistantRequest({ messages: [{ role: 'user', content: [{ type: 'tool_use', id: 'a', name: 'x', input: {} }] }] }));
  assert.throws(() => checkAssistantRequest({ messages: [{ role: 'user', content: 'x' }], speed: 'turbo' }));
  const loop = checkAssistantRequest({ messages: [
    { role: 'user', content: 'read' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'studio_get_state', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{}' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }] }] },
  ], tools: [tool] });
  assert.equal(loop.messages.length, 3);
});

test('sends the server key, caches system and tools, and returns Claude turn', async () => {
  let sent;
  const fetcher = async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', model: 'claude-opus-5-5' }), { status: 200 }); };
  const out = await runAssistant({ messages: [{ role: 'user', content: 'hi' }], tools: [tool], notes: 'Editing is off.' }, env, undefined, fetcher);
  assert.equal(out.content[0].text, 'done');
  assert.equal(sent.init.headers['x-api-key'], 'sk-test');
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.ok(sent.body.system[0].text.includes('Editing is off.'));
  assert.deepEqual(sent.body.tools.at(-1).cache_control, { type: 'ephemeral' });
});

test('reports missing key, rate limits and provider errors cleanly', async () => {
  await assert.rejects(runAssistant({ messages: [{ role: 'user', content: 'hi' }] }, {}), (e) => e.status === 503);
  const busy = async () => new Response('{}', { status: 429 });
  await assert.rejects(runAssistant({ messages: [{ role: 'user', content: 'hi' }] }, env, undefined, busy), (e) => e.status === 429);
  const broke = async () => new Response(JSON.stringify({ error: { message: 'bad thing' } }), { status: 500 });
  await assert.rejects(runAssistant({ messages: [{ role: 'user', content: 'hi' }] }, env, undefined, broke), (e) => e.status === 502 && /bad thing/.test(e.message));
});
