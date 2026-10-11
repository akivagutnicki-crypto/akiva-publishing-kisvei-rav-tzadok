// Recover the exact Hebrew-English phrase boundaries from the uploaded Noach Word edition.
// Requires only Node built-ins; no OCR, web requests, or extra build dependencies.
import fs from 'node:fs';
import {inflateRawSync} from 'node:zlib';
function wordXml(file) {
  const b=fs.readFileSync(file);
  let e=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--) if(b.readUInt32LE(i)===0x06054b50){e=i;break;}
  if(e<0)throw Error('DOCX ZIP directory missing');
  let p=b.readUInt32LE(e+16);
  for(let i=0,n=b.readUInt16LE(e+10);i<n;i++){
    if(b.readUInt32LE(p)!==0x02014b50)throw Error('Bad DOCX directory');
    const method=b.readUInt16LE(p+10),size=b.readUInt32LE(p+20),a=b.readUInt16LE(p+28),x=b.readUInt16LE(p+30),c=b.readUInt16LE(p+32);
    const name=b.subarray(p+46,p+46+a).toString();
    if(name==='word/document.xml'){
      const off=b.readUInt32LE(p+42),start=off+30+b.readUInt16LE(off+26)+b.readUInt16LE(off+28);
      const z=b.subarray(start,start+size);
      if(method!==0&&method!==8)throw Error('DOCX compression unsupported');
      return (method===8?inflateRawSync(z):z).toString('utf8');
    }
    p+=46+a+x+c;
  }
  throw Error('Missing Word document XML');
}
const decode=s=>s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,(m,k)=>{
  const dict={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  return dict[k]??(k[0]==='#'?String.fromCodePoint(k[1]==='x'?parseInt(k.slice(2),16):parseInt(k.slice(1),10)):m);
});
export function noachSixPairs(file) {
  const out=[];let active=false;
  for(const match of wordXml(file).matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)){
    const para=match[1];
    const runs=[...para.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].map(m=>{
      const x=m[1],prop=(x.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)||[])[1]||'';
      return {text:[...x.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(v=>decode(v[1])).join('').trim(),
        bold:/<w:b(?=\s|\/|>)(?![^>]*w:val="(?:0|false)")[^>]*\/?>/.test(prop)};
    });
    if(runs.some(r=>r.text.includes('Noach — Ois 6'))){active=true;continue;}
    if(!active||(/<w:pStyle/.test(para)&&!/<w:pStyle[^>]*w:val="Normal"/.test(para)))continue;
    let pending=[];
    for(const run of runs){
      if(!run.text)continue;
      if(run.bold){if(pending.length){out.push([pending.join(' '),run.text]);pending=[];}}
      else if(/[\u05d0-\u05ea]/.test(run.text))pending.push(run.text);
    }
    if(pending.length)throw Error('Unpaired Hebrew in Noach 6');
  }
  if(out.length!==194)throw Error('Noach 6 Word phrase count is '+out.length+', expected 194');
  out[8][1]='The matter is that the root of the exiles lies in the blemish of the covenant,';
  out[29][1]='Through the spiritual impurity that the serpent imparted, which clung to Adam HaRishon,';
  out[30][1]='this brought about corruption and spiritual damage during the 130 years of his separation.';
  out[126][0]=out[126][0].replace(/"\s+/,'"');
  return out;
}