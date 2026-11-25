// Claude in Sefer Pro: a chat panel where Claude reads and edits the open manuscript, reviews PDF pages and OCR,
// and looks up sources in the Akiva library. The agent loop runs here; the Worker (/v1/assistant) holds the API key.
(function () {
  'use strict';
  const ORIGIN = 'https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev';
  const API = ORIGIN + '/v1/assistant';
  const LIBRARY_MCP = ORIGIN + '/mcp';
  const MAX_STEPS = 30;
  const RESULT_MAX = 60000;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sp_claude_' + k); return v == null ? d : JSON.parse(v); } catch (_e) { return d; } },
    set(k, v) { try { localStorage.setItem('sp_claude_' + k, JSON.stringify(v)); } catch (_e) { /* private mode */ } },
  };
  const state = {
    messages: [], busy: false, abort: null,
    speed: store.get('speed', 'detail'), allowEdits: store.get('edits', false), library: store.get('library', true),
    lib: { tools: null, session: '', id: 1, failed: '' }, lastEdit: null,
  };
  const LABELS = {
    studio_get_state: 'Looked at the document', studio_read_paragraphs: 'Read paragraphs', studio_search: 'Searched the manuscript',
    studio_read_footnotes: 'Read footnotes', studio_replace_text: 'Edited text', studio_update_footnote: 'Edited a footnote', studio_undo: 'Undid an edit',
    studio_navigate: 'Moved to', studio_prepare_export: 'Opened export', studio_get_pdf_state: 'Looked at the PDF', studio_get_pdf_page: 'Viewed PDF page',
    studio_get_ocr_text: 'Read the OCR text', studio_set_ocr_text: 'Updated the OCR text', studio_undo_ocr: 'Undid the OCR edit',
    docx_append_paragraph: 'Added a paragraph', docx_insert_footnote: 'Added a footnote',
  };

  // ---------- Akiva library (public MCP) ----------
  async function rpc(method, params, notify) {
    const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: state.lib.id++ }) };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (state.lib.session) headers['Mcp-Session-Id'] = state.lib.session;
    const r = await fetch(LIBRARY_MCP, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', referrerPolicy: 'no-referrer' });
    const sid = r.headers.get('Mcp-Session-Id'); if (sid) state.lib.session = sid;
    if (notify) return null;
    if (!r.ok) throw new Error('Library HTTP ' + r.status);
    let text = await r.text();
    if (/text\/event-stream/.test(r.headers.get('Content-Type') || '')) {
      const lines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
      text = lines[lines.length - 1] || '{}';
    }
    const data = JSON.parse(text);
    if (data.error) throw new Error(data.error.message || 'Library error');
    return data.result;
  }
  async function libraryTools() {
    if (!state.library) return [];
    if (state.lib.tools) return state.lib.tools;
    try {
      await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Sefer Pro Claude', version: '1.0' } });
      await rpc('notifications/initialized', null, true).catch(() => {});
      const listed = await rpc('tools/list', {});
      state.lib.tools = (listed.tools || []).filter((t) => /^[A-Za-z0-9_-]{1,64}$/.test(t.name)).map((t) => ({
        name: t.name, description: String(t.description || '').slice(0, 3500), input_schema: t.inputSchema || { type: 'object', properties: {} }, library: true,
      }));
      state.lib.failed = '';
    } catch (e) { state.lib.failed = e.message; state.lib.tools = null; return []; }
    return state.lib.tools;
  }
  async function callLibrary(name, args) {
    const result = await rpc('tools/call', { name, arguments: args || {} });
    const blocks = [];
    for (const c of result.content || []) {
      if (c.type === 'text') blocks.push({ type: 'text', text: clip(c.text) });
      else if (c.type === 'image' && c.data) blocks.push({ type: 'image', source: { type: 'base64', media_type: c.mimeType || 'image/png', data: c.data } });
    }
    return { blocks: blocks.length ? blocks : [{ type: 'text', text: '(no content)' }], isError: !!result.isError };
  }

  // ---------- tools ----------
  function studioTools() {
    const s = window.SeferStudioTools;
    if (!s) return [];
    return s.definitions.filter((d) => state.allowEdits || !s.writeTools.has(d.name)).map((d) => ({ name: d.name, description: d.description, input_schema: d.inputSchema }));
  }
  function workspaceTools() {
    if (!state.allowEdits || !window.OfficeStudioMCP) return [];
    return window.OfficeStudioMCP.getAllMcpTools().filter((t) => ['docx_append_paragraph', 'docx_insert_footnote'].includes(t.name))
      .map((t) => ({ name: t.name, description: t.description + ' Use only when the user asks to add new text; prefer exact edits otherwise.', input_schema: t.inputSchema }));
  }
  async function allTools() {
    const list = [...studioTools(), ...workspaceTools()];
    const names = new Set(list.map((t) => t.name));
    for (const t of await libraryTools()) if (!names.has(t.name)) { names.add(t.name); list.push(t); }
    return list;
  }
  function clip(text) { text = String(text); return text.length > RESULT_MAX ? text.slice(0, RESULT_MAX) + '\n…[truncated]' : text; }
  async function runTool(call, libNames) {
    const args = call.input || {};
    try {
      if (libNames.has(call.name)) {
        const out = await callLibrary(call.name, args);
        return { type: 'tool_result', tool_use_id: call.id, content: out.blocks, ...(out.isError ? { is_error: true } : {}) };
      }
      let result;
      if (call.name === 'docx_append_paragraph' || call.name === 'docx_insert_footnote') {
        if (!state.allowEdits) throw new Error('Editing is off.');
        result = await window.OfficeStudioMCP.invokeMcpTool(call.name, args);
      } else {
        result = await window.SeferStudioTools.run(call.name, args, state.allowEdits);
      }
      if (result && result.undoId && call.name === 'studio_replace_text') state.lastEdit = { undoId: result.undoId };
      const blocks = [];
      if (result && result.image && result.image.data) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: result.image.mimeType || 'image/jpeg', data: result.image.data } });
        result = { ...result, image: '[attached above]' };
      }
      blocks.push({ type: 'text', text: clip(JSON.stringify(result == null ? { status: 'ok' } : result)) });
      return { type: 'tool_result', tool_use_id: call.id, content: blocks };
    } catch (e) {
      return { type: 'tool_result', tool_use_id: call.id, content: 'Error: ' + String(e && e.message || e).slice(0, 500), is_error: true };
    }
  }

  // Keep requests small: only the latest two page images travel with the conversation.
  function outgoing() {
    let keep = 2;
    const msgs = state.messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map((b) => ({ ...b })) : m.content }));
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!Array.isArray(m.content)) continue;
      m.content = m.content.map((b) => {
        if (b.type === 'tool_result' && Array.isArray(b.content)) {
          return { ...b, content: b.content.map((c) => (c.type === 'image' ? (keep-- > 0 ? c : { type: 'text', text: '[earlier page image omitted]' }) : c)) };
        }
        if (b.type === 'image') return keep-- > 0 ? b : { type: 'text', text: '[earlier image omitted]' };
        return b;
      });
    }
    return msgs;
  }
  function notes() {
    const parts = [];
    parts.push(state.allowEdits ? 'Editing is ON: you may apply exact text edits.' : 'Editing is OFF: read and advise; give exact suggested changes instead of editing.');
    const title = ($('doc-title-input') || {}).value; if (title) parts.push('Open manuscript: ' + title);
    if (state.library && state.lib.failed) parts.push('The Akiva library could not be reached this session.');
    return parts.join('\n');
  }

  // ---------- loop ----------
  async function send(text) {
    if (state.busy || !text.trim()) return;
    let access;
    try { access = window.StudioCreative.requireAccess(); } catch (_e) { addNote('Enter your SoferStudio access key (Studio Home → API Key) to use Claude. No Anthropic API key is needed.', 'warn'); return; }
    state.messages.push({ role: 'user', content: text.trim() });
    addBubble('user', text.trim());
    setBusy(true);
    const controller = new AbortController(); state.abort = controller;
    try {
      const tools = await allTools();
      const libNames = new Set(tools.filter((t) => t.library).map((t) => t.name));
      const payloadTools = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
      for (let step = 0; step < MAX_STEPS; step++) {
        const thinking = addNote('Claude is thinking…', 'live');
        let data;
        try {
          const r = await fetch(API, { method: 'POST', signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access },
            body: JSON.stringify({ messages: outgoing(), tools: payloadTools, speed: state.speed, notes: notes() }) });
          data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || ('Claude HTTP ' + r.status));
        } finally { thinking.remove(); }
        const content = Array.isArray(data.content) ? data.content : [];
        state.messages.push({ role: 'assistant', content });
        for (const b of content) if (b.type === 'text' && b.text.trim()) addBubble('assistant', b.text);
        const calls = content.filter((b) => b.type === 'tool_use');
        if (!calls.length || data.stop_reason !== 'tool_use') break;
        const results = [];
        for (const call of calls) {
          if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
          const line = addNote(describe(call) + '…', 'tool');
          const res = await runTool(call, libNames);
          line.textContent = describe(call) + (res.is_error ? ' — not applied' : '');
          if (res.is_error) line.classList.add('sp-claude-err');
          results.push(res);
        }
        state.messages.push({ role: 'user', content: results });
        if (step === MAX_STEPS - 1) addNote('Paused after many steps. Say “continue” to keep going.', 'warn');
      }
    } catch (e) {
      if (e.name === 'AbortError') addNote('Stopped.', 'warn');
      else addNote(String(e.message || e), 'warn');
      // Leave the history valid for the next message: drop trailing tool results and the tool calls they answer.
      const tail = () => state.messages[state.messages.length - 1];
      if (tail() && tail().role === 'user' && Array.isArray(tail().content)) state.messages.pop();
      if (tail() && tail().role === 'assistant' && Array.isArray(tail().content) && tail().content.some((b) => b.type === 'tool_use')) state.messages.pop();
      if (tail() && tail().role === 'user') state.messages.pop(); // the unanswered question; it stays visible in the chat
      if (tail() && tail().role === 'assistant' && Array.isArray(tail().content) && tail().content.some((b) => b.type === 'tool_use')) state.messages.pop();
    } finally { setBusy(false); state.abort = null; }
  }
  function describe(call) {
    const a = call.input || {};
    let label = LABELS[call.name] || ('Library: ' + call.name.replace(/_/g, ' '));
    if (call.name === 'studio_read_paragraphs') label += ' ' + (a.start || 0) + '–' + ((a.start || 0) + (a.count || 10) - 1);
    else if (call.name === 'studio_search' || /search|find/.test(call.name)) label += ' “\u2068' + String(a.query || a.q || a.source || '').slice(0, 40) + '\u2069”';
    else if (call.name === 'studio_get_pdf_page') label += ' ' + a.page;
    else if (call.name === 'studio_navigate') label += a.page ? ' page ' + a.page : a.paragraphIndex != null ? ' paragraph ' + a.paragraphIndex : ' footnote';
    else if (/get_text|lookup/.test(call.name)) label += ' \u2068' + String(a.ref || a.source || a.query || '').slice(0, 40) + '\u2069';
    return label;
  }

  // ---------- UI ----------
  function md(text) {
    return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .split(/\n{2,}/).map((p) => '<p dir="auto">' + p.replace(/\n/g, '<br>') + '</p>').join('');
  }
  function log() { return $('sp-claude-log'); }
  function addBubble(role, text) {
    const div = document.createElement('div'); div.className = 'sp-claude-msg sp-claude-' + role;
    div.innerHTML = role === 'user' ? '<p dir="auto">' + esc(text).replace(/\n/g, '<br>') + '</p>' : md(text);
    log().append(div); log().scrollTop = log().scrollHeight; return div;
  }
  function addNote(text, kind) {
    const div = document.createElement('div'); div.className = 'sp-claude-note sp-claude-' + (kind || 'info'); div.textContent = text;
    log().append(div); log().scrollTop = log().scrollHeight; return div;
  }
  function setBusy(b) {
    state.busy = b; $('sp-claude-send').hidden = b; $('sp-claude-stop').hidden = !b; $('sp-claude-input').disabled = b;
    if (!b) $('sp-claude-input').focus();
  }
  async function undoLast() {
    if (!state.lastEdit) { addNote('There is no Claude edit to undo in this chat.', 'info'); return; }
    try {
      const st = await window.SeferStudioTools.run('studio_get_state', {}, false);
      await window.SeferStudioTools.run('studio_undo', { documentId: st.documentId, expectedRevision: String(st.revision), undoId: state.lastEdit.undoId }, true);
      state.lastEdit = null; addNote('Undid Claude’s last edit.', 'info');
    } catch (e) { addNote('Could not undo: ' + e.message, 'warn'); }
  }
  function build() {
    const css = document.createElement('style');
    css.textContent = `#sp-claude{position:fixed;top:56px;right:12px;bottom:12px;width:min(440px,calc(100vw - 24px));z-index:60;display:flex;flex-direction:column;background:#fffdf9;color:#1f1d1a;border:1px solid #e7dccd;border-radius:14px;box-shadow:0 18px 50px rgba(30,20,10,.28);font:14px/1.5 system-ui,-apple-system,sans-serif}
#sp-claude[hidden]{display:none}#sp-claude header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #eee3d3;background:#d97757;color:#fff;border-radius:14px 14px 0 0}
#sp-claude header b{flex:1;font-size:15px}#sp-claude header button{background:rgba(255,255,255,.18);color:#fff;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}
.sp-claude-opts{display:flex;flex-wrap:wrap;gap:6px 12px;padding:8px 12px;border-bottom:1px solid #eee3d3;font-size:12px;color:#5b5247}.sp-claude-opts label{display:flex;align-items:center;gap:4px;cursor:pointer}
.sp-claude-opts select{border:1px solid #dccfbd;border-radius:5px;padding:1px 4px;background:#fff;font-size:12px}
#sp-claude-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.sp-claude-msg{padding:8px 11px;border-radius:10px;max-width:92%;overflow-wrap:anywhere}.sp-claude-msg p{margin:0 0 6px}.sp-claude-msg p:last-child{margin:0}
.sp-claude-user{align-self:flex-end;background:#f1e8dc}.sp-claude-assistant{align-self:flex-start;background:#fff;border:1px solid #eee3d3}
.sp-claude-msg code{background:#f4efe8;padding:0 3px;border-radius:3px;font-size:12px}
.sp-claude-note{font-size:12px;color:#7a6f62;padding-left:4px}.sp-claude-tool:before{content:'• '}.sp-claude-warn{color:#a1401f}.sp-claude-err{color:#a1401f}.sp-claude-live{font-style:italic}
.sp-claude-empty{color:#7a6f62;font-size:13px}.sp-claude-empty li{margin:3px 0;cursor:pointer;text-decoration:underline dotted}
#sp-claude form{display:flex;gap:6px;padding:10px;border-top:1px solid #eee3d3}#sp-claude textarea{flex:1;resize:none;border:1px solid #dccfbd;border-radius:8px;padding:7px 9px;font:inherit;min-height:42px;max-height:160px;background:#fff}
#sp-claude form button{border:0;border-radius:8px;padding:0 14px;font-weight:600;cursor:pointer;background:#d97757;color:#fff}#sp-claude form button#sp-claude-stop{background:#3b342c}
@media (prefers-color-scheme: dark){#sp-claude{background:#24211e;color:#eee6dc;border-color:#3d3730}.sp-claude-user{background:#3a332b}.sp-claude-assistant{background:#2c2925;border-color:#3d3730}#sp-claude textarea,.sp-claude-opts select{background:#2c2925;color:#eee6dc;border-color:#4a4239}.sp-claude-opts,.sp-claude-note,.sp-claude-empty{color:#b8ad9f}.sp-claude-msg code{background:#3a332b}}`;
    document.head.append(css);
    const panel = document.createElement('section');
    panel.id = 'sp-claude'; panel.hidden = true; panel.setAttribute('aria-label', 'Claude');
    panel.innerHTML = `<header><b>✳ Claude</b><button type="button" id="sp-claude-undo" title="Undo Claude’s last manuscript edit">Undo edit</button><button type="button" id="sp-claude-new">New chat</button><button type="button" id="sp-claude-close" aria-label="Close">✕</button></header>
<div class="sp-claude-opts"><label>Model <select id="sp-claude-speed"><option value="detail">Opus · most careful</option><option value="fast">Sonnet · faster</option></select></label>
<label title="Claude may change text in the open manuscript and OCR box. Every edit can be undone."><input type="checkbox" id="sp-claude-edits"> Let Claude edit</label>
<label title="Look up sources in the Kisvei Rav Tzadok / Akiva library"><input type="checkbox" id="sp-claude-lib"> Akiva library</label></div>
<div id="sp-claude-log"><div class="sp-claude-empty">Ask Claude about the open manuscript or PDF. For example:<ul>
<li>Find every place the manuscript spells רמב״ם without geresh and fix them.</li><li>Compare the OCR text with PDF page 12 and correct any misreadings.</li>
<li>Where does Rav Tzadok discuss this pasuk? Add a footnote with the source.</li><li>Proofread paragraphs 1–30 for English typos.</li></ul></div></div>
<form id="sp-claude-form"><textarea id="sp-claude-input" rows="2" dir="auto" placeholder="Message Claude…  (Enter to send, Shift+Enter for a new line)"></textarea><button id="sp-claude-send" type="submit">Send</button><button id="sp-claude-stop" type="button" hidden>Stop</button></form>`;
    document.body.append(panel);
    $('sp-claude-speed').value = state.speed; $('sp-claude-edits').checked = state.allowEdits; $('sp-claude-lib').checked = state.library;
    $('sp-claude-speed').onchange = (e) => { state.speed = e.target.value; store.set('speed', state.speed); };
    $('sp-claude-edits').onchange = (e) => { state.allowEdits = e.target.checked; store.set('edits', state.allowEdits); };
    $('sp-claude-lib').onchange = (e) => { state.library = e.target.checked; store.set('library', state.library); };
    $('sp-claude-close').onclick = () => { panel.hidden = true; };
    $('sp-claude-undo').onclick = undoLast;
    $('sp-claude-new').onclick = () => { if (state.busy) return; state.messages = []; state.lastEdit = null; log().innerHTML = ''; addNote('New chat.', 'info'); };
    $('sp-claude-stop').onclick = () => { if (state.abort) state.abort.abort(); };
    panel.querySelectorAll('.sp-claude-empty li').forEach((li) => { li.onclick = () => { $('sp-claude-input').value = li.textContent; $('sp-claude-input').focus(); }; });
    const input = $('sp-claude-input');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('sp-claude-form').requestSubmit(); } });
    $('sp-claude-form').onsubmit = (e) => { e.preventDefault(); const t = input.value; input.value = ''; const empty = log().querySelector('.sp-claude-empty'); if (empty) empty.remove(); send(t); };
    const anchor = $('btn-open-mcp-hub');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'btn-open-claude'; btn.title = 'Ask Claude to work on this manuscript';
    btn.className = 'px-2.5 py-1 rounded text-white font-semibold text-xs flex items-center gap-1 shadow-xs';
    btn.style.background = '#d97757'; btn.innerHTML = '<span aria-hidden="true">✳</span><span>Claude</span>';
    btn.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) input.focus(); };
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor); else { btn.style.cssText += ';position:fixed;right:16px;bottom:16px;z-index:59;padding:8px 14px'; document.body.append(btn); }
  }
  window.SeferProClaude = { open() { const p = $('sp-claude'); if (p) { p.hidden = false; $('sp-claude-input').focus(); } }, send };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
