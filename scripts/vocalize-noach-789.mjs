// One-time Hebrew nikkud generation for Pri Tzaddik, Noach Ois 7–9.
// Uses Dicta Nakdan's rabbinic model. Preserves original consonants and punctuation.
// Output is an auditable static overlay; the website never calls Nakdan at read time.
import fs from 'node:fs';
const file='sources/akiva/editions/Peri_Tzadik_Bereshit_Cheshvan_Noach_Study_Edition.json';
const edition=JSON.parse(fs.readFileSync(file,'utf8'));
const strip=s=>s.replace(/[\u0591-\u05bd\u05bf-\u05c7]/g,'');
const letter=/[\u05d0-\u05ea]/;
const mark=/[\u0591-\u05bd\u05bf-\u05c7]/;
const originalLetters=s=>[...s].filter(c=>letter.test(c)).join('');
function applyNikkud(original,vocalized) {
  const canonical=[...original].filter(c=>letter.test(c));
  const target=[...vocalized], vocalLetters=[],markMap=[];
  for(const c of target) {
    if(letter.test(c)) {vocalLetters.push(c);markMap.push('');}
    else if(mark.test(c)&&markMap.length)markMap[markMap.length-1]+=c;
  }
  const m=canonical.length,n=vocalLetters.length;
  // Recover only vowel marks attached to matching Hebrew letters. Dicta may
  // normalize printed abbreviations: an LCS keeps the original text unchanged.
  const mapping=new Int32Array(m).fill(-1);
  if(canonical.join('')===vocalLetters.join('')) {
    for(let i=0;i<m;i++)mapping[i]=i;
  }else{
    const cols=n+1,table=new Uint16Array((m+1)*cols);
    for(let i=m-1;i>=0;i--)
      for(let j=n-1;j>=0;j--)
        table[i*cols+j]=canonical[i]===vocalLetters[j]
          ?1+table[(i+1)*cols+j+1]
          :Math.max(table[(i+1)*cols+j],table[i*cols+j+1]);
    let i=0,j=0;
    while(i<m&&j<n) {
      if(canonical[i]===vocalLetters[j]){mapping[i]=j;i++;j++;}
      else if(table[(i+1)*cols+j]>=table[i*cols+j+1])i++;
      else j++;
    }
  }
  const matched=[...mapping].filter(x=>x>=0).length;
  if(matched/m<0.94)throw Error('Unreliable Dicta letter alignment: '+matched+'/'+m);
  let out='',k=0;
  for(const c of original) {
    out+=c;
    if(letter.test(c)){if(mapping[k]>=0)out+=markMap[mapping[k]];k++;}
  }
  if(strip(out)!==original)throw Error('Nikkud changed the source wording');
  if(matched<m)console.warn('Preserved original text while aligning '+matched+'/'+m+' matching consonants');
  return out;
}
async function vocalize(original) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),60000);
  try {
    const res=await fetch('https://nakdan-2-0.loadbalancer.dicta.org.il/api',{
      method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({task:'nakdan',genre:'rabbinic',data:original,addmorph:false,keepqq:false}),
      signal:controller.signal
    });
    if(!res.ok)throw Error('Dicta API HTTP '+res.status);
    const words=await res.json();
    if(!Array.isArray(words))throw Error('Bad Dicta JSON');
    const text=words.map(w=>w.sep===true?w.word:(w.options?.[0]||w.word)).join('');
    return applyNikkud(original,text);
  } finally {clearTimeout(timeout);}
}
const target=edition.sections.filter(s=>s.node==='Noach'&&[7,8,9].includes(s.chapter));
if(target.length!==3)throw Error('Expected 3 Noach sections');
const result={book:'Peri Tzadik',method:'Dicta Nakdan rabbinic; original consonants/punctuation retained',sections:[]};
for(const section of target) {
  const phrases=section.topics.flatMap(t=>t.pairs.map(p=>p[0]));
  const chunks=[];
  let buffer=[],length=0;
  function flush(){if(buffer.length){chunks.push(buffer);buffer=[];length=0;}}
  for(let i=0;i<phrases.length;i++){
    const s=phrases[i];
    if(length+s.length>1500&&buffer.length)flush();
    buffer.push(i); length+=s.length+1;
  }
  flush();
  const pointed=new Array(phrases.length);
  for(let k=0;k<chunks.length;k++){
    const group=chunks[k],original=group.map(i=>phrases[i]).join('\n');
    try{
      const full=await vocalize(original),split=full.split('\n');
      if(split.length!==group.length)throw Error('Source boundary changed');
      for(let i=0;i<group.length;i++) {
        if(strip(split[i])!==phrases[group[i]])throw Error('Per-phrase preservation check failed');
        pointed[group[i]]=split[i];
      }
    }catch(err){
      console.warn('Batch fallback for '+section.chapter+' '+k+': '+err.message);
      for(const i of group)pointed[i]=await vocalize(phrases[i]);
    }
    console.log('Section '+section.chapter+': '+(k+1)+'/'+chunks.length+' chunks');
  }
  if(pointed.some(x=>!x))throw Error('Missing pointed phrase');
  const vowels=pointed.join('').match(/[\u0591-\u05bd\u05bf-\u05c7]/g)||[];
  const heb=originalLetters(pointed.join(''));
  if(vowels.length<heb.length*0.40)throw Error('Insufficient nikkud coverage for Ois '+section.chapter+' '+vowels.length+'/'+heb.length);
  result.sections.push({node:'Noach',chapter:section.chapter,phrases:pointed});
  console.log('CHECKPOINT Ois '+section.chapter+': '+pointed.length+' phrases; '+vowels.length+' vowels; '+heb.length+' letters.');
}
if(result.sections.reduce((n,s)=>n+s.phrases.length,0)!==149)throw Error('Expected 149 phrases');
const encoded=Buffer.from(JSON.stringify(result),'utf8').toString('base64');
const chunkLen=3200,count=Math.ceil(encoded.length/chunkLen);
console.log('VOCALIZED_BASE64_BEGIN');
for(let i=0;i<count;i++)console.log('VOCALIZED_BASE64_CHUNK '+(i+1)+'/'+count+' '+encoded.slice(i*chunkLen,(i+1)*chunkLen));
console.log('VOCALIZED_BASE64_END');
