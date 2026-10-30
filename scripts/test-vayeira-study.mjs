import fs from 'node:fs';
import path from 'node:path';
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
const contentsHtml=api.contents();
const attachmentHtml=api.attachment(sections[0]);
for (const link of ['blog/even-the-world-to-come/','blog/even-the-world-to-come/shiur/']) {
  assert(contentsHtml.includes(`href="${link}"`), 'Study contents lacks '+link);
  assert(attachmentHtml.includes(`href="${link}"`), 'Study attachment lacks '+link);
}
const downloads={
  'blog/pdfs/even-the-world-to-come-vayeira.pdf':'%PDF-','blog/docs/even-the-world-to-come-vayeira.docx':'PK',
  'downloads/vayeira-mesiras-nefesh-shiur.pdf':'%PDF-','downloads/vayeira-mesiras-nefesh-shiur.docx':'PK'};
for (const [file,magic] of Object.entries(downloads)) {
  assert.equal(fs.readFileSync(`${root}/${file}`).subarray(0,magic.length).toString(),magic,file);
  assert(contentsHtml.includes(`href="${file}" download`), 'Study contents lacks download '+file);
}
for (const [dir,count] of [['blog/even-the-world-to-come',12],['blog/even-the-world-to-come/shiur',38]]) {
  const pageHtml=fs.readFileSync(`${root}/${dir}/index.html`,'utf8');
  const images=[...pageHtml.matchAll(/<img src="(pages\/page-\d\d\.webp)"/g)].map(m=>m[1]);
  assert.equal(images.length,count,dir+' page count');
  assert.deepEqual(fs.readdirSync(`${root}/${dir}/pages`).sort(),images.map(i=>i.slice(6)),dir+' page files');
  for (const image of images) {
    const bytes=fs.readFileSync(`${root}/${dir}/${image}`);
    assert.equal(bytes.subarray(0,4).toString()+bytes.subarray(8,12).toString(),'RIFFWEBP',image);
  }
  for (const m of pageHtml.matchAll(/href="([^"#]+\.(?:pdf|docx))"/g)) assert(fs.existsSync(path.resolve(`${root}/${dir}`,m[1])),dir+' broken link '+m[1]);
  assert(pageHtml.includes('#/read/Akiva_Publishing_Weekly_Torah%2C_Vayeira_Mesiras_Nefesh_Sources'));
}
const audioFile=`${root}/audio/vayeira-mesiras-nefesh-shiur.m4a`;
assert.equal(fs.statSync(audioFile).size,28781308,'Shiur recording size');
assert.equal(fs.readFileSync(audioFile).subarray(4,8).toString(),'ftyp','Shiur recording is not an M4A');
assert(attachmentHtml.includes('<audio controls preload="none" src="audio/vayeira-mesiras-nefesh-shiur.m4a"'),'Dvar Torah section lacks the shiur player');
assert(attachmentHtml.includes('class="shiur-audio" data-shiur-key="vayeira-mesiras-nefesh-shiur"'));
assert(attachmentHtml.includes('Preview the shiur transcript · 38 pages'));
assert(api.attachment(sections[1]).includes('<audio controls preload="none" src="audio/vayeira-mesiras-nefesh-shiur.m4a"'),'Interlinear sources section lacks the shiur player');
for (const dir of ['blog/even-the-world-to-come','blog/even-the-world-to-come/shiur']) {
  const pageHtml=fs.readFileSync(`${root}/${dir}/index.html`,'utf8');
  const src=pageHtml.match(/<section class="listen" id="listen"[\s\S]*?<audio controls preload="none" src="([^"]+)"/);
  assert(src,dir+' lacks the shiur player');
  assert.equal(path.resolve(`${root}/${dir}`,src[1]),path.resolve(audioFile),dir+' player points elsewhere');
}
assert(contentsHtml.includes('href="audio/vayeira-mesiras-nefesh-shiur.m4a" download'),'Study contents lacks the recording');
const blogIndex=fs.readFileSync(`${root}/blog/index.html`,'utf8');
const card=blogIndex.match(/<article class="card" aria-labelledby="vayeira-feature-title">[\s\S]*?<\/article>/g);
assert.equal(card?.length,1,'One Vayeira listing');
assert(card[0].includes('>Even the World to Come</a>'));
for (const m of card[0].matchAll(/href="([^"#]+)"/g)) {
  const target=path.resolve(`${root}/blog`,m[1]);
  assert(fs.existsSync(target.endsWith('/')||!path.extname(target)?path.join(target,'index.html'):target),'Broken listing link '+m[1]);
}
const html=fs.readFileSync(`${root}/index.html`,'utf8');
assert.equal((html.match(/<a class="weekly-teaser weekly-study-teaser" href="blog\/even-the-world-to-come\/"/g)||[]).length,1,'Home teaser');
assert(html.includes('vayeira-study.js?v=20261030-vayeira-audio-all-sections-v4'));
assert(html.includes('window.AkivaVayeiraStudy.fetchText(ref)'));
assert(html.includes('window.AkivaVayeiraStudy.contents()'));
assert(html.includes('window.AkivaVayeiraStudy.attachment(d)'));
for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if(script[1].trim())new vm.Script(script[1]);
console.log('PASS: Vayeira native chapter routes, 15 interlinear sources, 34 linked Hebrew-only source markers, editorial attribution, PDF attachment, the shiur recording, and the blog and transcribed shiur (12 + 38 pages, PDF and Word).');
