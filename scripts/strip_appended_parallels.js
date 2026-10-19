#!/usr/bin/env node
/**
 * Akiva Publishing: corrected appended-parallel cleanup.
 * Standalone Node.js 18+ CLI; works in CommonJS and ES-module projects.
 * No npm packages, network requests, publishing, or source-archive extraction.
 * Current Dover Tzedek and the other protected editions are pinned below.
 */
(async function () {
const fs = (await import('node:fs')).default;
const path = (await import('node:path')).default;
const crypto = (await import('node:crypto')).default;
const assert = (await import('node:assert/strict')).default;

/**
 * Remove the specifically named appended footnote blocks, with an explicit
 * owner whitelist. This program is deliberately not a recursive text replacer.
 *
 * Preview: node strip_appended_parallels.js --root dist/library
 * Apply:   node strip_appended_parallels.js --root dist/library \
 *            --write --report dist/library/parallel-cleanup-report.json
 *
 * Unchanged files are never serialized or written. A complete, validated plan
 * is prepared before --write changes anything. No source attachments, citations
 * cache, generic parallels index, provenance, or reader functionality is edited.
 */

const TARGET_BOOKS = [
  ['Sefer_HaZikhronot', 'sefer-hazikhronot'],
  ['Tzidkat_HaTzadik', 'tzidkat-hatzadik'],
  ['Peri_Tzadik', 'peri-tzadik'],
  ['Machshavot_Charutz', 'machshavot-charutz'],
  ['Divrei_Soferim', 'divrei-soferim'],
  ['Yisrael_Kedoshim', 'yisrael-kedoshim'],
  ['Likkutei_Maamarim', 'likkutei-maamarim'],
  ['Sichat_Malakhei_HaSharet', 'sichat-malakhei-hasharet'],
  ['Sichat_Shedim', 'sichat-shedim'],
  ['Divrei_Chalomot', 'divrei-chalomot'],
  ['Et_HaOchel', 'et-haochel'],
  ['Ohr_Zarua_LaTzadik', 'ohr-zarua-latzadik'],
  ['Kometz_HaMinchah', 'kometz-haminchah'],
  ['Meshiv_HaTa_anah', 'meshiv-hata-anah'],
  ['Meshiv_Tzedek', 'meshiv-tzedek'],
  ['Poked_Akarim', 'poked-akarim'],
].map(([id, slug]) => Object.freeze({ id, slug }));
const PROTECTED_BOOKS = [
  { id: 'Takanat_HaShavin', slug: 'takanat-hashavin' },
  { id: 'Dover_Tzedek', slug: 'dover-tzedek' },
  { id: 'Resisei_Layla', slug: 'resisei-layla' },
];
const PROTECTED_PERI_FILES = new Set(['6.json', '106.json', '111.json', '112.json']);

// These hashes identify the protected edition verified on the public reader.
// No bypass is provided: a different protected edition must be reviewed first.
const CURRENT_PROTECTED_EDITION = {
  "capturedOn": "2026-10-18",
  "snapshotVersion": "7fce1438a4b6663a",
  "sourceZipSha256": "155ace41cbc1dd4c96f52abb44be5776f07d65b6c3b9ba4e0ede0bc705b83d7c",
  "source": "https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/downloads/rav-tzadok-library.zip",
  "files": {
    "data/dover-tzedek/0.json": "e52ecd0ee32c5cea57baaa286f18f1dc2566bf911968f7d3caf6466e01cf9d58",
    "data/dover-tzedek/1-1.json": "d833dfe0601bb6ad0d2396dfb8900b3b8eda3a6ef2b2733fcd8917ace2a730a9",
    "data/dover-tzedek/1-2.json": "e7ee80b686f5f23eacc91e76f793c13f2d080243904b626b5aede9cb7c06c6a7",
    "data/dover-tzedek/1-3.json": "8a5aae8c2d1ee41431f4f4d0e314350dd4ecd9f29f77e08c863ddb5ed0ddf42e",
    "data/dover-tzedek/1-4.json": "4bb2976856a3f6adc9395b0fbf5e2380b793fd837c9b2db4f115fcfad02d4514",
    "data/dover-tzedek/2-1.json": "a5e9fa1a49a33858bbb0229a1a538c3fb4bb070a5381e17ecbd5963d2bf3a885",
    "data/dover-tzedek/2-2.json": "1ce2695548784e801586367b736a8c2f12f2e915706866601a1308d7694b4a25",
    "data/dover-tzedek/2-3.json": "e312bc8e4c139a52db36754b977e4620157a49eb8352911c73b85594fc9ce444",
    "data/dover-tzedek/3-1.json": "a60fcc958aae9c1343e3478e777949474577824f0e4d19c949bb1e3b3eee5f99",
    "data/dover-tzedek/3-2.json": "09aa7fda417ad00bbf2047f8de839d1937421165f4b656b0a1d98c794bce3e16",
    "data/dover-tzedek/4-1.json": "b7977ab64ad2728482cbe6238440a533fae02e2f05136357a7d5834bd92ff1c7",
    "data/dover-tzedek/4-2.json": "9f0056a5b562c30c675c5161cd62ccf46742afea565133afe986e5b830967e20",
    "data/dover-tzedek/5-1.json": "b5e344c9ebeef66546f71d377432de55ac4c28db29dd397059a1c32855a3b9c1",
    "data/dover-tzedek/5-2.json": "2c3836b9430c67c0c5f5b1579e2217292d56577d3267fe9386037f0571f5024c",
    "data/dover-tzedek/5-3.json": "8b109b97e950dadf816631c3f71638d63c96ac9391a3ecc6fcc71a287f9a28b4",
    "data/dover-tzedek/5-4.json": "b074cadcca0e2676e867ebfa1fb3e786df125e11a8bd9db820839526283ee02b",
    "data/dover-tzedek/links.json": "76f130457d3f7f68fdd1f4b1ddb50c6798885d05131d7617b2dd010315774dcf",
    "data/dover-tzedek/toc.json": "be2fa82bd6b9340d722d45ec5fb41488a5b6f890f5e0ba88d5418f651c43bcde",
    "data/peri-tzadik/106.json": "9f3eb0226ffc9520cbddc049bdb94c571dad8005972bd7f40904eb701917528c",
    "data/peri-tzadik/111.json": "8cbbefddf8d061399863639fa9e5bcd53fa43eb8ba4c7bc4a1a20c9bef4f7e7c",
    "data/peri-tzadik/112.json": "07360f615c203980cf904a19c3496d732efeae0849bee2f29a50218c036c4bee",
    "data/peri-tzadik/6.json": "9e8825d7bdaec352903ceb3968a4425b56092767374ff50cf79deda8d1936d8d",
    "data/peri-tzadik/7-5.json": "9164cd785ae153920f4959b63dc85dc022eaef2c3842e794767a594898a5c54c",
    "data/peri-tzadik/7-6.json": "5039eff559a975a70d7176a51a2c14796a8f937a5b39114e2ab572117cb3b7e1",
    "data/resisei-layla/0.json": "86301e112111eb4ea235af98b9883be7ab04f11032c51a31859ae278bff834c9",
    "data/resisei-layla/1.json": "aa48cb127b645e98d4807784838313cafcbb82a857b5d22b46c47adf5c4018a7",
    "data/resisei-layla/10.json": "6da7e885f7657d59970b8afc1819a0a705be71c4db471acefcc64a5aa9ca26a6",
    "data/resisei-layla/11.json": "a573399398d672f5a361422af8dd3e57093b4b01680975e6effc2397d56d267e",
    "data/resisei-layla/12.json": "17dce167f83856d7e3c9d146faadc5a55a3a6f76f2097ad79d381dc1b32a01a6",
    "data/resisei-layla/13.json": "7b11b75845d029243e6fa0479b6accfecd2ae8db6b805e23461519ec2ba221b8",
    "data/resisei-layla/14.json": "eb464b6077853e64bd835d4afe53b0fc18c4170556072f31a8ba39f7a81f2210",
    "data/resisei-layla/15.json": "f0f60e91e978b75e5892dc3853b7962d97e675be44175b3f9685aad6e45ec9af",
    "data/resisei-layla/16.json": "0eeb95dbb053cfe9fe9b9f2576438102c73f377d26d6617233034925fa683997",
    "data/resisei-layla/17.json": "f28417120d171938bfd997338bb1a390e729bd30af66fe26c14142c646c94395",
    "data/resisei-layla/18.json": "2a3cd44198e0517b484f12830c1c3c72c254b369cfecc309aa7f67c3d0018769",
    "data/resisei-layla/19.json": "092126ee60cfff8ade49d683fa4627380dd0b0fad5d0f9ca9f35758d100bec8a",
    "data/resisei-layla/2.json": "5918236fa014cf826941b0c75b5b0fa88d9d2635379a146485a4420be0f02c9f",
    "data/resisei-layla/20.json": "50bab71484657d7bcc9d97ed833c10af20ec03d1576e3372d47f504a99effcec",
    "data/resisei-layla/21.json": "10cf810955e2d819d080e06f03aeb9ab9b0135d34d5ba17d9f738369c09d754f",
    "data/resisei-layla/22.json": "0c7ede5a2bf7dc56d14b38c3126b98cad7f442c57586bbe3b9d3c59f72832bb6",
    "data/resisei-layla/23.json": "8ac04deb8b8f20f72c955eeac56d61212001e2810603d329a0137455c29c94c4",
    "data/resisei-layla/24.json": "81bd1a9cfffed7e4aafe9e89a5faa9ff52696a200d5b43c1ade8db0e6a2b2568",
    "data/resisei-layla/25.json": "9bc0d8ada2ccca69089093d9f3174da96ef7c0c14f6f0f2b49e646019b3c7175",
    "data/resisei-layla/26.json": "917fb31b79929ffc448e826cee2e66e11fb3433fcdcbb4c76876214093489616",
    "data/resisei-layla/27.json": "5ede02351a590beea8bd05c6bd2ba126b4d60af504c37925ac82f4bef81d58c9",
    "data/resisei-layla/28.json": "b46090cbc1c2c1307ef2ab2bc2d3a63bd36aee5a9fac591ef4100e662cbd6b82",
    "data/resisei-layla/29.json": "a27d687981473567b6996d9fbfb67d5e8631ed446e382a36231ce0c2293d53ea",
    "data/resisei-layla/3.json": "7ca1ecfd85427a864b7b422c2302d6a02520c2c54ce2fd576221e183fb7d839c",
    "data/resisei-layla/30.json": "017d9d4e27ca1812bffe20ee60c3aa239be1fdf66fb9aaa7d3aa4f339eb0f72f",
    "data/resisei-layla/31.json": "f0d2a855f481c8bcd1433d0222bdb88673212391d72d1b153c723e6202aeaaae",
    "data/resisei-layla/32.json": "c3cf556dccd1b3c9a88edfb386dd84c522914793127bca3a4d878b20e339eb3c",
    "data/resisei-layla/33.json": "72cafb1d180cbcaedef35fc95eaa9b8305fc6f65c14b0c92c72be0924e778c7d",
    "data/resisei-layla/34.json": "086a01b2ab776165030de16df4ca4392b31580679fb9d1255c2b12bf18fdd0ca",
    "data/resisei-layla/35.json": "9a6c647aebb6bcf859a9217ca1c90e5a87d691d361191484dafde272c50787ed",
    "data/resisei-layla/36.json": "e437f3dde7fec134d15606679c4f9f33c8649d0752f5dbaeeda6f3afd32a0c0f",
    "data/resisei-layla/37.json": "17ea5088e4ad8e8808038f23af83b3323c9a1b00456e0d7abf57a3c071fa2cf1",
    "data/resisei-layla/38.json": "d79bdf9193754232190edbabfd374cf2f4f4a41f7c470a3d2e089ac23b7501a0",
    "data/resisei-layla/39.json": "4429e40740ae4be41ab996bf1fd3d92975010cb178b9564ec5b61fc09d44dc10",
    "data/resisei-layla/4.json": "0247f42623fc6b910444b38d14a7e10c70ac2068361cba68c5cf88041a3f0e22",
    "data/resisei-layla/40.json": "16b6967b4a4cd0580dd10e9740a780e66a0af8986fe66dbcc89d9067b476bf2f",
    "data/resisei-layla/41.json": "9ccb4e7ae11857ad4348b06c146c80ac7280108f06e4c9c8ebff0d38c9873fd2",
    "data/resisei-layla/42.json": "5a4826c19baf0d9c44b68b7f3c8e4262f18ae6702a091545cf038f151f3ae254",
    "data/resisei-layla/43.json": "60b1d178db2d0bcacfb98f586d6a116f1172267bc92fc4086ae8cc6713586fbc",
    "data/resisei-layla/44.json": "ca62646bc73d653911cff3a3e76376c4cc00d5521eb2a12c69a866cb240c1b68",
    "data/resisei-layla/45.json": "38c9baffc572e7a2c0df3848fab31991d9e32ac16f559999911dd61f8b156f1d",
    "data/resisei-layla/46.json": "d4ec7f3e134b1bf0db5473d385b7e60e394941d3909e62b7acf12952aaf59ba6",
    "data/resisei-layla/47.json": "d866c6a9afe14221d1b60993ef102a979259820c0c59c998cdb05a3098b92dda",
    "data/resisei-layla/48.json": "b2d8787e90c4bc97c658fd3df5154b0f554eeab4adb87b8e730b477ce5ebc9d7",
    "data/resisei-layla/49.json": "a00d1365c7b8571f69dea9e6f778071db362acfd4daea8398349675c42f19de0",
    "data/resisei-layla/5.json": "6ebe5a0511244f19fca188ba05dd34df94a39a8cb5502e67723e5e3fe49202b8",
    "data/resisei-layla/50.json": "a05cea856073da2a557fef1170bf49d3e8f0206f7306ecbb8ee65a1d0c58e423",
    "data/resisei-layla/51.json": "a8953e873b0942fcc6275cae0c0cf3499c6744a084691396976f14d9f5e38a69",
    "data/resisei-layla/52.json": "39584d114783f3d2b40e45f28ba8ab5b78c81b728625213bbbcd75bde105dbb1",
    "data/resisei-layla/53.json": "f25c26483b8716b8ea4705467a40cc9913b9dfc6200b9c898943d446ed2cea9a",
    "data/resisei-layla/54.json": "370c90586c5fdaabdb7e1592bc8aab3971eb6c379be9ea7b3224cd64a9d26d5a",
    "data/resisei-layla/55.json": "bf89aab7446346e4aec991aeff16259223b46c919eeb3ce4a5fedf537d3ad5dd",
    "data/resisei-layla/56.json": "62a2d297b47b791ece87625c62734879957cd622da14e186cbd61ee402198016",
    "data/resisei-layla/57.json": "2cc3d23e60d7f9e3af25f6780b6e3240a5f92a0fd835979816f2800145a8eacd",
    "data/resisei-layla/6.json": "6d090ad603f92d703e5b67d316e7d0b2bca5e2621ab7c954cea8c71131f84eb1",
    "data/resisei-layla/7.json": "383466a5c4e92b6d183a2624bee7174018de669abcce0d27d7709b6b4698a07c",
    "data/resisei-layla/8.json": "8e5a247463c774fac6920455ba5eabf72625833ee1d1eb675a6a6aeae6b495c8",
    "data/resisei-layla/9.json": "6a2ecc116dd7a3d14633c7c1985bd729c5889bc56b7799b30e89a2dd006fa1fd",
    "data/resisei-layla/links.json": "06711197a9216164cc609c16c6ca11642f5c1edf5c28fe79f754f576baf2b283",
    "data/resisei-layla/toc.json": "f384cc2f7f70bed3e77dc1490738384d0ca1b06ed4ef31020308d0e381a99985",
    "data/takanat-hashavin/0.json": "5072477048640d0e73f166b67f5352bc44f4eca010a88dd2d6dc576241e932b6",
    "data/takanat-hashavin/1.json": "e00388a412d53f9ac02a39d83978479d618680e2406d04ac9eeb55cc7c86d4ee",
    "data/takanat-hashavin/10.json": "f0ebd53943637907fb6d360a06d01f33e25f5a6f99cff6e96fd8af08c8b9b0bc",
    "data/takanat-hashavin/11.json": "6ecf59fb014b2d4dac5ca333f2bd983a3a8f69c77d409cc148aa46c6dc2a9010",
    "data/takanat-hashavin/12.json": "aa186f0a1a8e6c4e3a6ba18a89d4caeded63b92d8c0a061b9705e1c3bd92d022",
    "data/takanat-hashavin/13.json": "eef699950f2967ff0b43cf47dbce6a0d35edeba51c613030b50a3db5eb67939f",
    "data/takanat-hashavin/14.json": "62a1a1b04f4df73ce9ca9a15bf43f7f11fe3202d272aa415b063e1f7a3b74f84",
    "data/takanat-hashavin/15.json": "bb75a2a24427d31715f8105a64cf9aca22eba7ccf13259473990854142e99ddd",
    "data/takanat-hashavin/2.json": "dd2be1c0eb8d356b8f1ec5d1186c30aee336475eb8bbdb2a78e24c7e76f08759",
    "data/takanat-hashavin/3.json": "cb3b7d69fb5c005f1478836fe156d7d81b6bd81dc0e982b4cf1ba7b6e885baf0",
    "data/takanat-hashavin/4.json": "3f06ff527add034e6c8b387ebbbcf5445022d547206004d3a0585c66ccd563a6",
    "data/takanat-hashavin/5.json": "ef89e363400da64b210a64cc39939545cba35160675c62a3b02fec7b7dc5c90f",
    "data/takanat-hashavin/6.json": "5e191f6b63b212dbda45920a58d0736d878739288ab6da4a4cf255f0a0aabc56",
    "data/takanat-hashavin/7.json": "b0426c6375062aaecd8e540a38646beec294321159c1c35cf9e051afec252be6",
    "data/takanat-hashavin/8.json": "3181abc3c05375b3c93ed1ab4cebdfbee27b742af5d65d301a9f97da05b874f0",
    "data/takanat-hashavin/9.json": "b5dea18c986f8c078f94b5c838672905a0a44008bf9b01c676df48ff1818e810",
    "data/takanat-hashavin/links.json": "5200e0f8a2457baf0f084300ffa549d8ab143bd6e48fe15093aa6e2dfaec02a7",
    "data/takanat-hashavin/toc.json": "e28e12ccb15e61a6a20a0192516bbffd7859f91cb7c3413b87bec6238d891f82"
  }
};

function verifyCurrentProtectedEdition(root) {
  const failures = [];
  for (const [relativeFile, expected] of Object.entries(CURRENT_PROTECTED_EDITION.files)) {
    const filename = path.join(root, relativeFile);
    checkInputPath(root, filename);
    if (!fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) {
      failures.push(`${relativeFile}: missing protected file`);
    } else if (digest(fs.readFileSync(filename)) !== expected) {
      failures.push(`${relativeFile}: differs from the verified live edition`);
    }
  }
  if (failures.length) throw Error(
    `Protected edition check failed (${failures.length} file(s)). No data was changed. ` +
    `Use the current reader edition; do not replace live Dover Tzedek with an older archive.\n` +
    failures.slice(0, 8).join('\n') + (failures.length > 8 ? '\nAdditional mismatches omitted.' : '')
  );
  for (const book of TARGET_BOOKS) {
    const toc = path.join(root, 'data', book.slug, 'toc.json');
    checkInputPath(root, toc);
    if (!fs.existsSync(toc) || !fs.lstatSync(toc).isFile())
      throw Error(`Incomplete reader: missing data/${book.slug}/toc.json. Use the complete current library root.`);
  }
  const { files, ...edition } = CURRENT_PROTECTED_EDITION;
  return { ...edition, fileCount: Object.keys(files).length, verified: true };
}

const CHAPTER_FILE = /^\d+(?:-\d+)*\.json$/;
const ROLES = { rav: 'parallel-rav-tzadok', ishbitz: 'parallel-ishbitz-radzin' };
const LABELS = {
  rav: /^Kisvei\s+Rav\s+Tzadok\s+Parallel\b\s*(?:[—–-]\s*)?/i,
  ishbitz: /^Kisvei\s+(?:Beis|Beit)\s+Ishbitz[\s—–-]+Radzin\s+Parallel\b\s*(?:[—–-]\s*)?/i,
};
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const digest = (x) => crypto.createHash('sha256').update(x).digest('hex');
const objectDigest = (x) => digest(JSON.stringify(x));
const relative = (root, filename) => path.relative(root, filename).split(path.sep).join('/');

function plain(text) {
  return String(text).replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const names = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (names[entity.toLowerCase()]) return names[entity.toLowerCase()];
    const value = entity.slice(2, -1);
    const code = /^x/i.test(value) ? parseInt(value.slice(1), 16) : parseInt(value, 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }).replace(/[\u200e\u200f\ufeff]/g, '').trim().replace(/^(?:\*\*|__)/, '').replace(/[\s\u00a0]+/g, ' ');
}

// Used only to compare identifiers and references, never to alter stored text.
function refKey(ref) {
  return plain(ref).normalize('NFKD').replace(/[\u0591-\u05c7\u0300-\u036f]/g, '')
    .replace(/\s*\((?:§|paragraph\b)[^)]*\)/gi, '')
    .replace(/\s*\[(?:paragraph\b)[^\]]*\]/gi, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function isProtectedPeriSection({ file, refs = [] } = {}) {
  if (file && PROTECTED_PERI_FILES.has(path.basename(file))) return true;
  return refs.some((ref) => {
    const key = refKey(ref);
    return /^(?:peri|pri) tzadd?ik noa(?:ch|h) (?:5|6|v|vi|heh|hei|vav)(?: \d+(?: \d+)*)?$/.test(key)
      || /^(?:peri|pri) tzadd?ik rosh (?:chodesh|hodesh) (?:mar ?)?cheshv[ao]n(?: \d+(?: \d+)*)?$/.test(key)
      || /^פרי צדיק נח (?:אות )?[הו](?: \d+)*$/.test(key)
      || /^פרי צדיק (?:ראש חודש|ר ח) (?:מר ?חשוו?ן|חשוו?ן)(?: \d+)*$/.test(key);
  });
}

function labelKind(text) {
  const value = plain(text);
  for (const [kind, regex] of Object.entries(LABELS)) if (regex.test(value)) return kind;
  if (/^Sources:\s*.*\bParallels:\s*/i.test(value)
    || /^Sources\s*\|\s*Parallels\s*[:—–-]/i.test(value)) return 'summary';
  return null;
}

function inspectParagraph(paragraph) {
  const representations = [];
  let unknown = false;
  if (typeof paragraph === 'string') representations.push(paragraph);
  else if (object(paragraph)) {
    if (own(paragraph, 'text')) {
      if (typeof paragraph.text === 'string') representations.push(paragraph.text);
      else unknown = true;
    }
    if (own(paragraph, 'rich')) {
      if (typeof paragraph.rich === 'string') representations.push(paragraph.rich);
      else if (Array.isArray(paragraph.rich) && paragraph.rich.every((run) => object(run) && typeof run.text === 'string'))
        representations.push(paragraph.rich.map((run) => run.text).join(''));
      else unknown = true;
    }
    if (!representations.length) unknown = true;
  } else unknown = true;
  const nonempty = representations.map(plain).filter(Boolean);
  const kinds = new Set(nonempty.map(labelKind));
  if (kinds.size > 1 && [...kinds].some(Boolean))
    throw Error('Ambiguous footnote paragraph: text and rich representations disagree about an appended heading');
  return { text: nonempty[0] || '', kind: kinds.values().next().value || null, unknown };
}

function paragraphLinks(paragraph) {
  if (!object(paragraph)) return [];
  return [
    ...(Array.isArray(paragraph.rich) ? paragraph.rich : []),
    ...(Array.isArray(paragraph.links) ? paragraph.links : []),
  ].filter(object);
}

function sourceMatchesParagraph(source, paragraph, inspected, kind) {
  if (typeof source.ref !== 'string' || !source.ref.trim()) return false;
  const sourceKey = refKey(source.ref);
  const header = refKey(inspected.text.replace(LABELS[kind], ''));
  if (header === sourceKey || header.startsWith(`${sourceKey} `)) return true;
  // Structured runs sometimes carry a more exact ref than the visible header.
  return paragraphLinks(paragraph).some((run) => {
    const label = run.label ?? run.text;
    return typeof label === 'string' && refKey(label) === sourceKey;
  });
}

/** Pure transformation. Only paragraphs[] and associated sources[] can change. */
function cleanFootnote(note) {
  if (!object(note)) throw Error('Unknown footnote shape: expected an object');
  if (!Array.isArray(note.paragraphs)) {
    if (/Kisvei\s+(?:Rav\s+Tzadok|(?:Beis|Beit)\s+Ishbitz)/i.test(JSON.stringify(note)))
      throw Error('Unknown candidate footnote shape: expected paragraphs[]');
    return { note, change: null };
  }
  const inspected = note.paragraphs.map(inspectParagraph);
  // A standalone parallel note is original content, not an appended block.
  if (inspected[0]?.kind) return { note, change: null };
  const blocks = inspected.flatMap((p, index) => index > 0 && (p.kind === 'rav' || p.kind === 'ishbitz') ? [index] : []);
  if (!blocks.length) return { note, change: null };
  if (inspected.some((p) => p.unknown)) throw Error('Unknown paragraph shape in a candidate footnote');
  if (!inspected[0]?.text) throw Error('Candidate footnote has no nonempty first source paragraph');
  const firstBlock = Math.min(...blocks);
  const remove = new Set([...blocks, ...inspected.flatMap((p, index) => p.kind === 'summary' && index > firstBlock ? [index] : [])]);
  const remaining = note.paragraphs.filter((_, index) => !remove.has(index));
  const removedSources = [];
  let sources = note.sources;
  if (own(note, 'sources')) {
    if (!Array.isArray(sources) || !sources.every(object))
      throw Error('Unknown sources shape in a candidate footnote');
    sources = sources.filter((source, index) => {
      const kind = Object.keys(ROLES).find((key) => ROLES[key] === source.role);
      if (!kind) return true;
      const associated = blocks.some((i) => inspected[i].kind === kind
        && sourceMatchesParagraph(source, note.paragraphs[i], inspected[i], kind));
      if (!associated) return true;
      // Keep an entry still used by a separately curated appended paragraph.
      const independentlyUsed = inspected.some((p, i) => i > 0 && !remove.has(i)
        && /^(?:Additional\s+)?Kisvei\s+/i.test(p.text)
        && paragraphLinks(note.paragraphs[i]).some((run) => refKey(run.label ?? run.text ?? '') === refKey(source.ref)));
      if (independentlyUsed) return true;
      removedSources.push({ index, role: source.role, ref: source.ref });
      return false;
    });
  }
  const cleaned = { ...note, paragraphs: remaining };
  if (own(note, 'sources') && removedSources.length) cleaned.sources = sources;
  const change = {
    paragraphCountBefore: note.paragraphs.length,
    paragraphCountAfter: remaining.length,
    removedParagraphs: [...remove].sort((a, b) => a - b).map((index) => ({
      index, kind: inspected[index].kind,
      textSha256: objectDigest(note.paragraphs[index]),
      heading: inspected[index].text.slice(0, 180),
    })),
    removedSources,
  };
  assert.deepEqual(cleaned.paragraphs[0], note.paragraphs[0], 'First paragraph changed');
  const metadata = ({ paragraphs, sources, ...rest }) => rest;
  assert.deepEqual(metadata(cleaned), metadata(note), 'Footnote metadata changed');
  return { note: cleaned, change };
}

function fingerprintItems(items) {
  const notes = [];
  function body(value) {
    if (Array.isArray(value)) return value.map(body);
    if (!object(value)) return value;
    if (!own(value, 'footnotes')) return value;
    if (!Array.isArray(value.footnotes)) throw Error('Unknown item footnotes shape');
    notes.push(...value.footnotes);
    const { footnotes, ...rest } = value;
    return rest;
  }
  const bodyHash = objectDigest(body(items));
  return {
    bodySha256: bodyHash, notes: notes.length,
    metadataSha256: objectDigest(notes.map(({ paragraphs, sources, ...rest }) => rest)),
    firstParagraphsSha256: objectDigest(notes.map((note) => note.paragraphs?.[0] ?? null)),
  };
}

function equalFingerprints(before, after) {
  assert.equal(after.bodySha256, before.bodySha256, 'Body text/structure changed');
  assert.equal(after.notes, before.notes, 'Footnote count changed');
  assert.equal(after.metadataSha256, before.metadataSha256, 'Footnote identities, placement or metadata changed');
  assert.equal(after.firstParagraphsSha256, before.firstParagraphsSha256, 'First source paragraphs changed');
}

function readJson(filename) {
  const raw = fs.readFileSync(filename, 'utf8');
  try { return { raw, value: JSON.parse(raw) }; }
  catch (error) { throw Error(`Invalid JSON in ${filename}: ${error.message}`); }
}

function chapterMap(toc) {
  const byFile = new Map();
  function walk(node) {
    if (!object(node)) throw Error('Unknown TOC node shape');
    const file = typeof node.file === 'string' && CHAPTER_FILE.test(node.file) ? node.file
      : (typeof node.id === 'number' || typeof node.id === 'string') && CHAPTER_FILE.test(`${node.id}.json`) ? `${node.id}.json` : null;
    if (file) {
      const entry = byFile.get(file) || { file, refs: [], separators: {} };
      for (const key of ['ref', 'heRef']) if (typeof node[key] === 'string' && !entry.refs.includes(node[key])) entry.refs.push(node[key]);
      if (typeof node.ref === 'string') entry.separators[node.ref] = typeof node.sep === 'string' ? node.sep : ':';
      byFile.set(file, entry);
    }
    // Sefaria-schema volumes store a depth-two leaf as id-chapter.json; the
    // root ref alone is not the owner of any of those chapter files.
    if (Number(node.depth) >= 2 && Array.isArray(node.shape) && (typeof node.id === 'number' || typeof node.id === 'string')) {
      for (let index = 0; index < node.shape.length; index++) {
        const chapterFile = `${node.id}-${index + 1}.json`;
        if (!CHAPTER_FILE.test(chapterFile)) throw Error('Unknown nested TOC file identifier');
        const entry = byFile.get(chapterFile) || { file: chapterFile, refs: [], separators: {} };
        for (const key of ['ref', 'heRef']) if (typeof node[key] === 'string') {
          const chapterRef = `${node[key]} ${index + 1}`;
          if (!entry.refs.includes(chapterRef)) entry.refs.push(chapterRef);
          entry.separators[chapterRef] = ':';
        }
        byFile.set(chapterFile, entry);
      }
    }
    if (own(node, 'children')) {
      if (!Array.isArray(node.children)) throw Error('Unknown TOC children shape');
      node.children.forEach(walk);
    }
  }
  if (!object(toc) || !object(toc.toc)) throw Error('Unknown TOC shape: expected toc tree');
  walk(toc.toc);
  return byFile;
}

function explicitParagraphRefs(paragraph) {
  const refs = [];
  const links = paragraphLinks(paragraph);
  const html = typeof paragraph === 'string' ? [paragraph]
    : object(paragraph) ? [paragraph.text, paragraph.rich].filter((value) => typeof value === 'string') : [];
  for (const text of html) for (const match of text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const link = { text: plain(match[2]) };
    for (const attribute of match[1].matchAll(/\b(href|data-ref)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))
      link[attribute[1].toLowerCase() === 'data-ref' ? 'ref' : 'href'] = plain(attribute[2] ?? attribute[3] ?? attribute[4]);
    links.push(link);
  }
  for (const link of links) {
    if (!['href', 'url', 'ref', 'label'].some((key) => typeof link[key] === 'string')) continue;
    for (const key of ['ref', 'label', 'text']) if (typeof link[key] === 'string' && link[key].trim()) refs.push(link[key]);
    const href = link.href ?? link.url;
    if (typeof href !== 'string') continue;
    try {
      const url = new URL(href);
      if (!['sefaria.org', 'www.sefaria.org', 'sefaria.org.il', 'www.sefaria.org.il'].includes(url.hostname.toLowerCase())) continue;
      const ref = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (ref && !/^(?:api|texts|topics|sheets|collections|profile)(?:\/|$)/i.test(ref)) refs.push(ref);
    } catch { /* An unreadable URL does not establish a source identity. */ }
  }
  return refs;
}

function retainedReferences(note) {
  const refs = [
    ...(Array.isArray(note.sources) ? note.sources.filter(object).map((source) => source.ref) : []),
    ...(Array.isArray(note.paragraphs) ? note.paragraphs.flatMap(explicitParagraphRefs) : []),
  ];
  return [...new Set(refs.filter((ref) => typeof ref === 'string' && ref.trim()))].map((ref) => ({ ref }));
}

function addEvidence(evidence, owner, itemNumber, note, sources) {
  if (!['number', 'string'].includes(typeof itemNumber)) throw Error('Unknown item number in an affected note');
  const numbers = new Set([itemNumber]);
  const provenance = note.provenance;
  if (object(provenance)) {
    const sameFile = [provenance.sourceFile, provenance.sectionFile].some((file) => typeof file === 'string' && path.basename(file) === owner.file);
    const sameOwner = [provenance.section, provenance.sectionRef].some((ref) => typeof ref === 'string' && owner.refs.some((ownRef) => refKey(ownRef) === refKey(ref)));
    // Earlier importers counted heading rows in their link anchors. Accept a
    // historical item number only when its exact file AND section owner agree;
    // citation mentions can never supply or protect an owner.
    if (sameFile && sameOwner && /^\d+$/.test(String(provenance.item)) && Number(provenance.item) > 0)
      numbers.add(provenance.item);
  }
  for (const sectionRef of owner.refs) {
    const anchors = [...numbers].map((number) => `${sectionRef}${owner.separators?.[sectionRef] ?? ':'}${number}`);
    for (const source of sources) {
      // Some original importers indexed a whole siman as their anchor, while
      // others indexed the paragraph. Both must still belong to this exact
      // TOC owner, and both must cite a removed source in that owner's note.
      for (const anchorRef of [...anchors, sectionRef]) {
        const key = [refKey(sectionRef), refKey(anchorRef), refKey(source.ref)].join('|');
        const entry = evidence.get(key) || { ids: new Set(), unidentified: false };
        const ids = [note.sourceId, note.placementId, note.id].filter((id) => typeof id === 'string');
        if (!ids.length) entry.unidentified = true;
        ids.forEach((id) => entry.ids.add(id));
        evidence.set(key, entry);
      }
    }
  }
}

function transformItems(items, owner, evidence, retainedEvidence) {
  if (!Array.isArray(items)) throw Error('Unknown reader section shape: expected items array');
  const changes = [];
  function transform(item, itemIndex, indices, itemNumber) {
    if (Array.isArray(item)) return transformArray(item, [...indices, itemIndex]);
    if (!object(item) || !own(item, 'footnotes')) return item;
    if (!Array.isArray(item.footnotes)) throw Error('Unknown item footnotes shape');
    let changed = false;
    const footnotes = item.footnotes.map((note, noteIndex) => {
      const result = cleanFootnote(note);
      if (retainedEvidence) addEvidence(retainedEvidence, owner, itemNumber, result.note, retainedReferences(result.note));
      if (!result.change) return note;
      assert.equal(cleanFootnote(result.note).change, null, 'Footnote cleanup is not idempotent');
      changed = true;
      changes.push({
        sectionFile: owner.file, sectionRefs: owner.refs,
        itemIndex: indices.length ? [...indices, itemIndex] : itemIndex,
        itemNumber, noteIndex,
        number: note.number ?? null, sourceId: note.sourceId ?? null, placementId: note.placementId ?? null,
        ...result.change,
      });
      if (evidence) addEvidence(evidence, owner, itemNumber, note, result.change.removedSources);
      return result.note;
    });
    return changed ? { ...item, footnotes } : item;
  }
  function transformArray(array, indices = []) {
    let paragraphNumber = 0;
    return array.map((item, index) => {
      if (object(item) && Array.isArray(item.p)) paragraphNumber++;
      // The reader numbers bilingual paragraphs, excluding h/heading records.
      // This is the same counting convention as build-library.mjs/connect().
      const itemNumber = object(item) ? item.n || paragraphNumber || index + 1 : index + 1;
      return transform(item, index, indices, itemNumber);
    });
  }
  return { items: transformArray(items), changes };
}

function transformLinks(links, evidence, retainedEvidence, protectedRefs) {
  if (!object(links)) throw Error('Unknown links.json shape: expected ref-to-array map');
  const changes = [];
  const retainedSharedLinks = [];
  const result = { ...links };
  for (const [sectionRef, rows] of Object.entries(links)) {
    if (!Array.isArray(rows)) throw Error('Unknown links.json entry shape');
    if (protectedRefs.has(refKey(sectionRef)) || isProtectedPeriSection({ refs: [sectionRef] })) continue;
    const removedLinks = [];
    const kept = rows.filter((link, index) => {
      if (!object(link)) throw Error('Unknown link shape');
      if (link.c !== 'Parallel Sources' || typeof link.a !== 'string' || typeof link.r !== 'string') return true;
      const key = [refKey(sectionRef), refKey(link.a), refKey(link.r)].join('|');
      const removedSupport = evidence.get(key);
      if (!removedSupport) return true;
      const identities = [link.sourceId, link.placementId, link.noteId].filter((id) => typeof id === 'string');
      const explicitNote = identities.length > 0 && identities.every((id) => removedSupport.ids.has(id));
      // An explicitly named different note is stronger evidence than a generic
      // generated category, and must never be swept into this note's cleanup.
      if (identities.length && !explicitNote) return true;
      // Independently curated relations are outside the generated appendices.
      const generated = /^(?:Direct conceptual parallel|Supplied parallel)(?:$| · (?:Rav Tzadok|Ishbitz[–—-]Radzin)$)/.test(link.kind ?? '');
      if (!generated && !explicitNote) return true;
      const retainedSupport = retainedEvidence.get(key);
      if (retainedSupport) {
        const uniquelyRemovedNote = explicitNote && !retainedSupport.unidentified
          && identities.every((id) => !retainedSupport.ids.has(id));
        if (!uniquelyRemovedNote) {
          retainedSharedLinks.push({ sectionRef, index, a: link.a, r: link.r, c: link.c,
            removedNoteIds: [...removedSupport.ids], retainedNoteIds: [...retainedSupport.ids],
            reason: 'The relation is also supported by a retained footnote source or explicit paragraph link.' });
          return true;
        }
      }
      removedLinks.push({ index, ...link });
      return false;
    });
    if (removedLinks.length) {
      result[sectionRef] = kept;
      changes.push({ sectionRef, removedLinks });
    }
  }
  return { links: result, changes, retainedSharedLinks };
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  if (fs.lstatSync(dir).isSymbolicLink()) throw Error(`Refusing a symlink in the cleanup scope: ${dir}`);
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const filename = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Refusing a symlink in the cleanup scope: ${filename}`);
    return entry.isDirectory() ? walkFiles(filename) : entry.isFile() ? [filename] : [];
  });
}

function checkInputPath(root, filename) {
  const rel = relative(root, filename);
  if (rel.startsWith('../') || path.isAbsolute(rel)) throw Error('Input escaped the explicit library root');
  let current = root;
  for (const segment of rel.split('/')) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw Error(`Refusing a symlink in the cleanup scope: ${current}`);
  }
}

function safeReportPath(root, supplied) {
  let destination = path.resolve(supplied);
  if (path.extname(destination).toLowerCase() !== '.json') throw Error('--report must name a .json report file');
  if (fs.existsSync(destination) && !fs.lstatSync(destination).isFile())
    throw Error('--report must name a regular file, never a directory or symlink');
  // Resolve the existing parent even when the final output directory is new.
  let parent = path.dirname(destination);
  const missing = [];
  while (!fs.existsSync(parent)) {
    missing.unshift(path.basename(parent));
    const next = path.dirname(parent);
    if (next === parent) throw Error('Cannot resolve report directory');
    parent = next;
  }
  parent = path.join(fs.realpathSync(parent), ...missing);
  destination = path.join(parent, path.basename(destination));
  const rel = relative(root, destination);
  if (/^(?:data|sources)\//.test(rel)) throw Error('--report must be outside data/ and sources/');
  return destination;
}

function emptyBook() {
  return { readerFilesScanned: 0, readerFilesChanged: 0, masterFilesChanged: 0,
    footnotesBefore: 0, footnotesAfter: 0, protectedFootnotes: 0,
    footnotesChanged: 0, paragraphsRemoved: 0, ravParagraphsRemoved: 0,
    ishbitzParagraphsRemoved: 0, summaryParagraphsRemoved: 0,
    sourceEntriesRemoved: 0, linkEntriesRemoved: 0, sharedLinkEntriesPreserved: 0 };
}

/** Prepare and optionally apply one complete plan. Does not write by default. */
function runCleanup({ root, write = false, report: reportPath } = {}) {
  if (typeof root !== 'string' || !root.trim()) throw Error('--root is required; it must name a library directory containing data/');
  if (write && !reportPath) throw Error('--write requires --report REPORT_JSON so every applied change has an audit record');
  root = fs.realpathSync(path.resolve(root));
  const protectedEdition = verifyCurrentProtectedEdition(root);
  checkInputPath(root, path.join(root, 'data'));
  if (!fs.existsSync(path.join(root, 'data')) || !fs.statSync(path.join(root, 'data')).isDirectory())
    throw Error(`No data/ directory under explicit --root ${root}`);
  if (reportPath) {
    reportPath = safeReportPath(root, reportPath);
  }
  const report = {
    schemaVersion: 1, root, mode: write ? 'write' : 'dry-run', protectedEdition,
    policy: 'Remove only labeled appended paragraphs and their generated source/link entries; preserve source text, anchors, curated parallels and protected owners.',
    assertions: { bodyUnchanged: true, footnoteCountsUnchanged: true, noteMetadataUnchanged: true,
      firstParagraphsUnchanged: true, protectedUnchanged: true, idempotent: true },
    books: Object.fromEntries(TARGET_BOOKS.map((book) => [book.slug, emptyBook()])),
    files: [], protectedFiles: [], protectedSections: [], retainedSharedLinks: [],
  };
  const plans = [];
  const protectedFiles = new Map();
  function protectFile(filename) {
    checkInputPath(root, filename);
    if (fs.existsSync(filename) && !protectedFiles.has(filename)) {
      const sha256 = digest(fs.readFileSync(filename));
      protectedFiles.set(filename, sha256);
      report.protectedFiles.push({ path: relative(root, filename), sha256 });
    }
  }
  for (const book of PROTECTED_BOOKS) {
    for (const filename of walkFiles(path.join(root, 'data', book.slug))) protectFile(filename);
    protectFile(path.join(root, 'sources', 'akiva', `${book.id}.json`));
  }
  function planFile(filename, raw, value, book, kind, changes, fingerprints) {
    if (!changes.length) return;
    const after = JSON.stringify(value) + '\n';
    if (after === raw) throw Error('Change report did not produce changed JSON');
    const file = { path: relative(root, filename), book: book.slug, kind,
      beforeSha256: digest(raw), afterSha256: digest(after), changes };
    if (fingerprints) Object.assign(file, {
      notesBefore: fingerprints.before.notes, notesAfter: fingerprints.after.notes,
      bodyBeforeSha256: fingerprints.before.bodySha256, bodyAfterSha256: fingerprints.after.bodySha256,
    });
    report.files.push(file);
    plans.push({ filename, before: raw, after, file });
  }
  for (const book of TARGET_BOOKS) {
    const dir = path.join(root, 'data', book.slug);
    checkInputPath(root, dir);
    const stats = report.books[book.slug];
    checkInputPath(root, path.join(dir, 'toc.json'));
    const map = fs.existsSync(path.join(dir, 'toc.json')) ? chapterMap(readJson(path.join(dir, 'toc.json')).value) : new Map();
    const protectedRefs = new Set();
    if (book.slug === 'peri-tzadik') for (const owner of map.values()) if (isProtectedPeriSection(owner))
      owner.refs.forEach((ref) => protectedRefs.add(refKey(ref)));
    const evidence = new Map();
    const retainedEvidence = new Map();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => CHAPTER_FILE.test(file)).sort() : [];
    for (const file of files) {
      const filename = path.join(dir, file);
      if (fs.lstatSync(filename).isSymbolicLink()) throw Error(`Refusing chapter symlink ${filename}`);
      const { raw, value } = readJson(filename);
      if (!Array.isArray(value)) throw Error(`Unknown chapter shape in ${filename}`);
      const owner = map.get(file) || { file, refs: [], separators: {} };
      const before = fingerprintItems(value);
      stats.readerFilesScanned++; stats.footnotesBefore += before.notes; stats.footnotesAfter += before.notes;
      if (book.slug === 'peri-tzadik' && isProtectedPeriSection(owner)) {
        protectFile(filename); stats.protectedFootnotes += before.notes; continue;
      }
      let result;
      try { result = transformItems(value, owner, evidence, retainedEvidence); }
      catch (error) { throw Error(`${relative(root, filename)}: ${error.message}`); }
      if (!result.changes.length) continue;
      if (!owner.refs.length) throw Error(`Cannot establish the TOC owner of affected reader chapter ${relative(root, filename)}`);
      const after = fingerprintItems(result.items);
      equalFingerprints(before, after);
      planFile(filename, raw, result.items, book, 'reader', result.changes, { before, after });
      stats.readerFilesChanged++; stats.footnotesChanged += result.changes.length;
      for (const change of result.changes) {
        stats.paragraphsRemoved += change.removedParagraphs.length;
        stats.sourceEntriesRemoved += change.removedSources.length;
        for (const paragraph of change.removedParagraphs) stats[`${paragraph.kind}ParagraphsRemoved`]++;
      }
    }
    // A master is owned by its exact known filename. Section refs and filenames
    // are authority; refs mentioned in the note or a cited source are not.
    const masterFile = path.join(root, 'sources', 'akiva', `${book.id}.json`);
    checkInputPath(root, masterFile);
    if (fs.existsSync(masterFile)) {
      const { raw, value } = readJson(masterFile);
      if (!object(value) || !Array.isArray(value.sections)) throw Error(`Unknown master shape in ${masterFile}`);
      const changes = [];
      const beforeAll = [], afterAll = [];
      const sections = value.sections.map((section, index) => {
        if (!object(section) || !Array.isArray(section.items)) throw Error(`Unknown master section shape in ${masterFile} section ${index}`);
        const file = typeof section.file === 'string' && CHAPTER_FILE.test(section.file) ? section.file : null;
        const refs = [...new Set([...(file ? map.get(file)?.refs || [] : []), section.ref, section.heRef].filter((ref) => typeof ref === 'string'))];
        const owner = { file, refs, separators: file ? map.get(file)?.separators || {} : {} };
        beforeAll.push(section.items);
        if (book.slug === 'peri-tzadik' && isProtectedPeriSection(owner)) {
          report.protectedSections.push({ path: relative(root, masterFile), sectionIndex: index, file, refs, sha256: objectDigest(section) });
          afterAll.push(section.items); return section;
        }
        const result = transformItems(section.items, owner, null);
        if (result.changes.length && book.slug === 'peri-tzadik' && !file && !refs.length)
          throw Error(`Cannot establish the owner of Peri Tzadik master section ${index}`);
        afterAll.push(result.items);
        changes.push(...result.changes.map((change) => ({ masterSectionIndex: index, ...change })));
        return result.changes.length ? { ...section, items: result.items } : section;
      });
      if (changes.length) {
        const before = fingerprintItems(beforeAll), after = fingerprintItems(afterAll);
        equalFingerprints(before, after);
        const transformed = { ...value, sections };
        for (const protection of report.protectedSections.filter((p) => p.path === relative(root, masterFile)))
          assert.equal(objectDigest(transformed.sections[protection.sectionIndex]), protection.sha256, 'Protected master section changed');
        planFile(masterFile, raw, transformed, book, 'master', changes, { before, after });
        stats.masterFilesChanged++;
      }
    }
    const linksFile = path.join(dir, 'links.json');
    checkInputPath(root, linksFile);
    if (evidence.size && fs.existsSync(linksFile)) {
      const { raw, value } = readJson(linksFile);
      const result = transformLinks(value, evidence, retainedEvidence, protectedRefs);
      stats.sharedLinkEntriesPreserved = result.retainedSharedLinks.length;
      report.retainedSharedLinks.push(...result.retainedSharedLinks.map((link) => ({ book: book.slug, ...link })));
      if (result.changes.length) {
        assert.equal(transformLinks(result.links, evidence, retainedEvidence, protectedRefs).changes.length, 0, 'Link cleanup is not idempotent');
        planFile(linksFile, raw, result.links, book, 'links', result.changes);
        stats.linkEntriesRemoved = result.changes.reduce((sum, change) => sum + change.removedLinks.length, 0);
      }
    }
  }
  function verifyProtected() {
    for (const [filename, sha256] of protectedFiles)
      assert.equal(digest(fs.readFileSync(filename)), sha256, `Protected file changed: ${filename}`);
  }
  verifyProtected();
  report.totals = Object.values(report.books).reduce((totals, book) => {
    for (const [key, value] of Object.entries(book)) totals[key] = (totals[key] || 0) + value;
    return totals;
  }, { filesChanged: plans.length });
  let stagedReport = null;
  let previousReport = null;
  let reportCommitted = false;
  if (reportPath) {
    // Prepare proof before touching data. A bad/unwritable report destination
    // must not leave successfully changed files without their audit record.
    reportPath = safeReportPath(root, reportPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    previousReport = fs.existsSync(reportPath) ? fs.readFileSync(reportPath) : null;
    stagedReport = `${reportPath}.parallel-cleanup-${process.pid}.tmp`;
    fs.writeFileSync(stagedReport, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  const written = [];
  try {
    if (write) {
    // Reject a stale preview if another process changed any planned input.
    for (const plan of plans) assert.equal(digest(fs.readFileSync(plan.filename)), plan.file.beforeSha256,
      `File changed while preparing cleanup: ${plan.filename}`);
      for (const plan of plans) {
        const temporary = `${plan.filename}.parallel-cleanup-${process.pid}.tmp`;
        try {
          fs.writeFileSync(temporary, plan.after, { flag: 'wx', mode: fs.statSync(plan.filename).mode });
          fs.renameSync(temporary, plan.filename);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        written.push(plan);
        assert.equal(digest(fs.readFileSync(plan.filename)), plan.file.afterSha256, `Written file differs: ${plan.filename}`);
      }
      verifyProtected();
    }
    if (stagedReport) {
      safeReportPath(root, reportPath);
      fs.renameSync(stagedReport, reportPath);
      reportCommitted = true;
    }
    verifyProtected();
  } catch (error) {
    for (const plan of written.reverse()) fs.writeFileSync(plan.filename, plan.before);
    if (reportCommitted) {
      if (previousReport !== null) fs.writeFileSync(reportPath, previousReport);
      else fs.unlinkSync(reportPath);
    }
    throw error;
  } finally {
    if (stagedReport && fs.existsSync(stagedReport)) fs.unlinkSync(stagedReport);
  }
  return report;
}

function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      process.stdout.write('Usage: node strip_appended_parallels.js --root LIBRARY_ROOT [--write] [--report REPORT_JSON]\nDry-run is the default. --write requires --report. Use the complete current reader directory containing data/. Reports belong outside data/ and sources/. The 102 protected files must match the verified 2026-10-18 live edition.\n');
      return;
    }
    if (arg === '--write') options.write = true;
    else if (arg === '--root' || arg === '--report') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw Error(`Unknown argument: ${arg}`);
  }
  const report = runCleanup(options);
  process.stdout.write(JSON.stringify({ mode: report.mode, root: report.root, protectedEdition: report.protectedEdition, assertions: report.assertions,
    totals: report.totals, books: report.books, report: options.report ? path.resolve(options.report) : null }, null, 2) + '\n');
}
main(process.argv.slice(2));

})().catch((error) => {
  process.stderr.write(`Parallel cleanup aborted: ${error.message}\n`);
  process.exitCode = 1;
});
