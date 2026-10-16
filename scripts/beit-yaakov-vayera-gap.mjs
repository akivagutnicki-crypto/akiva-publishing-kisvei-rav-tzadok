// The later supplied Vayera 22–26 supplement fills the canonical TOC gap.
// Append storage IDs so every previously published chapter keeps its address.
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const SOURCE='sources/akiva/overlays/beit-yaakov-vayera-22-26.md';
const PACK='sources/akiva/overlays/beit-yaakov-vayera-22-26.json';
const PACK_SHA256='6843d5eec4fc20c08f33f28c8d288cf732b021fbadc0e32adfb1719b3369fa53';
const BOOK='Beit Yaakov on Torah';
const COUNTS=[147,61,63,44,133];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw Error('Beit Yaakov Vayera supplement: '+message);};
const decode=value=>String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key)=>{
  if(key[0]==='#')return String.fromCodePoint(/^#x/i.test(key)?parseInt(key.slice(2),16):Number(key.slice(1)));
  return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'})[key]??all;
});
const plain=value=>decode(String(value).replace(/<[^>]*>/g,''));

// Balanced brackets retain the nested English gloss in Ois 25. Only the
// bracket characters are removed, in accordance with the reader edition.
export function extractVayeraGapMarkdown(markdown){
  const heads=[...markdown.matchAll(/^###\s+([^\n]*)\n/gm)];
  if(heads.length!==5)fail('Expected five supplied section headings');
  return heads.map((heading,index)=>{
    const body=decode(markdown.slice(heading.index+heading[0].length,heads[index+1]?.index)).trim();
    const pairs=[];let at=0;
    while(at<body.length){
      const start=body.indexOf('[',at);
      if(start<0){if(body.slice(at).trim())fail('Unpaired Hebrew in Ois '+(22+index));break;}
      let depth=1,end=start+1;
      while(depth&&end<body.length){if(body[end]==='[')depth++;else if(body[end]===']')depth--;end++;}
      if(depth)fail('Unclosed English bracket in Ois '+(22+index));
      const he=body.slice(at,start).trim();
      const en=body.slice(start+1,end-1).trim().replace(/[\[\]]/g,'');
      if(!he||!en)fail('Unpaired phrase in Ois '+(22+index));
      pairs.push([he,en]);at=end;
    }
    return {ois:22+index,heading:decode(heading[1]).trim(),pairs};
  });
}

export function readBeitYaakovVayeraGap(){
  const bytes=fs.readFileSync(PACK);
  if(sha(bytes)!==PACK_SHA256)fail('Linked source package checksum changed');
  const pack=JSON.parse(bytes);
  const source=fs.readFileSync(SOURCE);
  if(pack.book!==BOOK||pack.schemaVersion!==1||pack.sourceSha256!==sha(source))fail('Invalid supplied source provenance');
  const raw=extractVayeraGapMarkdown(source.toString('utf8'));
  if(pack.sections?.length!==5)fail('Expected all five missing sections');
  for(const [index,section]of pack.sections.entries()){
    const ois=22+index;
    if(section.key!==`Vayera ${ois}`||section.ois!==ois||section.sep!==':'||!section.en||!section.he)
      fail('Section identity or numbering changed: '+ois);
    if(!/^https:\/\/www\.sefaria\.org\//.test(section.sourceUrl||''))fail('Missing verified source URL: '+ois);
    if(section.items?.length!==1)fail('Preserve the supplied paragraph in Ois '+ois);
    const item=section.items[0];
    if(item.n!==1||item.p?.length!==COUNTS[index]||item.footnotes)fail('Paragraph or phrase coverage changed: '+ois);
    if(JSON.stringify(item.p.map(pair=>pair.map(plain)))!==JSON.stringify(raw[index].pairs))
      fail('The supplied Hebrew or English changed: '+ois);
    if(!item.inlineHeadings?.length||item.inlineHeadings.some(h=>!Number.isInteger(h.phraseIndex)||h.phraseIndex<0||h.phraseIndex>=item.p.length||!/[A-Za-z]/.test(h.text)))
      fail('Missing or misaligned editorial subheadings: '+ois);
    const verified=new Set((section.audit?.verifiedSources||[]).map(source=>source.ref));
    const verifiedTargets=new Set((section.audit?.verifiedSources||[]).map(source=>source.ref+'\0'+source.url));
    for(const pair of item.p)for(const text of pair)for(const match of text.matchAll(/<a\b([^>]*)>/g)){
      const attributes=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
      if(!verifiedTargets.has(attributes['data-ref']+'\0'+attributes.href))
        fail('Unverified citation target '+attributes['data-ref']+' in Ois '+ois);
    }
    if(!item.connections?.length||item.connections.some(c=>!verified.has(c.ref)||!/^https:\/\/www\.sefaria\.org\//.test(c.url||'')))
      fail('Missing or unverified paragraph connections: '+ois);
  }
  return pack;
}

export function addBeitYaakovVayeraGap(src){
  if(src.title!==BOOK)return src;
  const pack=readBeitYaakovVayeraGap();
  if(src.sections?.length!==281)fail('Expected the existing 281 chapters before the supplement');
  for(const section of pack.sections)if(src.sections.some(old=>old.key===section.key))fail('Duplicate '+section.key);
  src.sections.push(...structuredClone(pack.sections).map(({audit,...section})=>{
    section.items.forEach(item=>{item.keepPairs=true;});return section;
  }));
  return src;
}
