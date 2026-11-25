// Claude as the cover designer for Sefer Pro: full KDP wraparound covers (art + typography) and stand-alone artwork,
// returned as vector SVG so they print crisply at any DPI. Called from the unified API (POST /v1/design).
import { HttpProblem } from './ocr.mjs';

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';
const SVG_MAX = 600_000;
export const COVER_FONTS = ['Crimson Pro', 'EB Garamond', 'Playfair Display', 'Frank Ruhl Libre', 'David Libre', 'Noto Serif Hebrew', 'Miriam Libre', 'Secular One', 'Times New Roman'];
const bad = (message) => new HttpProblem(400, 'invalid_request', message);
const problem = (status, code, message) => new HttpProblem(status, code, message);

// SVG drawn by the model is used as an <img>/canvas source, where scripts never run; strip anything active or external anyway.
export function cleanSvg(svg) {
  let s = String(svg || '').trim();
  const start = s.indexOf('<svg'), end = s.lastIndexOf('</svg>');
  if (start < 0 || end < start) throw problem(502, 'invalid_design', 'Claude did not return a usable design. Try again.');
  s = s.slice(start, end + 6);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<(image|use|a|iframe|embed|object|audio|video|style)\b[\s\S]*?(\/>|<\/\1>)/gi, (m, tag) => tag.toLowerCase() === 'use' && /href=["']#/.test(m) ? m : '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, 'none');
  if (!/xmlns=/.test(s.slice(0, 300))) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  if (s.length > SVG_MAX) throw problem(502, 'invalid_design', 'The design came back too large. Try again with a simpler brief.');
  return s;
}

async function callClaude(key, system, user, tool, signal, fetcher) {
  let response;
  try {
    response = await fetcher(CLAUDE_URL, {
      method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 32000, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: user }] }),
    });
  } catch { throw problem(502, 'provider_unreachable', 'Claude could not be reached.'); }
  if (!response.ok) {
    if (response.status === 429) throw problem(429, 'provider_rate', 'Claude is busy. Wait a minute and try again.');
    if (response.status === 402 || response.status === 400) {
      const text = await response.text().catch(() => '');
      if (/credit|balance|billing/i.test(text)) throw problem(402, 'provider_billing', 'The Claude API account is out of credits.');
    }
    throw problem(502, 'provider_request', 'Claude rejected the design request (HTTP ' + response.status + ').');
  }
  const data = await response.json();
  const call = (data?.content || []).find((part) => part?.type === 'tool_use');
  if (data?.stop_reason === 'max_tokens' || !call?.input) throw problem(502, 'invalid_design', 'The design was cut short. Try again with a simpler brief.');
  return call.input;
}

const num = (v, lo, hi) => Number.isFinite(+v) && +v >= lo && +v <= hi;
const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const DIRECTIONS = [
  'Classic: a tooled leather binding — rich ground colour, gold filigree, fine double rules and corner ornaments, like a treasured set of sefarim.',
  'Illuminated: inspired by Jerusalem stone, arches and illuminated Hebrew manuscripts — a framed central field, warm stone and gold, delicate geometric or floral ornament.',
  'Refined modern: restrained and elegant — a strong colour field, one confident motif (an arch, a menorah-inspired form, a band of geometric ornament), generous space and crisp typography.',
];

const blockSchema = { type: 'object', required: ['id', 'text', 'font', 'size', 'align', 'x', 'y', 'w', 'h'], properties: {
  id: { type: 'string' }, label: { type: 'string' }, text: { type: 'string' },
  font: { type: 'string', enum: COVER_FONTS }, size: { type: 'number' }, bold: { type: 'boolean' }, italic: { type: 'boolean' },
  align: { type: 'string', enum: ['left', 'center', 'right'] }, direction: { type: 'string', enum: ['auto', 'rtl', 'ltr'] },
  x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, color: { type: 'string' },
} };
const coverTool = { name: 'cover_design', description: 'Return one complete wraparound cover design.', input_schema: {
  type: 'object', required: ['name', 'palette', 'art', 'front', 'back'], properties: {
    name: { type: 'string', description: 'A short name for this design, e.g. "Sapphire & gold leather".' },
    palette: { type: 'object', required: ['bg', 'accent', 'text'], properties: { bg: { type: 'string' }, accent: { type: 'string' }, text: { type: 'string' } } },
    art: { type: 'string', description: 'The full-spread SVG artwork, with NO text.' },
    front: { type: 'array', items: blockSchema }, back: { type: 'array', items: blockSchema },
    spine: { type: 'object', properties: { size: { type: 'number' }, direction: { type: 'string', enum: ['down', 'up'] }, text: { type: 'string' }, accent: { type: 'string' } } },
    notes: { type: 'string' },
  } } };
