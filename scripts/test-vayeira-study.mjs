import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist/library';
const study = JSON.parse(fs.readFileSync(`${root}/studies/vayeira-mesiras-nefesh.json`, 'utf8'));
assert.equal(study.parashah, 'Vayera');
assert.match(study.authorship, /editorial writing by Akiva Publishing/);
const sections = Object.values(study.sections);
assert.equal(sections.length, 2);
assert.deepEqual(sections.map(s=>s.phrases.length), [25, 34]);
assert.equal(sections[0].next, sections[1].sectionRef);
assert.equal(sections[1].prev, sections[0].sectionRef);
assert.equal(sections[1].next, null);
assert.equal(Object.values(sections[1].heads).filter(h=>/^\d+ · /.test(h[0])).length, 15);
const numbers = [];
for (const section of sections) {
  assert.equal(section.book, 'Akiva Publishing Weekly Torah');
  assert.equal(section.weeklyStudy, true);
  assert.equal(section.pdfPages, 12);
  assert.equal(section.phrases.length, section.he.length);
  assert.equal(section.phrases.length, section.en.length);
  for (let i=0;i<section.phrases.length;i++) {
    const pairs=section.phrases[i];
    assert.equal(section.he[i], pairs.map(p=>p[0]).join(' '));
    assert.equal(section.en[i], pairs.map(p=>p[1]).join(' '));
    assert(!/[\[\]]/.test(section.en[i]), 'English must not be enclosed in brackets');
    if (section.editorialRows.includes(i)) assert.equal(section.he[i], '', 'Editorial prose masquerades as a Hebrew translation');
    else assert.match(section.he[i], /[\u05b0-\u05bd]/, 'Source Hebrew lacks nikkud');
    for (const note of section.annotations[i] || []) {
      numbers.push(note.number);
      const phrase=pairs[note.phraseIndex];
      assert(phrase && phrase[0]);
      assert.equal(note.heCharOffset, phrase[0].length);
      assert(!note.enCharOffset, 'A source marker appeared on English');
      assert(note.paragraphs.some(p=>p.rich?.some(r=>r.bold && /^(https:\/\/www\.sefaria\.org\/|#\/read\/)/.test(r.href))), 'Unlinked source citation');
    }
  }
}
assert.deepEqual(numbers.sort((a,b)=>a-b), Array.from({length:34},(_,i)=>i+1));
assert.equal(fs.readFileSync(`${root}/downloads/vayeira-akeidah-mesiras-nefesh.pdf`).subarray(0,5).toString(), '%PDF-');
assert(fs.statSync(`${root}/downloads/vayeira-akeidah-mesiras-nefesh-cover.webp`).size>1000);
const context={window:{},fetch:async()=>({ok:true,json:async()=>study})};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${root}/vayeira-study.js`,'utf8'),context);
const api=context.window.AkivaVayeiraStudy;
for(const s of sections) {
  assert(api.recognizes(s.sectionRef));
  assert(api.recognizes(s.sectionRef+':1'));
  assert(!api.recognizes(s.sectionRef+':0'));
  assert.equal((await api.fetchText(s.sectionRef)).phrases.length,s.phrases.length);
  assert.equal((await api.fetchText(s.sectionRef+':2')).highlight,s.sectionRef+':2');
}
await assert.rejects(api.fetchText(sections[0].sectionRef+':1000'),/out of range/);
assert(!api.recognizes('Peri Tzadik, Vayera 1'));
const html=fs.readFileSync(`${root}/index.html`,'utf8');
assert(html.includes('window.AkivaVayeiraStudy.fetchText(ref)'));
assert(html.includes('window.AkivaVayeiraStudy.contents()'));
assert(html.includes('window.AkivaVayeiraStudy.attachment(d)'));
for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if(script[1].trim())new vm.Script(script[1]);
console.log('PASS: Vayeira native chapter routes, 15 interlinear sources, 34 linked Hebrew-only source markers, editorial attribution, and PDF attachment.');
