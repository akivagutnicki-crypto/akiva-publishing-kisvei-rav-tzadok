// Resolve this edition's printed Zohar/Tikkun and named-Midrash references
// against Sefaria's actual schema. Volume:folio aliases are not valid Zohar
// API references; the checked-in map comes from Sefaria's Daf alternate tree.
import fs from 'node:fs';
import { linkCitations, normalizeRef } from './citations.mjs';
const map = JSON.parse(fs.readFileSync(new URL('../sources/akiva/references/Likkutei_Maamarim.json', import.meta.url), 'utf8'));
const cleanName = s => s.toLowerCase().replace(/[^a-z]/g, '');
const names = Object.entries(map.parashot).map(([name, vol]) => [cleanName(name), vol]);
names.push(['behaalotecha', 3], ['achareimot', 3], ['vayeira', 1], ['vayera', 1], ['vaera', 2], ['lek hlekha'.replace(/ /g,''), 1], ['exodus', 2]);
const parashot = {
  'Ki Tisa': ['Ki Tisa', 'Ki Tissa'], 'Ki Teitzei': ['Ki Teitzei', 'Ki Teitze', 'Ki Teitzei', 'Ki Tetzei'],
  Tazria: ['Tazria'], Pinchas: ['Pinchas'], Chukat: ['Chukat'], Beshalach: ['Beshalach'],
};
// The edition's printed numbering is retained in the label. These targets
// were checked against the quoted Hebrew in Sefaria's actual editions.
const equivalentPassages = {
  'Midrash Tehillim 107:23': 'Midrash Tehillim 107:4',
  'Midrash Tehillim 107:5': 'Midrash Tehillim 107:4',
  'Sefer Yetzirah 4:16': 'Sefer Yetzirah Gra Version 4:16',
  'Sefer Yetzirah 5:10': 'Sefer Yetzirah Gra Version 5:9',
  'Sefer Yetzirah 5:12': 'Sefer Yetzirah Gra Version 5:10',
  'Sefer Yetzirah 5:2': 'Sefer Yetzirah Gra Version 5:2',
  'Sefer Yetzirah 6:3': 'Sefer Yetzirah Gra Version 6:3',
};
const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anchor = (text, ref) => `<a data-ref="${ref.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${text}</a>`;