const artTool = { name: 'artwork', description: 'Return one SVG artwork.', input_schema: { type: 'object', required: ['svg'], properties: { svg: { type: 'string' }, title: { type: 'string' } } } };

const COVER_SYSTEM = `You are an award-winning book-cover designer and an expert SVG illustrator, designing print covers for Akiva Publishing's bilingual Hebrew-English Torah sefarim (Amazon KDP). You design the WHOLE wraparound cover: back panel, spine and front panel, as one SVG artwork, plus the placement and styling of the cover text.

THE ART (field "art"):
- One <svg> with the exact viewBox given (units are PostScript points, 72 per inch, origin top-left, covering the full spread including bleed or hardcover wrap). Fill the whole viewBox edge to edge with background (bleed must be covered).
- Vector only: rect, path, circle, ellipse, line, polyline, polygon, g, defs, linearGradient, radialGradient, pattern, clipPath, mask, filter (feTurbulence, feColorMatrix, feGaussianBlur, feComposite, feBlend, feDisplacementMap are fine for texture), and <use href="#id">. NO <text>, NO <image>, NO external references, NO scripts, NO CSS <style>. Never draw letters: all words are set by the type layer.
- Craft: real ornament drawn with bezier paths (filigree, scrollwork, arabesques, rosettes, geometric interlace, arches), defined once in <defs> and reused with <use> + transform for symmetry. Build depth with gradients, subtle grain or leather texture, foil-like gold gradients (#8a6a2f → #f3dc9a → #a37b35 style), embossed or debossed rules. Keep it tasteful and high-end, never clip-art. Keep the SVG compact (prefer reuse to repetition; under ~150 KB).
- Respect the geometry: keep important ornament inside each panel's safe area; nothing important in the hinge areas; the spine gets its own coherent treatment (bands, rules) that lines up with the panels; leave calm, high-contrast fields where the text blocks will sit.

THE TYPE (fields "front", "back", "spine"):
- Return every text block you are given, with the same id and EXACTLY the same text (never change, translate, shorten or add words). You choose font (from the enum), size in points, bold/italic, alignment, colour (hex) and position.
- x, y, w, h are fractions (0–1) of that panel's SAFE AREA (x from its left, y from its top); every box must stay inside 0–1. Boxes must not overlap each other. Give each box enough room for its text at the chosen size (Hebrew titles need generous height).
- Hebrew text: Frank Ruhl Libre, David Libre, Noto Serif Hebrew, Miriam Libre or Secular One, direction "rtl". English: Crimson Pro, EB Garamond or Playfair Display. Hierarchy: the Hebrew title is the hero on the front, then the English title, subtitle, author, volume.
- The back: the description block set in a readable size (10–13 pt) with comfortable width; keep the lower right of the back panel clear of text (Amazon prints the barcode there); publisher at the bottom left.
- Colours must contrast strongly with the art behind them.

Return the design with the cover_design tool.`;

