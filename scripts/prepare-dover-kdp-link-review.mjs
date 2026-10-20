// Correct citation URL syntax without altering any manuscript wording.
import fs from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {findCitations,normalizeRef} from './citations.mjs';
import {referenceMatches,map} from './reference-finders.mjs';
const file='sources/verified/dover/kdp-sefaria-links-20261020.json.gz';
const cache=JSON.parse(gunzipSync(fs.readFileSync(file)));
const fixes={
 'Eliyahu Rabbah 8':'Tanna DeBei Eliyahu Rabbah 8',
 'Middos 2:5':'Mishnah Middot 2:5',
 'Pirkei Avot DeRabbi Nassan 29':'Avot DeRabbi Natan 29',
 'Maimonides, Mishneh Torah, Laws of Mikvaot 11:12':'Mishneh Torah, Immersion Pools 11:12',
 'Targum Yonassan to Bereishis 50:13':'Targum Jonathan on Genesis 50:13',
 'Rema on Shulchan Aruch, Orach Chaim 656:1':'Shulchan Arukh, Orach Chayim 656:1',
 'Pri Tzaddik, Vol. 2, Parashat Parah, discourse 5, letter 7':'Peri Tzadik, Parah 5:7',
 'Rabbeinu Yonah on Berachos, Rif 6a, first comment':'Rabbeinu Yonah on Berakhot 6a:1',
 'Tosafot Yom Tov, Opening to the Mishnah, “Six orders of Mishnah”':'Tosafot Yom Tov Introduction to the Mishnah',
};
function candidates(ref){
 if(fixes[ref])return[fixes[ref]];
 const yer=/^(?:Jerusalem Talmud,?|Yerushalmi,?)\s+(.+?)\s+(\d+:\d+)$/.exec(ref);
 if(yer)return['Jerusalem Talmud '+({'Berachos':'Berakhot','Kesubos':'Ketubot','Makkos':'Makkot'}[yer[1]]||yer[1])+' '+yer[2]];
 if(ref.startsWith('Tikkunei Zohar')){const m=/(\d+[ab])\b/.exec(ref);if(m)return['Tikkunei Zohar '+m[1]];}
 let z=ref.replace(/^Introduction to the Zohar /,'Zohar I, ').replace(/^(Zohar\s+(?:III|II|I))\s+(\d)/,'$1, $2').replace(/^Zohar, (?:Raaya Mehemna|Sitrei Torah), /,'Zohar, ');
 if(/^Zohar/.test(z)){const hits=referenceMatches(z);if(hits.length)return hits.map(x=>x.ref);}
 const commentator=/^(Rashi|Tosafos|Tosafot)(?: on|,)?\s+([^,]+?\s+\d+[ab])(?:[, ].*)?$/.exec(ref);
 if(commentator)return[(commentator[1]==='Tosafos'?'Tosafot':commentator[1])+' on '+commentator[2].replace(/Berachos/,'Berakhot').replace(/Shabbos/,'Shabbat').replace(/Yevamos/,'Yevamot')];
 const direct=[...referenceMatches(ref),...findCitations(ref)].map(x=>normalizeRef(x.ref));
 // Extra words such as “Mishnah” or “Sulam translation” belong in the
 // displayed source label, never in Sefaria's reference address.
 if(direct.length)return[...new Set(direct)];
 return[];
}
async function resolve(ref){
 if(cache.references[ref]?.isRef)return cache.references[ref];
 try{const r=await fetch('https://www.sefaria.org/api/name/'+encodeURIComponent(ref),{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();return cache.references[ref]={isRef:!!d.is_ref,...(d.ref?{ref:d.ref}:{}),...(d.url?{url:d.url}:{})};}
 catch(e){return cache.references[ref]={isRef:false,error:e.message,transportError:true};}
}
const review={provider:'Sefaria name API and checked-in folio reference map',corrections:{},unlinked:[]};
const pending=Object.entries(cache.references).filter(([,v])=>!v.isRef);let next=0;
async function worker(){while(next<pending.length){const [before,evidence]=pending[next++];if(evidence.transportError){const r=await resolve(before);if(r.isRef)continue;}
 const proposed=candidates(before),resolved=[];
 for(const c of proposed){if(c===before)continue;const d=await resolve(c);if(d.isRef)resolved.push({ref:d.ref||c,url:'https://www.sefaria.org/'+d.url});}
 review.corrections[before]=resolved;
 if(!resolved.length)review.unlinked.push({ref:before,reason:'No exact supported Sefaria target was established; preserve the complete citation and quotation as text.'});
 }}
await Promise.all(Array.from({length:6},worker));
// This source is available on Sefaria but is outside the bundled Mei study
// chapters. Use its verified external source rather than a missing local leaf.
const mei='Mei HaShiloach, Volume I, Genesis, Vayigash 1',m=await resolve(mei);
if(m.isRef)review.corrections[mei]=[{ref:m.ref||mei,url:'https://www.sefaria.org/'+m.url}];
for(const ref of ['Beit Yaakov on Torah, Vayigash 2:5','Beit Yaakov on Torah, Vayishlach 5:6','Beit Yaakov on Torah, Vayigash 9:3','Beit Yaakov on Torah, Vayigash 12:1']){
 const d=await resolve(ref);
 review.corrections[ref]=d.isRef?[{ref:d.ref||ref,url:'https://www.sefaria.org/'+d.url}]:[];
 if(!d.isRef)review.unlinked.push({ref,reason:'The cited passage is not present in the bundled edition and no exact Sefaria target was resolved. The complete quotation is retained.'});
}
fs.writeFileSync(file,gzipSync(JSON.stringify(cache),{mtime:0}));
fs.writeFileSync('sources/verified/dover/kdp-link-target-review-20261020.json',JSON.stringify(review,null,2)+'\n');
console.log(JSON.stringify({reviewed:pending.length,corrected:Object.values(review.corrections).filter(x=>x.length).length,unlinked:review.unlinked}));
