#!/usr/bin/env node
// Full-context editorial packets from an internal, immutable retrieval snapshot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CAUTION,DEFAULT_OUTPUT,safeInternalOutput,writeInternalFile,selectOrigins,sha,translationAvailability,citationsOf} from './build-theme-candidates.mjs';

function verifiedFile(root,file) {
  assert(typeof file.path==='string' && file.path && !path.isAbsolute(file.path),'Invalid snapshot file path');
  const absolute=path.resolve(root,file.path);
  assert(absolute.startsWith(path.resolve(root)+path.sep),'Snapshot file escapes its directory');
  assert(fs.realpathSync(absolute)===absolute,'Snapshot evidence cannot be redirected through a symbolic link');
  const bytes=fs.readFileSync(absolute);
  assert(sha(bytes)===file.sha256,'Snapshot evidence changed: '+file.path);return bytes;
}

export function openCandidateSnapshot(input=DEFAULT_OUTPUT) {
  const root=safeInternalOutput(input),bytes=fs.readFileSync(path.join(root,'manifest.json')),manifest=JSON.parse(bytes);
  assert(manifest.schemaVersion===1 && manifest.kind==='internal-theme-candidate-index' && manifest.reviewed===false,'This is not an internal candidate snapshot');
  const {contentSha256,...body}=manifest;
  assert(sha(JSON.stringify(body))===contentSha256,'Candidate manifest changed');
  const documents=JSON.parse(verifiedFile(root,manifest.documents));
  const catalog=JSON.parse(verifiedFile(path.join(root,'corpus'),manifest.corpus.files.find(file=>file.path==='catalog.json')));
  const byRef=new Map(documents.map(d=>[d.ref,d])),rawBooks=new Map(),queries=new Map();
  function bookData(slug) {
    if(!rawBooks.has(slug)){
      const evidence=manifest.corpus.files.find(file=>file.path==='text/'+slug+'.json');
      assert(evidence,'Work is absent from the canonical snapshot: '+slug);
      rawBooks.set(slug,JSON.parse(verifiedFile(path.join(root,'corpus'),evidence)));
    }
    return rawBooks.get(slug);
  }
  function queryFor(document) {
    if(!queries.has(document.book)){
      const file=manifest.candidateFiles.find(file=>file.path==='candidates/'+document.book+'.jsonl');
      assert(file,'This work was enumerated but has not been queried; build candidates for it first: '+document.bookTitle);
      const rows=verifiedFile(root,file).toString('utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
      queries.set(document.book,new Map(rows.map(row=>[row.originRef,row])));
    }
    const row=queries.get(document.book).get(document.ref);
    assert(row,'This subsection has not been queried; extend the discovery range first: '+document.ref);
    assert(row.reviewed===false && row.kind==='unreviewed-theme-candidates','Candidate schema cannot contain approved records');
    assert(row.paragraphHebrewSha256===document.paragraphHebrewSha256 && row.sectionHebrewSha256===document.sectionHebrewSha256,'Candidate origin changed');
    return row;
  }
  return {root,manifest,catalog,documents,byRef,bookData,queryFor};
}

function paragraphView(paragraph,sectionRef,order) {
  return {ref:paragraph.r,sectionRef,order,number:paragraph.n,
    hebrew:paragraph.p?paragraph.p.map(pair=>pair[0] || '').join(' '):paragraph.t || '',
    english:paragraph.p?paragraph.p.map(pair=>pair[1] || '').join(' '):'',
    translation:translationAvailability(paragraph),citations:citationsOf(paragraph),
    headings:paragraph.h || [],inlineHeadings:paragraph.inlineHeadings || [],footnotes:paragraph.f || [],
    transcriptionNotes:paragraph.x || [],paragraphBreaks:paragraph.paragraphBreaks || [],
    canonicalParagraphSha256:sha(JSON.stringify(paragraph))};
}

export function buildThemeReviewPacket(options={}) {
  assert(options.book || options.section || options.ref,'Select an exact book title/slug, section, or subsection for the editorial packet');
  const snapshot=openCandidateSnapshot(options.input),selected=selectOrigins(snapshot.documents,options),sections=new Map(),continuityReviews=new Map(),orderedSections=new Map();
  function addSection(document) {
    const key=document.book+':'+document.sectionIndex;
    if(!sections.has(key)){
      const book=snapshot.catalog.books.find(b=>b.slug===document.book),section=book.sections[document.sectionIndex];
      assert(section && section.ref===document.sectionRef,'Default-edition section pointer changed');
      const data=snapshot.bookData(document.book),paragraphs=data.paras.slice(section.first,section.first+section.count);
      assert(paragraphs.length===section.count,'Incomplete canonical section context');
      sections.set(key,{contextId:key,ref:section.ref,book:book.title,slug:book.slug,school:document.school,
        edition:document.edition,title:section.title || section.ref,path:section.path || '',
        sectionHebrewSha256:document.sectionHebrewSha256,paragraphs:paragraphs.map((p,i)=>paragraphView(p,section.ref,i))});
    }
    return key;
  }
  function sectionSequence(book) {
    if(!orderedSections.has(book)){
      const rows=snapshot.documents.filter(d=>d.book===book),refs=[...new Set(rows.map(d=>d.sectionRef))];
      orderedSections.set(book,refs.map(ref=>rows.filter(d=>d.sectionRef===ref)
        .sort((a,b)=>Number(b.edition==='interlinear')-Number(a.edition==='interlinear') || a.order-b.order)[0]));
    }
    return orderedSections.get(book);
  }
  function continuityFor(document) {
    const contextId=addSection(document);
    if(!continuityReviews.has(contextId)){
      const sequence=sectionSequence(document.book),position=sequence.findIndex(d=>d.sectionRef===document.sectionRef);
      assert(position>=0,'Origin section is absent from canonical book order');
      const pending=(row,role)=>({role,status:row?'pending':'book-boundary',sectionRef:row?.sectionRef || null,
        contextId:row?addSection(row):null,editorialStatement:'',supportingRefs:[]});
      continuityReviews.set(contextId,{id:contextId,status:'pending',originSectionRef:document.sectionRef,
        previous:pending(sequence[position-1],'transition-from-previous-section'),
        core:pending(document,'current-section-thesis'),next:pending(sequence[position+1],'transition-to-next-section'),
        requiredForApproval:'Each non-boundary editorial statement needs exact supporting paragraph references and a contextual review. Sequence alone supplies no narrative transition or conceptual thesis.'});
    }
    return contextId;
  }
  const origins=selected.map(document=>{
    const query=snapshot.queryFor(document),contextId=addSection(document),continuityReviewId=continuityFor(document);
    const original=snapshot.bookData(document.book).paras[document.index];
    assert(sha(JSON.stringify(original))===document.canonicalParagraphSha256,'Selected canonical paragraph changed');
    const schools=query.schools.map(school=>({...school,candidates:school.candidates.map(candidate=>{
      const target=snapshot.byRef.get(candidate.ref);assert(target,'Candidate has no exact canonical target');
      assert(target.school===school.school && candidate.paragraphHebrewSha256===target.paragraphHebrewSha256 && candidate.sectionHebrewSha256===target.sectionHebrewSha256,'Candidate target evidence changed');
      return {...candidate,contextId:addSection(target)};
    })}));
    const explicitlyCitedSections=(query.citedCanonicalSections || []).map(citation=>({...citation,contextIds:[...new Set(snapshot.documents.filter(d=>d.sectionRef===citation.ref).map(addSection))]}));
    return {ref:document.ref,contextId,continuityReviewId,paragraphHebrewSha256:document.paragraphHebrewSha256,sectionHebrewSha256:document.sectionHebrewSha256,
      translation:document.translation,existingEditorialReview:query.existingEditorialReview || 'pending',
      editorialDecision:{status:'pending',assessment:'',candidateDecisions:[]},schools,explicitlyCitedSections};
  });
  const packet={schemaVersion:1,kind:'internal-theme-review-packet',reviewed:false,caution:CAUTION,
    selection:{book:options.book || null,section:options.section || null,ref:options.ref || null,start:options.start || 1,count:options.count || null},
    snapshot:{manifestSha256:sha(fs.readFileSync(path.join(snapshot.root,'manifest.json'))),contentSha256:snapshot.manifest.contentSha256,
      mcpCatalogSha256:snapshot.manifest.corpus.catalogSha256,method:snapshot.manifest.method},
    counts:{selectedSubsections:origins.length,completeContextSections:sections.size,pendingSectionContinuityReviews:continuityReviews.size,
      candidatePairs:origins.reduce((n,o)=>n+o.schools.reduce((m,s)=>m+s.candidates.length,0),0),
      previouslyCompletedSubsectionReviews:origins.filter(o=>o.existingEditorialReview!=='pending').length,
      newCompletedReviews:0},
    instructions:[
      'Read the complete originating section and identify this subsection’s actual argument before considering a parallel.',
      'Examine the exact previous and next canonical sections. Leave continuity statements pending until specific supporting paragraph references establish a relationship; ordering alone does not.',
      'Read each proposed target in its complete context. The retrieval evidence is a lead, never an explanation or scholarly verdict.',
      'Compare both schools, record rejected and deferred candidates, and leave the subsection pending if the search remains incomplete.',
      'Verify every selected Hebrew quotation as a contiguous complete thought. Translate missing English and review existing English against the Hebrew, preserving qualifications.',
      'Approve only a specific illuminating relation. Explain what the target adds; a shared citation or theme word is insufficient.',
      'Author approved records and explicit subsection-review entries separately through the documented themes and theme-reviews workflow. This packet has no publication or approval importer.'
    ],origins,continuityReviews:[...continuityReviews.values()],contexts:[...sections.values()]};
  const output=safeInternalOutput(options.output || path.join(snapshot.root,'packets'));
  const label=(options.book || options.section || options.ref).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'selection';
  const stem=label+'-'+(options.start || 1)+'-'+origins.length+'-'+snapshot.manifest.contentSha256.slice(0,8);
  const jsonPath=path.join(output,stem+'.json'),markdownPath=path.join(output,stem+'.md');
  if(options.write!==false){writeInternalFile(jsonPath,JSON.stringify(packet,null,2)+'\n');writeInternalFile(markdownPath,renderPacketMarkdown(packet));}
  return {packet,jsonPath,markdownPath};
}

const inline=value=>String(value || '').replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|');
function evidenceText(candidate) {
  const e=candidate.evidence,parts=[];
  if(e.directCitations.length)parts.push('Explicit citation metadata: '+e.directCitations.map(c=>c.direction+' '+c.ref+' ['+c.location.kind+']').join('; '));
  if(e.sharedCitations.length)parts.push('Shared source: '+e.sharedCitations.map(c=>c.ref+' ('+c.granularity+'; origin '+c.originLocation.kind+', target '+c.targetLocation.kind+')').join('; '));
  if(e.sharedHebrewPhrases.length)parts.push('Hebrew phrases: '+e.sharedHebrewPhrases.join(' / '));
  if(e.sharedHebrewTerms.length)parts.push('Hebrew terms: '+e.sharedHebrewTerms.join(', '));
  if(e.sharedEnglishPhrases.length)parts.push('English phrases: '+e.sharedEnglishPhrases.join(' / '));
  if(e.sharedEnglishTerms.length)parts.push('English terms: '+e.sharedEnglishTerms.join(', '));
  return parts.join('. ');
}
export function renderPacketMarkdown(packet) {
  const out=['# Editorial connection review packet','',`**${CAUTION}**`,'',
    `Scope: ${packet.counts.selectedSubsections} selected subsections; ${packet.counts.completeContextSections} complete context sections; ${packet.counts.candidatePairs} candidate comparisons.`,
    `Existing completed subsection reviews: ${packet.counts.previouslyCompletedSubsectionReviews}. New completed reviews generated: 0.`,'',
    'Existing English is reproduced from the canonical publication. “Present” measures coverage of phrase fields, not translation accuracy.','',
    '## Review method','',...packet.instructions.map((line,i)=>`${i+1}. ${line}`),'','## Section continuity worklist','',
    'These are exact neighbors within each canonical book. No transition or core thesis has been inferred. Each non-boundary statement requires exact supporting paragraph references before editorial approval.',''];
  for(const review of packet.continuityReviews || []){
    out.push('### '+review.originSectionRef+' — continuity pending','',
      '| Position | Exact section | Complete context | Editorial statement | Supporting paragraph refs |','|---|---|---|---|---|');
    for(const key of ['previous','core','next']){
      const item=review[key];
      out.push(`| ${key} | ${inline(item.sectionRef || 'Book boundary')} | ${item.contextId || '—'} | ${item.status==='book-boundary'?'Not applicable':'Pending; no statement generated'} | ${item.status==='book-boundary'?'—':'Required; not supplied'} |`);
    }
    out.push('');
  }
  out.push('## Ordered subsection worklist','');
  for(const origin of packet.origins){
    out.push('### '+origin.ref,'',`Full originating context: **${origin.contextId}**. Section continuity review: **${origin.continuityReviewId}**. Existing editorial status: **${origin.existingEditorialReview}**.`,
      `English availability: **${origin.translation.status}**. Paragraph pin: \`${origin.paragraphHebrewSha256}\`.`,
      '','Subsection assessment: _pending; no decision has been generated._','');
    for(const school of origin.schools){
      out.push('#### '+school.school,'');
      if(!school.candidates.length){out.push('No candidate met this retrieval configuration. This is not a finding that no illuminating comparison exists.','');continue;}
      out.push('| Exact candidate | Complete context | Retrieval evidence — requires review | English availability |','|---|---|---|---|');
      for(const candidate of school.candidates)out.push(`| ${inline(candidate.ref)} | ${candidate.contextId} | ${inline(evidenceText(candidate))} | ${candidate.translation.status} |`);
      out.push('','For each candidate: _pending / reject / defer / approve after separate editorial review_; state a specific reason.','');
    }
    if(origin.explicitlyCitedSections.length)out.push('Explicit section citations, without an inferred paragraph: '+origin.explicitlyCitedSections.map(c=>c.ref+' — '+c.contextIds.join(', ')).join('; ')+'.','');
  }
  out.push('## Complete canonical contexts','', 'Each section below is complete in the selected canonical edition. Headings and footnotes are separated from the author’s paragraph text.','');
  for(const context of packet.contexts){
    out.push(`### ${context.contextId} — ${context.ref}`,'',`${context.school}; ${context.edition} edition. Full-section pin: \`${context.sectionHebrewSha256}\`.`, '');
    for(const paragraph of context.paragraphs){
      out.push('#### '+paragraph.ref,'');
      if(paragraph.headings.length)out.push('Published headings: '+paragraph.headings.map(inline).join(' / '),'');
      out.push('**Hebrew**','',paragraph.hebrew || '_No Hebrew in this published paragraph._','','**Existing English — not newly reviewed**','',paragraph.english || '_Missing: a translation must be supplied and reviewed before quoting this passage in an approved connection._','');
      if(paragraph.footnotes.length){out.push('**Published footnotes — separate from the author’s text**','');for(const note of paragraph.footnotes)out.push(`- ${inline(note[0])}: ${note[1]}`);out.push('');}
      if(paragraph.transcriptionNotes.length)out.push('Published transcription notes: '+paragraph.transcriptionNotes.join(' / '),'');
    }
  }
  return out.join('\n')+'\n';
}
function parseArgs(args) {
  const result={},fields={'--input':'input','--book':'book','--section':'section','--ref':'ref','--start':'start','--count':'count','--out-dir':'output'};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--check'){result.write=false;continue;}
    const field=fields[args[i]];assert(field && args[i+1]!==undefined,'Unknown or incomplete argument '+args[i]);
    result[field]=field==='start'||field==='count'?Number(args[++i]):args[++i];
  }
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=buildThemeReviewPacket(parseArgs(process.argv.slice(2)));console.log(JSON.stringify({ok:true,json:result.jsonPath,markdown:result.markdownPath,counts:result.packet.counts,warning:CAUTION}));}
  catch(error){console.error(error.stack || error.message);process.exitCode=1;}
}