export async function runDesign(body, env, signal, fetcher = fetch) {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw problem(503, 'not_configured', 'The server operator must configure ANTHROPIC_API_KEY.');
  const brief = typeof body.brief === 'string' ? body.brief.trim().slice(0, 2000) : '';
  if (body.action === 'cover') {
    const g = body.geometry, t = body.texts;
    if (!g || !num(g.totalW, 1, 60) || !num(g.totalH, 1, 60) || !t || !Array.isArray(t.front) || !Array.isArray(t.back) || t.front.length > 30 || t.back.length > 30) throw bad('Send the cover geometry and its texts.');
    const v = Number.isInteger(body.variation) ? Math.abs(body.variation) % DIRECTIONS.length : 0;
    const W = Math.round(g.totalW * 72 * 100) / 100, H = Math.round(g.totalH * 72 * 100) / 100;
    const user = [
      'viewBox: "0 0 ' + W + ' ' + H + '"',
      'Geometry in points (x, y, width, height):\n' + JSON.stringify(g.points),
      'Book: ' + JSON.stringify({ name: String(body.name || '').slice(0, 200), binding: g.format, trim: g.trim, pages: g.pages, language: body.language }),
      'Text blocks to place (keep ids and text exactly):\n' + JSON.stringify({ front: t.front, back: t.back, spine: t.spine }).slice(0, 40000),
      'Design direction for this variation: ' + DIRECTIONS[v],
      brief ? 'The publisher\'s brief (follow it; it outranks the direction above): ' + brief : '',
      body.palette && hex(body.palette.bg) ? 'Current palette, for reference only: ' + JSON.stringify(body.palette) : '',
    ].filter(Boolean).join('\n\n');
    const out = await callClaude(key, COVER_SYSTEM, user, coverTool, signal, fetcher);
    const palette = out.palette && hex(out.palette.bg) && hex(out.palette.accent) && hex(out.palette.text) ? out.palette : null;
    const blocks = (list) => (Array.isArray(list) ? list : []).slice(0, 30).filter((b) => b && typeof b.id === 'string' && typeof b.text === 'string' &&
      ['x', 'y', 'w', 'h'].every((k) => num(b[k], 0, 1)) && num(b.size, 5, 160)).map((b) => ({
      id: b.id.slice(0, 80), label: String(b.label || '').slice(0, 70), text: b.text.slice(0, 20000), font: COVER_FONTS.includes(b.font) ? b.font : 'Crimson Pro',
      size: +b.size, bold: !!b.bold, italic: !!b.italic, align: ['left', 'center', 'right'].includes(b.align) ? b.align : 'center',
      direction: ['auto', 'rtl', 'ltr'].includes(b.direction) ? b.direction : 'auto', x: +b.x, y: +b.y, w: Math.min(+b.w, 1 - b.x), h: Math.min(+b.h, 1 - b.y),
      ...(hex(b.color) ? { color: b.color } : {}),
    }));
    return { name: String(out.name || 'Cover design').slice(0, 80), palette, art: cleanSvg(out.art), front: blocks(out.front), back: blocks(out.back),
      spine: { size: num(out.spine?.size, 6, 72) ? +out.spine.size : null, direction: out.spine?.direction === 'up' ? 'up' : 'down' },
      notes: String(out.notes || '').slice(0, 600) };
  }
  if (body.action === 'art') {
    const ratios = { '1:1': [1600, 1600], '3:4': [1500, 2000], '4:3': [2000, 1500], '16:9': [2048, 1152], '9:16': [1152, 2048], '2:3': [1400, 2100] };
    const [w, h] = ratios[body.ratio] || ratios['3:4'];
    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 1500) : 'Ornate scholarly gold and sapphire filigree';
    const v = Number.isInteger(body.variation) ? body.variation % 4 : 0;
    const system = 'You are an expert SVG illustrator for Akiva Publishing (Jewish scholarly books). Draw high-end vector artwork: real bezier ornament, gradients, textures with SVG filters, symmetry through <defs> and <use>. Vector only: NO <text>, NO <image>, NO external references, NO scripts, NO CSS <style>; never draw letters or words. Fill the whole viewBox. Keep it compact (under ~120 KB). Return it with the artwork tool.';
    const user = 'viewBox "0 0 ' + w + ' ' + h + '". Subject: ' + prompt + '. Style preset: ' + String(body.style || 'royal').slice(0, 60) +
      '. This is variation ' + (v + 1) + ' of 4: make it clearly different from the others in composition (' + ['symmetric frame with an open centre', 'all-over pattern or texture', 'a single central emblem or arch', 'a band or border composition'][v] + ').';
    const out = await callClaude(key, system, user, artTool, signal, fetcher);
    return { svg: cleanSvg(out.svg), width: w, height: h, title: String(out.title || '').slice(0, 80) };
  }
  throw bad('Unknown design action.');
}
