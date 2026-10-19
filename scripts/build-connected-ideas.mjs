#!/usr/bin/env node
// Publish reviewed concept links without changing a sefer's text or footnotes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {validateTranslation} from './build-reviewed-connections.mjs';
import {studySections} from './study-editions.mjs';
const require = createRequire(import.meta.url);
const sources = require('../dist/library/source-connections.js');
const ideas = require('../dist/library/connected-ideas.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const normalize = sources.normalizedHebrew;
const canonical = value => JSON.stringify(value,(_,item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
const content = paragraph => Array.isArray(paragraph.p) ? paragraph.p.map(pair=>pair[0] || '').join(' ') : paragraph.t || '';
const text = (value,label) => { assert(typeof value === 'string' && value.trim(),label+' is missing'); return value.trim(); };
const pinned = (actual,expected,label) => assert(/^[a-f0-9]{64}$/.test(expected || '') && actual === expected,label+' changed or was not reviewed');
function school(book) {
  assert(['Izhbitz',"R' Tzadok HaKohen",'Rav Tzadok HaKohen'].includes(book.group),'Unsupported school for '+book.title);
  return book.group === 'Izhbitz' ? ideas.SCHOOLS[1] : ideas.SCHOOLS[0];
}
function readCanonical(catalog,mcpRoot) {
  const texts = new Map(), books = [...catalog.books].sort((a,b)=>b.title.length-a.title.length);
  return (ref,quote,paragraphPin,sectionPin) => {
    assert(sources.normalizeRef(ref) === ref,'Use an exact canonical reference: '+ref);
    const book = books.find(book=>ref.startsWith(book.title+' ') || ref.startsWith(book.title+','));
    assert(book,'Unknown canonical work: '+ref);
    if (!texts.has(book.slug)) {
      const bytes=fs.readFileSync(path.join(mcpRoot,'text',book.slug+'.json'));
      const data=JSON.parse(bytes); assert(data.slug===book.slug && Array.isArray(data.paras),'Invalid canonical text');
      texts.set(book.slug,{data,sha256:sha(bytes),editions:studySections(book)});
    }
    const {data,sha256,editions}=texts.get(book.slug);
    const matches=data.paras.map((paragraph,index)=>({paragraph,index,section:book.sections[paragraph.s]}))
      .filter(x=>x.paragraph.r===ref && editions.get(x.section.ref).index===x.paragraph.s)
      .sort((a,b)=>a.index-b.index);
    assert(matches.length,'Reference is not an exact paragraph: '+ref);
    // Select the reader's default edition before validating the quotation.
    // An old Hebrew-only duplicate must never rescue a stale study quotation.
    const match=matches[0], full=content(match.paragraph), norm=normalize(full), selected=normalize(quote);
    assert(selected && /[א-ת]/.test(quote),'Missing Hebrew quotation for '+ref);
    const start=(' '+norm+' ').indexOf(' '+selected+' ');
    assert(start>=0,'Quotation is not contiguous in the canonical paragraph: '+ref);
    assert(start===(' '+norm+' ').lastIndexOf(' '+selected+' '),'Quotation has more than one possible anchor in '+ref);
    pinned(sha(norm),paragraphPin,'Reviewed paragraph '+ref);
    const sectionParas=data.paras.slice(match.section.first,match.section.first+match.section.count);
    const sectionHash=sha(normalize(sectionParas.map(content).join(' ')));
    if(sectionPin) pinned(sectionHash,sectionPin,'Reviewed section '+match.section.ref);
    const phrases=match.paragraph.p || [[full,'']];
    let cursor=0, phraseIndex=-1, phraseEnd=-1;
    phrases.forEach((pair,index)=>{
      const length=normalize(pair[0] || '').length;
      if(!length)return;
      if(start>=cursor && start<cursor+length) phraseIndex=index;
      if(start+selected.length>cursor && start+selected.length<=cursor+length) phraseEnd=index;
      cursor+=length+1;
    });
    assert(phraseIndex>=0 && phraseEnd>=phraseIndex,'Quotation cannot be placed at an exact phrase in '+ref);
    return {book,...match,full,phraseIndex,phraseEnd,sectionHash,textSha256:sha256,
      quoteStart:start,paragraphOrder:match.index-match.section.first,
      paragraphSha256:sha(canonical(match.paragraph)),fullHebrewSha256:sha(norm)};
  };
}
export function buildConnectedIdeas(options={}) {
  const mcpRoot=path.resolve(options.mcpRoot || path.join(REPO,'dist/mcp-data'));
  const editorialDir=path.resolve(options.editorialDir || path.join(REPO,'sources/akiva/themes'));
  const output=path.resolve(options.output || path.join(REPO,'dist/library/connected-ideas/catalog.json'));
  assert(!output.startsWith(mcpRoot+path.sep) && !output.startsWith(editorialDir+path.sep)
    && !output.startsWith(path.join(REPO,'dist/library/data')+path.sep),'Output cannot overwrite canonical or editorial inputs');
  const catalogBytes=fs.readFileSync(path.join(mcpRoot,'catalog.json')), catalog=JSON.parse(catalogBytes);
  const lookup=readCanonical(catalog,mcpRoot), records=[], files=[], ids=new Set(), pairs=new Set();
  for(const file of fs.readdirSync(editorialDir).filter(file=>file.endsWith('.json')).sort()) {
    const bytes=fs.readFileSync(path.join(editorialDir,file)), doc=JSON.parse(bytes);
    assert(doc.schemaVersion===1 && Array.isArray(doc.records),'Unknown theme input schema: '+file);
    files.push({path:file,sha256:sha(bytes)});
    for(const input of doc.records) {
      try {
        assert(input.reviewed===true,'Unreviewed concept cannot be published');
        const record={};
        for(const key of ['id','themeTitle','themeSummary','originRef','originHebrew','originEnglish','targetRef','targetHebrew','targetEnglish','school','explanation','translationProvenance']) record[key]=text(input[key],key);
        assert(/^[a-z0-9][a-z0-9._-]*$/.test(record.id) && !ids.has(record.id),'Invalid or repeated ID');
        assert(record.originRef!==record.targetRef,'A passage cannot be its own parallel');
        validateTranslation(record.originEnglish,'Origin translation',[record.originRef]);
        validateTranslation(record.targetEnglish,'Target translation',[record.targetRef]);
        for(const key of ['themeTitle','themeSummary','explanation']) assert(/[A-Za-z]/.test(record[key]),key+' must be English');
        assert(!/^(?:both (?:passages|texts) (?:mention|share|cite)|also (?:mentions|cites))[^.]*\.?$/i.test(record.explanation),'Shared terminology alone cannot approve a connection');
        assert(/^[a-f0-9]{64}$/.test(input.reviewedOriginSectionHebrewSha256 || ''),'The full originating section must be reviewed');
        const origin=lookup(record.originRef,record.originHebrew,input.reviewedOriginHebrewSha256,input.reviewedOriginSectionHebrewSha256);
        if(input.reverseExplanation) {
          for(const key of ['reverseExplanation','reverseThemeTitle','reverseThemeSummary']) {
            record[key]=text(input[key],key);assert(/[A-Za-z]/.test(record[key]),key+' must be English');
          }
          assert(/^[a-f0-9]{64}$/.test(input.reviewedTargetSectionHebrewSha256 || ''),'A reciprocal thread requires full target-section review');
          record.reviewedTargetSectionHebrewSha256=input.reviewedTargetSectionHebrewSha256;
        } else assert(!input.reverseThemeTitle && !input.reverseThemeSummary && !input.reviewedTargetSectionHebrewSha256,
          'Incomplete reciprocal review cannot publish');
        const target=lookup(record.targetRef,record.targetHebrew,input.reviewedTargetHebrewSha256,record.reviewedTargetSectionHebrewSha256);
        assert(record.school===school(target.book),'Wrong school for target');
        const pair=record.originRef+'\0'+record.targetRef;
        assert(!pairs.has(pair),'Repeated origin-to-target theme connection');
        record.reviewed=true;
        record.reviewedOriginHebrewSha256=input.reviewedOriginHebrewSha256;
        record.reviewedOriginSectionHebrewSha256=input.reviewedOriginSectionHebrewSha256;
        record.reviewedTargetHebrewSha256=input.reviewedTargetHebrewSha256;
        record.placement={originSectionRef:origin.section.ref,originPhraseIndex:origin.phraseIndex,originPhraseEnd:origin.phraseEnd,
          originParagraphOrder:origin.paragraphOrder,originSchool:school(origin.book),
          targetSectionRef:target.section.ref,targetPhraseIndex:target.phraseIndex,targetPhraseEnd:target.phraseEnd,
          targetParagraphOrder:target.paragraphOrder};
        const proof=value=>({book:value.book.slug,ref:value.paragraph.r,sectionRef:value.section.ref,
          edition:value.section.il?'interlinear':'hebrew',textSha256:value.textSha256,paragraphSha256:value.paragraphSha256,
          fullHebrewSha256:value.fullHebrewSha256,sectionHebrewSha256:value.sectionHash,quoteStart:value.quoteStart});
        record.evidence={editorialFile:file,editorialFileSha256:sha(bytes),origin:proof(origin),target:proof(target),
          originEnglishSha256:sha(record.originEnglish),targetEnglishSha256:sha(record.targetEnglish),
          relation:'individually-reviewed-conceptual-parallel',quotation:'exact-contiguous-canonical-Hebrew',
          translation:'editorial-review',reverseRelation:record.reverseExplanation?'individually-reviewed':'not-approved'};
        assert(ideas.validRecord(record),'Invalid published theme record');
        records.push(record); ids.add(record.id); pairs.add(pair);
      } catch(error) {throw new Error(file+': '+(input.id || '(missing id)')+': '+error.message,{cause:error});}
    }
  }
  assert(records.length,'No reviewed thematic connections');
  records.sort((a,b)=>a.id.localeCompare(b.id));
  const coverage=catalog.books.map(book=>{
    const sections=[...new Set(book.sections.map(section=>section.ref))];
    const reviewed=sections.filter(ref=>ideas.forSection(records,ref).length);
    return {book:book.title,sections:sections.length,sectionsWithReviewedIdeas:reviewed.length,reviewedSections:reviewed};
  });
  const counts={records:records.length,origins:new Set(records.map(r=>r.originRef)).size,
    sectionsWithReviewedIdeas:coverage.reduce((sum,b)=>sum+b.sectionsWithReviewedIdeas,0),
    worksWithReviewedIdeas:coverage.filter(b=>b.sectionsWithReviewedIdeas).length,
    schools:Object.fromEntries(ideas.SCHOOLS.map(s=>[s,records.filter(r=>r.school===s).length]))};
  const provenance={editorialFiles:files,mcpCatalogSha256:sha(catalogBytes),mcpDataVersion:catalog.version};
  const contentSha256=sha(canonical({release:ideas.VERSION,records,coverage,provenance}));
  const result={schemaVersion:1,release:ideas.VERSION,version:ideas.VERSION+'-'+contentSha256.slice(0,16),contentSha256,
    date:options.date || new Date().toISOString().slice(0,10),counts,coverage,provenance,records};
  if(options.write!==false){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');}
  return {catalog:result,output};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=buildConnectedIdeas({write:!process.argv.includes('--check')});
  console.log(JSON.stringify({ok:true,version:result.catalog.version,counts:result.catalog.counts,output:result.output}));
}
