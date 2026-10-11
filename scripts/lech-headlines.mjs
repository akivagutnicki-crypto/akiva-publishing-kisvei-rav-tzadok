// Restore section headlines and topical subheadlines from the three published
// Lech Lecha Word editions without changing their Hebrew/English text.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { unzipSync } = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');

const stripHe = value => String(value ?? '')
  .replace(/<[^>]*>/g, '').replace(/&(?:quot|amp|lt|gt|#\d+);/g, ' ')
  .normalize('NFD').replace(/[\u0591-\u05c7]/g, '')
  .replace(/[^\u05d0-\u05ea]/g, '');
const cleanMark = v => String(v ?? '').normalize('NFD').replace(/[\u0591-\u05c7]/g, '');
const entities = v => String(v).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(?:amp|lt|gt|quot|apos);/g, m => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[m]);
const DOCS = {
  pri: 'dist/library/downloads/pri-tzaddik-lech-lecha-interlinear.docx',
  beit: 'dist/library/downloads/beit-yaakov-lech-lecha-interlinear.docx',
  mei: 'dist/library/downloads/mei-hashiloach-lech-lecha-interlinear.docx'
};
const hebNumber = value => {
  const letters = cleanMark(value).replace(/[^א-ת]/g, '');
  const nums = {א:1,ב:2,ג:3,ד:4,ה:5,ו:6,ז:7,ח:8,ט:9,י:10,כ:20,ל:30,מ:40,נ:50,ס:60,ע:70,פ:80,צ:90,ק:100,ר:200,ש:300,ת:400};
  return [...letters].reduce((s, c) => s + (nums[c] || 0), 0);
};
function groupKey(heading, kind) {
  const t = cleanMark(heading);
  if (kind === 'mei') {
    if (/לקוטי|ליקוטי/.test(t)) return 'anthology';
    if (/חלק\s*ב/.test(t)) return 'volume2';
    return 'volume1';
  }
  const m = t.match(/אות\s*([א-ת״׳"']+)/);
  if (!m) return null;
  return String(hebNumber(m[1]));
}
function readGroups(kind) {
  const file = DOCS[kind];
  if (!fs.existsSync(file)) throw Error('Missing headline source DOCX: ' + file);
  const z = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const part = z['word/document.xml'];
  if (!part) throw Error('Missing Word document.xml: ' + file);
  const xml = new TextDecoder().decode(part);
  const groups = [];
  let g = null, active = null;
  for (const hit of xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const p = hit[0];
    const style = (p.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/) || [])[1] || 'Normal';
    const content = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x => entities(x[1])).join('').trim();
    if (!content) continue;
    if (style === 'Heading1') {
      g = {key:groupKey(content,kind), label:content, title:'', heads:[]};
      if (!g.key) throw Error('Unrecognized Lech Lecha ois in ' + file + ': ' + content);
      groups.push(g); active = null;
    } else if (style === 'Heading2' && g) {
      g.title = content; active = null;
    } else if (style === 'Heading3' && g) {
      active = {text:content, lead:''}; g.heads.push(active);
    } else if (style === 'Normal' && active && !active.lead && /[א-ת]/.test(content)) {
      active.lead = content; active = null;
    }
  }
  if (groups.some(g => !g.title || !g.heads.length)) throw Error('Incomplete Word headline hierarchy in ' + file);
  return groups;
}
const cache = new Map();
export function lechGroups(kind) {
  if (!cache.has(kind)) cache.set(kind, readGroups(kind));
  return cache.get(kind);
}
function targets(paragraphs) {
  const flat = [];
  paragraphs.forEach((p, pIndex) => {
    if (!Array.isArray(p)) return;
    p.forEach((pair, phraseIndex) => {
      if (!Array.isArray(pair)) return;
      const hebrew = stripHe(pair[0]);
      if (hebrew) flat.push({pIndex, phraseIndex, hebrew});
    });
  });
  return flat;
}
function matchingPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
// Match the original Word paragraph's opening Hebrew to the first phrase of
// that passage. Use monotonically increasing source positions, so repeated
// biblical quotations cannot move a heading backwards to an earlier section.
function anchor(blocks, paragraphs) {
  const flat = targets(paragraphs);
  const positioned = [];
  let after = 0;
  for (const block of blocks) {
    const opening = stripHe(block.lead).slice(0, 75);
    if (!opening) continue;
    let best = null;
    for (let k = after; k < flat.length; k++) {
      let text = '';
      for (let j = k; j < Math.min(flat.length, k+8) && text.length < 110; j++) text += flat[j].hebrew;
      const score = matchingPrefix(opening, text);
      if (!best || score > best.score) best = {...flat[k], k, score};
      if (score >= Math.min(opening.length, 60)) break;
    }
    if (best && best.score >= Math.min(14, opening.length)) {
      positioned.push({...best, text:block.text, kind:block.kind || 'subheading'});
      after = best.k + (block.kind === 'section' ? 0 : 1);
    }
  }
  return {positioned, expected:blocks.length};
}
function applyToItems(items, found) {
  const rows = items.filter(i => Array.isArray(i.p));
  const addBefore = new Map();
  found.forEach(h => {
    if (h.phraseIndex === 0) {
      const q = addBefore.get(h.pIndex) || [];
      q.push(h); addBefore.set(h.pIndex, q);
    } else {
      const row = rows[h.pIndex];
      if (row) (row.inlineHeadings ||= []).push({phraseIndex:h.phraseIndex,text:h.text,kind:h.kind});
    }
  });
  let p = 0;
  return items.flatMap(item => {
    if (!Array.isArray(item.p)) return [item];
    const heads = (addBefore.get(p++) || []).map(h => ({h:h.kind === 'section' ? '§ ' + h.text : h.text}));
    return [...heads, item];
  });
}
export function addLechDocumentHeadings(section, kind, matchingParagraphs = null) {
  const key = (section.key || '').match(/Lech Lecha (\d+)$/)?.[1];
  if (!key) return section;
  const groups = lechGroups(kind).filter(g => g.key === key);
  if (!groups.length) return section;
  section.en = groups[0].title;
  // Replace only old topical markers, never the translated text or tables.
  if (kind === 'beit') section.items = section.items.filter(i => i.p || i.table);
  const paragraphs = matchingParagraphs || section.items.filter(i=>Array.isArray(i.p)).map(i=>i.p);
  const blocks = groups.flatMap((g, idx) => [
    ...(idx ? [{kind:'section', text:g.label + ' — ' + g.title,lead:g.heads[0].lead}] : []),
    ...g.heads.map(h=>({...h,kind:'subheading'}))
  ]);
  const m = anchor(blocks, paragraphs);
  section.items = applyToItems(section.items, m.positioned);
  console.log('Lech Lecha headlines '+kind+' ois '+key+': '+m.positioned.length+'/'+m.expected+' anchored');
  return section;
}
export function meiLechHeadingIndex(sections) {
  const groups=lechGroups('mei');
  const index={};
  for (const sec of sections) {
    if (!sec.ref.endsWith(', Lech Lecha')) continue;
    const key=sec.ref.includes('Volume II')?'volume2':sec.ref.includes('Anthology')?'anthology':'volume1';
    const list=groups.filter(g=>g.key===key);
    const blocks=list.flatMap((g,j)=>[
      ...(j?[{text:g.label+' — '+g.title,lead:g.heads[0].lead,kind:'section'}]:[]),
      ...g.heads.map(h=>({...h,kind:'subheading'}))
    ]);
    const m=anchor(blocks,sec.paragraphs);
    const before=Object.fromEntries(sec.paragraphs.map((_,i)=>[i,[]]));
    const inline={};
    for (const h of m.positioned) {
      if (h.phraseIndex === 0) before[h.pIndex].push(h.kind === 'section' ? '§ ' + h.text : h.text);
      else (inline[h.pIndex] ||= []).push({phraseIndex:h.phraseIndex,text:h.text,kind:h.kind});
    }
    index[sec.ref] = { title:list[0]?.title || sec.title || 'Lech Lecha',
      headings: sec.paragraphs.map((_,i)=>before[i].join('\n')),
      phraseHeadings:inline };
    console.log('Lech Lecha headlines mei '+key+': '+m.positioned.length+'/'+m.expected+' anchored');
  }
  return index;
}
