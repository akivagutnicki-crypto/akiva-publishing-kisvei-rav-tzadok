// Preserve canonical Hebrew word order while restoring the nikkud carried
// by the original vocalized study edition. The study edition's PDF extraction
// places combining marks *before* consonants and injects whitespace between
// individual letters. Displaying that OCR text verbatim is not acceptable.
//
// Align its Hebrew consonants to the canonical unvocalized book using unique
// multi-letter anchors plus an exact LCS between those anchors. Only transfer
// marks when the actual consonants agree. Do not shift vowels to unrelated
// letters or alter the canonical words or punctuation.

const LETTER = /[\u05D0-\u05EA]/u;
const POINT = /[\u0591-\u05BD\u05BF-\u05C7]/u;

function glyphs(text, ocr = false) {
  const result = [], s = String(text || '');
  let pending = '';
  for (let index = 0; index < s.length; ++index) {
    const c = s[index];
    if (POINT.test(c)) { pending += c; continue; }
    if (LETTER.test(c)) {
      result.push({ c, index, marks: ocr ? pending : '' });
      pending = '';
    }
  }
  return result;
}

function alignGap(source, target, a, b, x, y, mapping) {
  const n = b - a, m = y - x;
  if (!n || !m) return;
  // LCS, not substitution: an OCR vowel may only be assigned to the
  // same consonant. This bounded DP handles insertions and omissions.
  if (n * m > 150000) {
    let i = a, j = x;
    while (i < b && j < y) {
      if (source[i].c === target[j].c) {
        mapping[j] = source[i].marks; ++i; ++j;
      } else {
        let nextSource = -1, nextTarget = -1;
        for (let k = i + 1; k < Math.min(b, i + 14); ++k) if (source[k].c === target[j].c) { nextSource = k; break; }
        for (let k = j + 1; k < Math.min(y, j + 14); ++k) if (target[k].c === source[i].c) { nextTarget = k; break; }
        if (nextSource >= 0 && (nextTarget < 0 || nextSource - i <= nextTarget - j)) i = nextSource;
        else if (nextTarget >= 0) j = nextTarget;
        else { ++i; ++j; }
      }
    }
    return;
  }
  const rows = Array.from({length:n+1}, () => new Uint16Array(m+1));
  for (let i = n - 1; i >= 0; --i)
    for (let j = m - 1; j >= 0; --j)
      rows[i][j] = source[a+i].c === target[x+j].c
        ? rows[i+1][j+1] + 1
        : Math.max(rows[i+1][j], rows[i][j+1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (source[a+i].c === target[x+j].c) {
      mapping[x+j] = source[a+i].marks; ++i; ++j;
    } else if (rows[i+1][j] >= rows[i][j+1]) ++i;
    else ++j;
  }
}

export function restoreStudyNikkud(canonicalText, phrasePairs) {
  const canonical = String(canonicalText || '');
  const original = Array.isArray(phrasePairs)
    ? phrasePairs.map(p => String(p[0] || '')).join(' ')
    : String(phrasePairs || '');
  const target = glyphs(canonical);
  const source = glyphs(original, true);
  if (!target.length || !source.length) return {text:canonical, vocalized:0, targetLetters:target.length, sourceMarks:0, matched:0};
  const src = source.map(g => g.c).join('');
  const dst = target.map(g => g.c).join('');
  // Anchor repeated letters by unique 9-consonant passages (no PDF spaces).
  // Increasing-subsequence selection discards Hebrew lines re-ordered by
  // PDF right-to-left extraction, without corrupting surrounding text.
  const WIDTH = 9, proposals = [];
  for (let i = 0; i + WIDTH <= src.length; i += 3) {
    const token = src.slice(i, i + WIDTH);
    const k = dst.indexOf(token);
    if (k >= 0 && dst.indexOf(token, k + 1) < 0) proposals.push({i,k});
  }
  const tails = [], previous = new Int32Array(proposals.length).fill(-1);
  for (let p=0; p<proposals.length; ++p) {
    let lo=0, hi=tails.length;
    while(lo<hi) {
      const mid=(lo+hi)>>1;
      if (proposals[tails[mid]].k < proposals[p].k) lo=mid+1;
      else hi=mid;
    }
    if (lo) previous[p]=tails[lo-1];
    if (lo===tails.length) tails.push(p);
    else tails[lo]=p;
  }
  const chain=[];
  for (let p=tails.length?tails[tails.length-1]:-1; p>=0; p=previous[p]) chain.push(proposals[p]);
  chain.reverse();
  const anchors=[], mapping=new Array(target.length);
  for(const p of chain) {
    const prior=anchors[anchors.length-1];
    if(prior && (p.i<prior.i+WIDTH || p.k<prior.k+WIDTH)) continue;
    anchors.push(p);
  }
  let lastS=0, lastT=0;
  for(const a of anchors) {
    alignGap(source,target,lastS,a.i,lastT,a.k,mapping);
    for(let j=0;j<WIDTH;j++) {
      if(source[a.i+j].c===target[a.k+j].c)
        mapping[a.k+j]=source[a.i+j].marks;
    }
    lastS=a.i+WIDTH; lastT=a.k+WIDTH;
  }
  alignGap(source,target,lastS,source.length,lastT,target.length,mapping);
  // A PDF sometimes puts the second half of a right-to-left line before its
  // first half. LIS correctly avoids shifting the running alignment, but
  // those reversed *unique* passages can still be recovered independently:
  // an exact nine-consonant match cannot be an unrelated source passage.
  for (const a of proposals) {
    for (let d = 0; d < WIDTH; ++d) {
      const si=a.i+d, tj=a.k+d;
      if (mapping[tj] === undefined && source[si].c === target[tj].c)
        mapping[tj] = source[si].marks;
    }
    // Extend each proven exact anchor outward until consonants disagree.
    for (const dir of [-1, 1]) {
      let si=dir<0 ? a.i-1 : a.i+WIDTH;
      let tj=dir<0 ? a.k-1 : a.k+WIDTH;
      for (let distance=0; distance<120
         && si>=0 && si<source.length && tj>=0 && tj<target.length
         && source[si].c===target[tj].c; ++distance, si+=dir, tj+=dir)
        if (mapping[tj] === undefined) mapping[tj]=source[si].marks;
    }
  }
  let result='', glyphIndex=0, vocalized=0, matched=0, sourceMarks=0;
  for(const g of source) if(g.marks) sourceMarks++;
  for(let i=0;i<canonical.length;++i) {
    const c=canonical[i];
    result+=c;
    if(LETTER.test(c)) {
      const marks=mapping[glyphIndex++];
      if(marks!==undefined) matched++;
      // Canonical Sefaria edition may already be vocalized: do not replace it.
      if(marks && !POINT.test(canonical[i+1] || '')) {
        result+=marks; vocalized++;
      } else if (POINT.test(canonical[i+1] || '')) vocalized++;
    }
  }
  return {text:result.normalize('NFC'),vocalized,targetLetters:target.length,sourceMarks,matched};
}