function extra(text) {
  // Keep generated links out of later matching passes. Otherwise a later
  // Tikkun pattern could match inside an earlier link's data-ref attribute.
  const anchors = [];
  const a = (label, ref) => { anchors.push(anchor(label, ref)); return `\uE100${anchors.length-1}\uE101`; };
  // Explicit volume, or a named parasha that fixes the volume. Never guess a
  // volume from the page number alone; never point an unknown page to page 1.
  text = text.replace(/(?<!Tikkunei )\bZohar\b(?!\s+(?:Chadash|HaRaki))([^.!?;:]{0,100}?)(\d{1,3}[ab])((?:\s*[,;]\s*\d{1,3}[ab])*)/g,
    (whole, context, first, rest) => {
      const roman = /\b(III|II|I)\b/.exec(context);
      const name = cleanName(context);
      const candidates = names.filter(([n]) => name.includes(n)).sort((x,y) => y[0].length-x[0].length);
      const vol = roman ? {I:1, II:2, III:3}[roman[1]] : candidates[0]?.[1];
      if (!vol) return whole;
      const prefix = whole.slice(0, whole.length-rest.length);
      const ref = map.zohar[vol]?.[first];
      return (ref ? a(prefix, ref) : prefix) + rest.replace(/\d+[ab]/g, daf => map.zohar[vol]?.[daf] ? a(daf, map.zohar[vol][daf]) : daf);
    });
  text = text.replace(/\b(?:Tikkunei Zohar(?:,?\s*Tikkun)?|Tikkunim,?\s*Tikkun|Tikkun)\s+(\d+)(?:,?\s+(\d+[ab]))?/g,
    (whole, n, daf) => {
      const ref = daf ? `Tikkunei Zohar ${daf}` : map.tikkunim[n];
      return ref ? a(whole, ref) : whole;
    });
  text = text.replace(/\b(?:Tikkunei Zohar,?\s*(?:Introduction\s*)?|Introduction to the Tikkunim\s*\(?)(\d+[ab])/g,
    (whole, daf) => a(whole, `Tikkunei Zohar ${daf}`));
  for (const [canonical, aliases] of Object.entries(parashot)) {
    const par = aliases.map(escapeRE).join('|');
    const re = new RegExp(`\\b(?:Midrash )?Tanchuma\\s*(?:[,(]\\s*)?(?:end of\\s+)?(?:${par})(?:\\s*,?\\s*(?:sec\\.\\s*)?)(\\d+)`, 'g');
    text = text.replace(re, (whole, n) => a(whole, `Midrash Tanchuma, ${canonical} ${n}`));
  }
  text = text.replace(/\bTanna DeBei Eliyahu Rabbah\s*(?:,?\s*\(?\s*(?:chapter|ch\.)?\s*)(\d+)/gi,
    (whole, n) => a(whole, `Tanna DeBei Eliyahu Rabbah ${n}`));
  text = text.replace(/\bSifrei\s*,?\s*(Pinchas|Matot|Va['’]?etchanan|Vezot HaBerachah|Eikev)\s*,?\s*(?:sec\.\s*)?(\d+)/g,
    (whole, parasha, n) => a(whole, `Sifrei ${/Pinchas|Matot/.test(parasha) ? 'Bamidbar' : 'Devarim'} ${n}`));
  text = text.replace(/\bYalkut Shimoni\s*,?\s*(?:Beshalach|Berakhah)\s*,?\s*(?:Remez\s*)?(\d+)/g,
    (whole, n) => a(whole, `Yalkut Shimoni on Torah ${n}`));
  text = text.replace(/\bYalkut Shimoni 2\b/g, whole => a(whole, 'Yalkut Shimoni on Torah 2'));
  text = text.replace(/\bYalkut Shimoni,? Pinchas (\d+)/g, (whole,n) => a(whole, `Yalkut Shimoni on Torah ${n}`));
  text = text.replace(/\bEtz Chaim(?:,? Sha'ar Mayin Nukvin)?\s*\(Gate (\d+), ch\. (\d+)\)/g,
    (whole, gate, chapter) => a(whole, `Sefer Etz Chaim ${gate}:${chapter}`));
  text = text.replace(/\bEtz Chaim at the beginning of Sha'ar ACHAP \(Gate 4, drush 1\)/g,
    whole => a(whole, 'Sefer Etz Chaim 4:1'));
  text = text.replace(/\b(?:Pri|Peri) Etz Chayim Sha'ar Yemei HaPurim ch\. 1/g,
    whole => a(whole, 'Pri Etz Chaim, Gate of The New Month, Chanukah, and Purim 5'));
  text = text.replace(/\b(?:Pri|Peri) Etz Chayim at the beginning of Sha'ar HaShabbat/g,
    whole => a(whole, 'Pri Etz Chaim, Gate of the Sabbath 1'));
  text = text.replace(/\bRa['’]avad (?:on |wrote on )Sefer Yetzirah\s*\[3:1\]/g,
    whole => a(whole, "Ra'avad on Sefer Yetzirah 3:1"));
  // Preserve commentary attribution, rather than linking a comment as Gemara.
  text = text.replace(/\bTosafot on Yevamot 35b/g, whole => a(whole, 'Tosafot on Yevamot 35b'));
  text = text.replace(/\bBava Batra 12a(?=\.)/g, whole => a(whole, 'Bava Batra 12a'));
  return text.replace(/\uE100(\d+)\uE101/g, (_, index) => anchors[+index]);
}

export function linkLikkuteiCitations(html) {
  let inLink = 0;
  const linked = html.split(/(<[^>]+>)/).map(part => {
    if (part.startsWith('<')) {
      if (/^<a\b/i.test(part)) inLink++;
      else if (/^<\/a>/i.test(part)) inLink = Math.max(0, inLink-1);
      return part;
    }
    return inLink ? part : extra(part);
  }).join('');
  return linkCitations(linked).replace(/data-ref="([^"]+)"/g, (_, ref) => `data-ref="${equivalentPassages[normalizeRef(ref)] || normalizeRef(ref)}"`);
}
