// Claude inside Sefer Pro (POST /v1/assistant). The browser runs the agent loop: it sends the conversation and the
// tools it can execute locally on the open manuscript, PDF and connected MCP servers; this route adds the server's
// Anthropic key and returns Claude's next turn. Tool calls are executed by the browser, never here.
import { HttpProblem } from './ocr.mjs';

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const MODELS = { detail: 'claude-opus-5-5', fast: 'claude-sonnet-5-5' };
const MAX_MESSAGES = 120;
const MAX_TOOLS = 64;
const MAX_TEXT = 400_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const bad = (message) => new HttpProblem(400, 'invalid_request', message);
const problem = (status, code, message) => new HttpProblem(status, code, message);
const record = (x) => x && typeof x === 'object' && !Array.isArray(x);

export const ASSISTANT_SYSTEM = `You are Claude, working inside Sefer Pro, Akiva Publishing's studio for bilingual Hebrew–English Torah books (Word manuscripts, PDF scans and OCR, KDP covers).

How to work:
- Use the tools to look at the open document before answering questions about it or changing it. Read the relevant paragraphs (studio_read_paragraphs / studio_search) and use the exact documentId, revision, paragraph/run indices and complete run text they return.
- Edits replace one exact text run and keep formatting and footnote anchors. Make the smallest change that does the job, and re-read after an edit if you need the new revision. Never say a change was made unless its tool result says it was applied. If editing is off, propose the exact change instead.
- For Torah sources use the Akiva library tools when they are available (kisvei_*, mafteach_*): quote exactly as returned and give the ref. Do not invent sources or quotes.
- For OCR review, look at the page image (studio_get_pdf_page) and compare it with the OCR text. Hebrew reads right to left; in two-column pages the right column comes first.
- Keep Hebrew spelling, nikkud and roshei teivos exactly unless asked to change them. Write English clearly and concisely.
- Answer in the user's language. Be brief: say what you found or changed, not every step you took.`;

function text(value, name, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > max) throw bad(name + ' must be text.');
  return value;
}

function checkBlock(block, role) {
  if (!record(block)) throw bad('Each content block must be an object.');
  switch (block.type) {
    case 'text': return { type: 'text', text: text(block.text, 'text') };
    case 'image': {
      const s = block.source;
      if (!record(s) || s.type !== 'base64' || !IMAGE_TYPES.has(s.media_type) || typeof s.data !== 'string' || s.data.length > 7_000_000) throw bad('Images must be base64 JPEG, PNG, WebP or GIF.');
      if (role !== 'user') throw bad('Only your messages can include images.');
      return { type: 'image', source: { type: 'base64', media_type: s.media_type, data: s.data } };
    }
    case 'tool_use': {
      if (role !== 'assistant') throw bad('Tool calls belong to Claude’s turns.');
      if (typeof block.id !== 'string' || block.id.length > 200 || !TOOL_NAME.test(block.name || '') || !record(block.input)) throw bad('Invalid tool call.');
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    }
    case 'tool_result': {
      if (role !== 'user') throw bad('Tool results belong to your turns.');
      if (typeof block.tool_use_id !== 'string' || block.tool_use_id.length > 200) throw bad('Invalid tool result.');
      const content = typeof block.content === 'string' ? text(block.content, 'tool result')
        : Array.isArray(block.content) && block.content.length <= 20 ? block.content.map((b) => {
          if (!record(b) || !['text', 'image'].includes(b.type)) throw bad('Tool results hold text or images.');
          return checkBlock(b, 'user');
        }) : (() => { throw bad('Invalid tool result content.'); })();
      return { type: 'tool_result', tool_use_id: block.tool_use_id, content, ...(block.is_error === true ? { is_error: true } : {}) };
    }
    case 'thinking': case 'redacted_thinking':
      if (role !== 'assistant') throw bad('Invalid content block.');
      return { ...block };
    default: throw bad('Unsupported content block: ' + String(block.type).slice(0, 40));
  }
}

export function checkAssistantRequest(body) {
  if (!record(body)) throw bad('Send a JSON object.');
  const { messages, tools = [], speed = 'detail', notes = '' } = body;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) throw bad('Send between 1 and ' + MAX_MESSAGES + ' messages.');
  const clean = messages.map((m, i) => {
    if (!record(m) || !['user', 'assistant'].includes(m.role)) throw bad('Message ' + i + ' needs a user or assistant role.');
    const content = typeof m.content === 'string' ? text(m.content, 'message')
      : Array.isArray(m.content) && m.content.length && m.content.length <= 60 ? m.content.map((b) => checkBlock(b, m.role))
        : (() => { throw bad('Message ' + i + ' has no content.'); })();
    return { role: m.role, content };
  });
  if (clean[0].role !== 'user' || clean[clean.length - 1].role !== 'user') throw bad('The conversation must start and end with your message.');
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw bad('Send at most ' + MAX_TOOLS + ' tools.');
  const seen = new Set();
  const cleanTools = tools.map((t) => {
    if (!record(t) || !TOOL_NAME.test(t.name || '') || seen.has(t.name)) throw bad('Each tool needs a unique name of letters, digits, _ or -.');
    seen.add(t.name);
    const schema = t.input_schema;
    if (!record(schema) || schema.type !== 'object' || JSON.stringify(schema).length > 20_000) throw bad('Tool ' + t.name + ' needs an object input schema.');
    return { name: t.name, description: text(t.description || '', 'tool description', 4000), input_schema: schema };
  });
  if (!MODELS[speed]) throw bad('speed must be "detail" or "fast".');
  return { messages: clean, tools: cleanTools, model: MODELS[speed], notes: text(notes, 'notes', 4000) };
}

export async function runAssistant(body, env, signal, fetcher = fetch) {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw problem(503, 'not_configured', 'The server operator must configure ANTHROPIC_API_KEY.');
  const req = checkAssistantRequest(body);
  const system = [{ type: 'text', text: ASSISTANT_SYSTEM + (req.notes ? '\n\nAbout the current session:\n' + req.notes : ''), cache_control: { type: 'ephemeral' } }];
  const tools = req.tools.map((t, i) => (i === req.tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  let response;
  try {
    response = await fetcher(CLAUDE_URL, {
      method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: req.model, max_tokens: 16000, system, ...(tools.length ? { tools } : {}), messages: req.messages }),
    });
  } catch { throw problem(502, 'provider_unreachable', 'Claude could not be reached.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429 || response.status === 529) throw problem(429, 'provider_rate', 'Claude is busy. Wait a minute and try again.');
    const detail = data?.error?.message ? ': ' + String(data.error.message).slice(0, 300) : '.';
    if (response.status === 400) throw problem(400, 'provider_rejected', 'Claude could not use this request' + detail);
    if (response.status === 402 || /credit|billing/i.test(detail)) throw problem(402, 'provider_billing', 'The Claude API account needs credits' + detail);
    throw problem(502, 'provider_error', 'Claude returned an error' + detail);
  }
  if (!data || !Array.isArray(data.content)) throw problem(502, 'provider_error', 'Claude returned an unreadable response.');
  return { content: data.content, stop_reason: data.stop_reason, model: data.model, usage: data.usage };
}
