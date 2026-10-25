// Exact original-English successor for the 1,369 user-authorized native notes.
// Historical packs/reports and the frozen note4031 source phase stay immutable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {sourceFileInfo,prepareSourceAdditionTransition,SOURCE_CHAPTER,loadSourceAddition} from './tzidkat-source-addition-transition.mjs';
import {loadPack as loadPriParsha,preparePriParshaTransition,DESCRIPTOR as PRI_DESCRIPTOR,REPORT as PRI_REPORT} from './pri-parsha-review-core.mjs';

const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ENGLISH_RELEASE='20261025-tzidkat-original-english-v1';
export const ENGLISH_PACK='sources/akiva/addenda/tzidkat-original-english-20261025.json.gz';
export const ENGLISH_DESCRIPTOR='sources/akiva/addenda/tzidkat-original-english-transition-20261025.json';
export const ENGLISH_APPROVAL='sources/akiva/addenda/tzidkat-original-english-approved-20261025.json';
export const ENGLISH_INVENTORY_SHA='05940cd9f81cce04a5f912a47988a8ba40747cc424851a84f184f47d966ad6d4';
export const ENGLISH_NUMBERS=Object.freeze([1,2,3,5,6,7,8,9,10,11,12,15,16,17,18,19,20,23,24,25,26,27,28,29,30,35,36,37,38,39,40,41,43,44,45,47,48,49,54,57,58,59,60,61,63,64,65,67,69,70,71,72,73,74,75,76,77,78,79,80,82,83,84,85,86,87,88,89,90,91,94,95,97,99,100,103,107,108,109,110,111,112,114,115,117,123,125,126,127,129,130,131,139,140,141,142,143,144,146,147,149,150,151,153,154,155,157,161,162,163,165,166,167,171,172,173,175,176,177,180,181,182,183,184,185,186,188,189,192,194,195,198,199,200,203,204,205,208,209,210,211,212,213,214,215,216,217,218,219,221,225,227,228,229,231,233,234,235,236,237,238,239,240,241,242,243,244,245,247,248,249,250,253,254,255,256,258,262,263,264,265,268,269,270,271,275,276,277,280,281,284,285,286,288,289,290,291,292,294,295,296,297,298,299,303,304,306,307,309,310,311,312,313,315,316,318,321,323,325,326,327,328,330,332,333,335,337,340,341,342,344,345,346,347,349,350,351,352,353,354,359,360,362,365,367,368,369,370,371,372,374,375,377,378,380,381,384,387,390,391,392,393,394,395,396,397,398,399,400,401,403,406,407,408,409,410,411,413,415,416,417,420,422,423,424,425,427,428,429,430,431,434,435,438,440,441,442,444,446,447,449,450,451,453,454,455,456,457,461,469,470,471,472,473,474,476,477,479,480,481,482,484,485,486,487,488,489,490,491,492,493,494,496,498,499,500,505,506,507,508,515,516,517,518,519,521,522,523,524,525,526,527,528,531,532,533,534,537,539,540,541,542,545,547,551,552,553,554,555,556,557,561,562,564,565,566,567,568,569,570,571,572,574,575,576,577,580,581,583,584,585,587,588,589,592,593,594,595,596,597,600,605,607,609,612,613,614,615,618,619,620,621,622,624,625,627,628,630,632,636,638,640,641,642,643,644,645,646,647,648,649,651,652,653,657,658,659,660,662,665,666,668,669,672,676,679,681,682,683,684,685,686,687,689,690,692,697,698,700,701,702,703,705,706,710,711,712,714,716,718,720,723,724,725,726,727,728,731,733,734,735,736,737,738,740,741,742,746,748,750,751,752,754,755,756,757,758,760,761,762,763,764,765,767,768,769,770,771,772,773,774,775,776,780,781,782,783,784,785,786,787,788,789,790,791,792,800,804,806,807,808,810,811,814,815,820,822,823,824,827,828,829,830,831,832,833,835,837,841,842,843,844,846,847,848,849,850,851,852,854,857,859,860,861,863,864,865,866,867,870,873,874,875,876,879,880,882,883,884,885,888,889,891,893,898,899,902,904,906,907,908,912,913,914,916,917,919,921,923,924,926,929,931,932,934,936,937,938,939,940,942,943,949,953,955,956,957,959,960,961,963,965,966,967,968,969,970,971,972,973,974,975,976,977,978,981,982,983,984,986,987,988,991,994,996,999,1003,1004,1005,1007,1008,1009,1012,1015,1021,1022,1023,1025,1026,1027,1028,1029,1030,1033,1035,1036,1038,1040,1041,1042,1043,1044,1045,1046,1047,1049,1050,1051,1052,1054,1055,1056,1058,1059,1060,1063,1064,1065,1067,1069,1070,1073,1075,1081,1082,1083,1084,1086,1088,1091,1093,1095,1096,1097,1098,1099,1101,1102,1106,1109,1111,1114,1115,1117,1118,1119,1121,1123,1130,1131,1132,1134,1135,1138,1140,1141,1142,1146,1147,1148,1151,1152,1153,1154,1157,1158,1159,1161,1162,1164,1168,1171,1174,1176,1177,1179,1181,1182,1183,1184,1185,1186,1194,1195,1196,1197,1199,1200,1204,1205,1207,1209,1213,1221,1225,1228,1229,1230,1232,1234,1237,1239,1242,1247,1248,1249,1250,1251,1252,1254,1255,1256,1259,1260,1262,1263,1271,1274,1275,1277,1279,1281,1282,1283,1284,1285,1287,1288,1289,1290,1295,1296,1298,1301,1306,1311,1312,1314,1315,1316,1317,1319,1321,1322,1323,1325,1328,1330,1331,1333,1335,1337,1338,1339,1340,1341,1342,1343,1344,1345,1346,1347,1348,1349,1350,1351,1352,1353,1355,1356,1358,1360,1361,1362,1363,1364,1365,1367,1368,1369,1370,1373,1374,1375,1376,1378,1379,1381,1382,1383,1385,1388,1390,1391,1393,1394,1395,1396,1397,1398,1400,1401,1402,1403,1407,1408,1409,1411,1412,1413,1415,1417,1418,1419,1420,1423,1424,1426,1427,1428,1432,1433,1435,1436,1438,1440,1441,1443,1444,1445,1446,1449,1450,1451,1452,1453,1454,1455,1456,1457,1458,1460,1461,1463,1465,1466,1468,1470,1471,1472,1473,1474,1475,1476,1479,1481,1482,1484,1485,1486,1487,1489,1492,1493,1494,1495,1496,1497,1498,1499,1500,1501,1502,1503,1505,1506,1507,1508,1509,1510,1515,1517,1518,1520,1521,1522,1523,1524,1526,1528,1532,1533,1535,1537,1538,1541,1542,1544,1545,1546,1547,1550,1551,1553,1556,1557,1558,1560,1561,1563,1565,1566,1567,1568,1569,1571,1573,1575,1576,1578,1580,1582,1583,1584,1585,1586,1587,1588,1589,1592,1593,1598,1599,1600,1602,1603,1604,1605,1606,1608,1610,1611,1612,1613,1616,1617,1619,1622,1624,1626,1627,1628,1629,1630,1632,1633,1634,1635,1638,1639,1642,1643,1646,1648,1649,1651,1652,1653,1655,1657,1659,1660,1661,1663,1664,1665,1667,1668,1670,1671,1673,1674,1678,1680,1681,1682,1684,1685,1686,1692,1693,1694,1695,1696,1697,1698,1702,1705,1706,1709,1710,1711,1712,1713,1714,1716,1717,1718,1720,1723,1724,1725,1727,1728,1729,1730,1731,1735,1737,1740,1742,1743,1744,1745,1747,1748,1752,1757,1758,1759,1760,1762,1763,1766,1767,1770,1771,1774,1775,1777,1778,1781,1782,1785,1792,1795,1796,1798,1799,1802,1803,1804,1806,1808,1809,1810,1812,1813,1814,1815,1817,1818,1820,1821,1822,1823,1827,1828,1830,1831,1834,1835,1836,1840,1841,1843,1845,1846,1847,1849,1850,1852,1854,1855,1856,1857,1859,1860,1861,1862,1864,1866,1867,1869,1870,1872,1873,1874,1876,1877,1878,1881,1882,1888,1889,1890,1892,1893,1894,1895,1897,1899,1900,1901,1902,1903,1904,1906,1907,1908,1909,1910,1912,1914,1916,1920,1921,1922,1923,1924,1925,1928,1930,1932,1934,1935,1936,1937,1938,1941,1943,1944,1945,1946,1947,1948,1950,1951,1952,1954,1955,1957,1958,1960,1961,1964,1965,1966,1968,1970,1977,1978,1979,1980,1984,1985,1986,1987,1988,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999,2001,2002,2003,2005,2008,2011,2013,2014,2016,2020,2021,2022,2023,2025,2026,2027,2029,2032,2033,2034,2037,2038,2039,2042,2046,2048,2049,2050,2052,2053,2054,2056,2058,2059,2062,2063,2064,2068,2069,2070,2071,2072,2074,2075,2076,2078,2079,2081,2082,2083,2086,2089,2090,2091,2092,2093,2094,2096,2098,2100,2101,2102,2104,2105,2107,2108,2109,2112,2113,2117,2118,2119,2123,2125,2127,2128,2129,2131,2135,2139,2140,2141,2142,2143,2144,2145,2146,2147,2149,2151,2153,2156,2157,2159,2160,2161,2166,2167,2169,2171,2172,2174,2175,2176,2177,2178,2180,2181,2182,2183,2184,2185,2186,2187,2189,2190,2191,2192,2193,2194]);
export const ENGLISH_SHARED=Object.freeze(['mcp-data/text/tzidkat-hatzadik.json','mcp-data/catalog.json',
  'library/data/files.json','library/index.html','library/sw.js','library/downloads/index.json',
  'library/downloads/books/tzidkat-hatzadik.zip','library/downloads/rav-tzadok-library.zip',
  'library/data/tzidkat-hatzadik/links.json','mcp-data/cited.json','library/data/cited/shabbat.json','library/data/packs/sources.json']);
export const ENGLISH_SCOPE_CORRECTIONS=Object.freeze([{number:166,oldRef:'Shabbat 118b:14',
  ref:'Shabbat 118b:14-119a:1',url:'https://www.sefaria.org/Shabbat_118b:14-119a:1',
  heSha256:'f3d3860ba1c36c21d6f5f3fa104c7075bd2ccf7f7fd4dac99cd5d8551d630dd1',
  proposalSha256:'b9f63c51ee6c260a5fb47f5ce4427fb9afb4443f8f7e64cfc216d390bb2d1b95',
  reason:'Append only the opening sentence of119a:1 to complete Abaye’s statement; all later statements are excluded.'}]);
const FINAL_REPORT='library/tzidkat-batch-review-256-264-20261025.json';
const FINAL_REPORT_SHA='742cf6899188bb20080fadfda85bee0ca9f732049e38bb49c318d1cdb507db40';
const FINAL_PACK_SHA='3bc345df5b4c9c9060fab8265de26f9692b0b618580521d3cabdec9103691c61';
const SOURCE_DESCRIPTOR='sources/akiva/addenda/tzidkat-source-addition-006-transition-20261025.json';
const SOURCE_DESCRIPTOR_SHA='4e142189d24ab4996c4919d05605917f74e6a24f4a66a5d21c1af9fe6aa06971';
const SOURCE_PACK_SHA='fc36a8651acc353525bc896391a6fce30b87ae9c7aeca59bee3a4135e2d0b8f5';
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const onlyInfo=value=>({bytes:value.bytes,sha256:value.sha256});
const heLetters=value=>String(value).replace(/[^א-ת]/g,'');
const jsonInfo=value=>({bytes:Buffer.byteLength(JSON.stringify(value)),sha256:digest(value)});
const ORIGINAL_PROVENANCE='Akiva Publishing · Original English translation prepared directly from the selected Hebrew or Aramaic and independently reviewed. Underlying Hebrew-edition metadata is recorded separately.';
const TRANSLATION_METHOD='Fresh English translation prepared from the verified selected Hebrew or Aramaic; prior English was excluded from the translator input and the complete translation was independently reviewed.';
export const ENGLISH_COUNTS=Object.freeze({nativeNotes:3684,connectedNotes:347,totalPublicNotes:4031,replacedNativeNotes:1369,
  originalNativeNotesAfter:3644,permittedRetainedNativeNotes:40,unresolvedNativeNotesAfter:0});
function local(directory,name){
  assert(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'));
  const base=path.resolve(directory),file=path.resolve(base,name);assert(file.startsWith(base+path.sep));return file;
}
function validInfo(value){assert(Number.isSafeInteger(value?.bytes)&&value.bytes>=0);assert.match(value.sha256,/^[a-f0-9]{64}$/);}
function pinnedJson(repo,name,gzip=false){
  const raw=fs.readFileSync(local(repo,name)),pin=fs.readFileSync(local(repo,name+'.sha256'),'utf8').trim();
  assert.match(pin,/^[a-f0-9]{64}$/);assert.equal(sha(raw),pin,'Pinned English replacement artifact changed');
  return {value:JSON.parse(gzip?gunzipSync(raw):raw),sha256:pin,bytes:raw.length};
}

// Construct every permitted field change rather than accepting arbitrary
// after-note objects merely because their caller supplies a hash.
export function constructEnglishAfterNote(before,translation){
  assert(ENGLISH_NUMBERS.includes(before.number),'Note is outside the exact1369-number authorization');
  assert.equal(before.sources.length,1);const source=before.sources[0];
  const correction=ENGLISH_SCOPE_CORRECTIONS.find(c=>c.number===before.number);
  if(correction){
    assert.equal(source.ref,correction.oldRef);assert.equal(translation.sourceRef,correction.ref);
    assert.equal(translation.sourceUrl,correction.url);assert.equal(translation.primaryHebrewSha256,correction.heSha256);
    assert.equal(translation.scopeCorrectionProposalSha256,correction.proposalSha256);
  }else{assert.equal(translation.sourceRef,source.ref);assert.equal(translation.sourceUrl,source.url);}
  assert(typeof translation.primaryHebrew==='string'&&/[א-ת]/.test(translation.primaryHebrew));
  assert(typeof translation.english==='string'&&translation.english.trim()===translation.english&&translation.english.length>=5);
  assert.equal(translation.primaryHebrewSha256,sha(translation.primaryHebrew));assert.equal(translation.englishSha256,sha(translation.english));
  assert.equal(translation.review?.status,'verified');
  for(const key of ['directFromHebrew','priorEnglishExcludedFromTranslatorInput','completeSelectedUnit','independentBilingualReview'])assert.equal(translation.review[key],true);
  assert(typeof translation.review.translator==='string'&&translation.review.translator.trim());
  assert(typeof translation.review.independentReviewer==='string'&&translation.review.independentReviewer.trim());
  assert.notEqual(translation.review.translator,translation.review.independentReviewer);
  assert(Array.isArray(translation.sourceEvidence)&&translation.sourceEvidence.length);
  assert(translation.sourceEvidence.every(e=>e.status==='verified'&&typeof e.ref==='string'&&typeof e.url==='string'&&typeof e.he==='string'));
  assert.equal(heLetters(translation.sourceEvidence.map(e=>e.he).join(' ')),heLetters(translation.primaryHebrew),'Evidence does not cover the selected Hebrew');
  const expected=structuredClone(before),p=expected.paragraphs[0];
  assert.equal(p.rich.length,2);assert.equal(p.rich[0].text,source.ref);assert.equal(p.rich[0].href,source.url);
  assert.equal(p.rich.map(r=>r.text).join(''),p.text);
  const tail=p.rich[1].text,match=/^(:\s*[“‘"])([\s\S]+)([”’"])$/.exec(tail);assert(match,'Unrecognized exact quotation boundary');
  // A fresh translation of a short formula can legitimately match earlier words.
  // Originality is evidenced by the Hebrew-only process and independent review.
  p.rich[1].text=match[1]+translation.english+match[3];
  if(correction){expected.sources[0].ref=correction.ref;expected.sources[0].url=correction.url;
    assert(!Object.hasOwn(expected.sources[0],'connectionsUrl'),'Unexpected scope-correction connection URL');
    p.rich[0].text=correction.ref;p.rich[0].href=correction.url;}
  p.text=p.rich.map(r=>r.text).join('');
  for(const extra of expected.paragraphs.slice(1))assert(extra.text.startsWith('Context:'),'Unreviewed extra paragraph');
  assert(!Object.hasOwn(before,'reviewedSourceExcerpt'),'Unexpected existing reviewed excerpt');
  expected.provenance.originalEnglishTranslation=true;
  expected.provenance.sourceQuotationRelease={release:ENGLISH_RELEASE,sourceRef:translation.sourceRef,sourceURL:translation.sourceUrl,
    versionTitle:'Akiva Publishing original English translation',license:'© Akiva Publishing',originalEnglishTranslation:true,
    primaryHebrewSha256:translation.primaryHebrewSha256,translationSha256:translation.englishSha256,
    sourceUnitId:translation.sourceUnitId,method:TRANSLATION_METHOD};
  if(translation.primaryHebrewEdition){
    assert(Object.keys(translation.primaryHebrewEdition).every(k=>['versionTitle','versionSource','license','sourceRef','sourceURL'].includes(k)),'Unexpected Hebrew-edition metadata field');
    assert(Object.values(translation.primaryHebrewEdition).every(v=>typeof v==='string'));
    expected.provenance.sourceQuotationRelease.primaryHebrewEdition=structuredClone(translation.primaryHebrewEdition);
  }
  if(expected.sourceExcerptReview){
    assert(Array.isArray(expected.sourceExcerptReview.evidence));
    for(const [index,e] of expected.sourceExcerptReview.evidence.entries()){
      if(heLetters(e.he)===heLetters(translation.primaryHebrew)){
        e.en=translation.english;if(Object.hasOwn(e,'readerQuotation'))e.readerQuotation=p.text;
        e.translation='Original English translation prepared directly from the cited Hebrew/Aramaic and independently reviewed for this replacement.';
      }else if(before.number===1036&&index===1){
        assert.equal(e.ref,'Eruvin 100b:29');assert.equal(e.translation,'Original English translation from the cited Hebrew.');
        // Separate, already original contextual evidence is outside the replaced Job verse.
      }else{
        for(const key of ['en','readerQuotation','translation'])delete e[key];
        e.englishQuotationSupersededBy={release:ENGLISH_RELEASE,field:'sourceExcerptReview.originalEnglishReplacement',
          reason:'The preserved Hebrew evidence has a partial or distinct scope; the complete reviewed new English is stored only with its matching complete Hebrew selection.'};
      }
    }
  }
  expected.sourceExcerptReview??={schemaVersion:1,reviewedAt:'2026-10-25',status:'source-quotation-context-and-anchor-reviewed',evidence:[]};
  expected.sourceExcerptReview.originalEnglishReplacement={schemaVersion:1,release:ENGLISH_RELEASE,
    ref:translation.sourceRef,selectedSourceRef:translation.selectedSourceRef||translation.sourceRef,
    he:translation.primaryHebrew,en:translation.english,readerQuotation:p.text,provenance:ORIGINAL_PROVENANCE,
    primaryHebrewSha256:translation.primaryHebrewSha256,translationSha256:translation.englishSha256,sourceUnitId:translation.sourceUnitId};
  return expected;
}

export function validateEnglishApproval(approval){
  assert.equal(approval.schemaVersion,1);assert.equal(approval.status,'verified');assert.equal(approval.release,ENGLISH_RELEASE);
  assert.equal(approval.scope,'only-1369-authorized-NC-or-unresolved-source-English-quotations');assert.equal(approval.inventorySha256,ENGLISH_INVENTORY_SHA);
  assert.deepEqual(approval.allowedNumbers,ENGLISH_NUMBERS);assert.deepEqual(approval.records.map(r=>r.number).sort((a,b)=>a-b),ENGLISH_NUMBERS);
  assert.deepEqual(approval.counts,ENGLISH_COUNTS);
  assert(Array.isArray(approval.reviewEvidence)&&approval.reviewEvidence.length,'Independent review evidence pins are required');
  const evidencePaths=new Set();
  for(const pin of approval.reviewEvidence){assert(pin.path.startsWith('sources/akiva/addenda/evidence/'));validInfo(pin);assert(!evidencePaths.has(pin.path));evidencePaths.add(pin.path);}
  for(const item of approval.records){
    const reviewPin=item.review?.evidence;assert(reviewPin&&evidencePaths.has(reviewPin.path),'Note lacks its exact independent review artifact');
    assert.deepEqual(reviewPin,approval.reviewEvidence.find(p=>p.path===reviewPin.path));
    assert.equal(item.beforeNote.number,item.number);assert.equal(item.afterNote.number,item.number);
    assert.equal(item.beforeNoteSha256,digest(item.beforeNote));assert.equal(item.afterNoteSha256,digest(item.afterNote));
    assert(Number.isSafeInteger(item.ois)&&item.ois>=1&&item.ois<=264);
    assert.equal(item.chapterPath,`library/data/tzidkat-hatzadik/${item.ois-1}.json`);
    assert(Number.isSafeInteger(item.rowIndex)&&item.rowIndex>=0&&Number.isSafeInteger(item.noteIndex)&&item.noteIndex>=0);
    assert.deepEqual(item.afterNote,constructEnglishAfterNote(item.beforeNote,item),'Unauthorized note change: '+item.number);
  }
  return approval;
}
export function validateEnglishPack(pack){
  assert.equal(pack.schemaVersion,1);assert.equal(pack.release,ENGLISH_RELEASE);validateEnglishApproval(pack.approval);
  assert.equal(pack.chapters.length,256);assert.equal(new Set(pack.chapters.map(f=>f.path)).size,256);
  const expectedPaths=[...new Set(pack.approval.records.map(r=>r.chapterPath))].sort();
  assert.deepEqual(pack.chapters.map(f=>f.path).sort(),expectedPaths);assert(expectedPaths.includes(SOURCE_CHAPTER));
  for(const file of pack.chapters){
    assert.equal(file.beforeSha256,digest(file.before));assert.equal(file.afterSha256,digest(file.after));
    const expected=structuredClone(file.before),records=pack.approval.records.filter(r=>r.chapterPath===file.path);
    for(const item of records){assert.deepEqual(expected[item.rowIndex]?.footnotes?.[item.noteIndex],item.beforeNote);expected[item.rowIndex].footnotes[item.noteIndex]=item.afterNote;}
    assert.deepEqual(file.after,expected,'Chapter changed beyond the exact approved source-English fields');
  }
  assert.deepEqual(pack.predecessor,{finalReport:FINAL_REPORT,finalReportSha256:FINAL_REPORT_SHA,finalPackSha256:FINAL_PACK_SHA,
    sourceDescriptor:SOURCE_DESCRIPTOR,sourceDescriptorSha256:SOURCE_DESCRIPTOR_SHA,sourcePackSha256:SOURCE_PACK_SHA});
  assert.deepEqual(Object.keys(pack.linksBefore),['Tzidkat HaTzadik 49']);
  const edges=structuredClone(pack.linksBefore['Tzidkat HaTzadik 49']),ref=ENGLISH_SCOPE_CORRECTIONS[0].ref;
  assert(!edges.some(e=>e.a==='Tzidkat HaTzadik 49:1'&&e.r===ref));
  edges.push({a:'Tzidkat HaTzadik 49:1',r:ref,c:'Talmud',kind:'Verified complete original-source quotation'});
  assert.deepEqual(pack.linksAfter,{'Tzidkat HaTzadik 49':edges});
  return pack;
}
export function loadEnglishReplacement(repo=REPO,{requireDescriptor=true}={}){
  if(!fs.existsSync(local(repo,ENGLISH_PACK)))return null;
  const prepared=pinnedJson(repo,ENGLISH_PACK,true),pack=validateEnglishPack(prepared.value);
  const approval=pinnedJson(repo,ENGLISH_APPROVAL);assert.deepEqual(pack.approval,approval.value);
  for(const item of approval.value.reviewEvidence||[]){assert(item.path.startsWith('sources/akiva/addenda/evidence/'));validInfo(item);assert.deepEqual(sourceFileInfo(local(repo,item.path)),onlyInfo(item),'Independent translation evidence changed');}
  const source=loadSourceAddition(repo);assert(source);assert.equal(source.packSha256,SOURCE_PACK_SHA);
  const chapter=pack.chapters.find(f=>f.path===SOURCE_CHAPTER);assert.deepEqual(chapter.before,source.pack.chapters[0].after,'English predecessor must contain exact4031');
  const preserved4031=chapter.after.flatMap(r=>r.footnotes||[]).filter(n=>n.number===4031);
  assert.deepEqual(preserved4031,[source.pack.additions[0].note],'Frozen Tosafot4031 changed');
  const result={pack,packSha256:prepared.sha256,approvalSha256:approval.sha256};if(!requireDescriptor)return result;
  const sealed=pinnedJson(repo,ENGLISH_DESCRIPTOR),descriptor=sealed.value;
  assert.equal(descriptor.schemaVersion,1);assert.equal(descriptor.release,ENGLISH_RELEASE);
  assert.equal(descriptor.packSha256,result.packSha256);assert.equal(descriptor.approvalSha256,result.approvalSha256);
  assert.deepEqual(descriptor.predecessor,pack.predecessor);
  const pri=loadPriParsha({requireDescriptor:true,repo}),prior=descriptor.interveningPublication;
  assert(prior,'English replacement must preserve the intervening published Pri review');
  assert.deepEqual(prior.descriptor,{path:PRI_DESCRIPTOR,...sourceFileInfo(local(repo,PRI_DESCRIPTOR))});
  assert.equal(prior.packSha256,pri.packSha256);assert.equal(prior.baselineInventorySha256,pri.descriptor.baselineInventorySha256);
  assert.equal(prior.report.path,PRI_REPORT);validInfo(prior.report);
  assert.deepEqual(descriptor.files.map(f=>f.path).sort(),[...pack.chapters.map(f=>f.path),...ENGLISH_SHARED].sort(),'English transition claims another public path');
  for(const f of descriptor.files){validInfo(f.before);validInfo(f.after);assert.notEqual(f.before.sha256,f.after.sha256);}
  for(const file of pack.chapters){const d=descriptor.files.find(f=>f.path===file.path);assert.deepEqual(d.before,jsonInfo(file.before));assert.deepEqual(d.after,jsonInfo(file.after));}
  return {...result,descriptor,descriptorSha256:sealed.sha256};
}
function stateOf(directory,prepared){
  const state=prepared.pack.chapters.map(f=>{const actual=sourceFileInfo(local(directory,f.path));
    return actual.sha256===jsonInfo(f.before).sha256?'before':actual.sha256===jsonInfo(f.after).sha256?'after':'unknown';});
  assert(state.every(s=>s===state[0])&&state[0]!=='unknown','Partial or unapproved English replacement chapter state');return state[0];
}

// The old source phase still validates its exact preimage/after-note. When the
// new English state is present, give that frozen validator a tiny authenticated
// predecessor view, then validate the actual complete English successor below.
export function prepareEnglishReplacementChain(args){
  const repo=args.repo||REPO,prepared=loadEnglishReplacement(repo);
  if(!prepared){const sourcePublication=prepareSourceAdditionTransition(args),parshaPublication=preparePriParshaTransition(args);
    return {sourcePublication,parshaPublication,englishPublication:null,englishPrepared:null};}
  const state=stateOf(args.directory,prepared);let sourcePublication;
  if(state==='before')sourcePublication=prepareSourceAdditionTransition(args);
  else{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tzidkat-authenticated-predecessor-'));
    try{
      const chapter=prepared.pack.chapters.find(f=>f.path===SOURCE_CHAPTER);
      for(const [name,raw] of [[SOURCE_CHAPTER,Buffer.from(JSON.stringify(chapter.before))],[FINAL_REPORT,fs.readFileSync(local(args.directory,FINAL_REPORT))]]){
        const target=local(temp,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,raw);}
      sourcePublication=prepareSourceAdditionTransition({...args,directory:temp});
    }finally{fs.rmSync(temp,{recursive:true,force:true});}
  }
  assert(sourcePublication,'English replacement must follow exact4031');
  const successorFiles=state==='after'?new Map(prepared.descriptor.files.map(f=>[f.path,f.after])):null;
  if(successorFiles&&args.downloadPrepared){const files=args.downloadPrepared.descriptor.files;
    if(files.every(f=>fs.existsSync(local(args.directory,f.path))&&digest(sourceFileInfo(local(args.directory,f.path)))===digest(f.after)))
      for(const f of files)successorFiles.set(f.path,f.after);}
  const parshaPublication=preparePriParshaTransition({...args,successorFiles});assert(parshaPublication,'Published Pri review must remain in the chain');
  assert.deepEqual(sourceFileInfo(local(args.directory,PRI_REPORT)),onlyInfo(prepared.descriptor.interveningPublication.report),'Published Pri report changed');
  const englishPublication=state==='after'?prepareEnglishReplacementTransition({...args,sourcePublication,parshaPublication,prepared}):null;
  return {sourcePublication,parshaPublication,englishPublication,englishPrepared:{...prepared,state}};
}
export function prepareEnglishReplacementTransition({directory,batches,terminalFiles,independentFiles,sourcePublication,parshaPublication,prepared,repo=REPO}){
  prepared??=loadEnglishReplacement(repo);assert(prepared);assert.equal(stateOf(directory,prepared),'after');
  const {pack,descriptor}=prepared;
  assert(parshaPublication);assert.equal(descriptor.interveningPublication.descriptor.sha256,parshaPublication.descriptorSha256);
  assert.equal(sourcePublication.descriptorSha256,SOURCE_DESCRIPTOR_SHA);assert.equal(sourcePublication.packSha256,SOURCE_PACK_SHA);
  assert.equal(batches.length,18);assert.equal(batches.at(-1).prepared.packSha256,FINAL_PACK_SHA);
  assert.equal(sourceFileInfo(local(directory,FINAL_REPORT)).sha256,FINAL_REPORT_SHA);
  for(const file of pack.chapters){
    const previous=file.path===SOURCE_CHAPTER?sourcePublication.pack.chapters[0]:batches.flatMap(b=>b.prepared.pack.chapters).find(f=>f.path===file.path);
    assert(previous);assert.deepEqual(previous.after,file.before,'English replacement does not follow the exact reviewed chapter');
  }
  const priorLinks=batches.flatMap(b=>b.report.linkChanges).find(c=>c.sectionRef==='Tzidkat HaTzadik 49');assert(priorLinks);
  assert.deepEqual(priorLinks.after,pack.linksBefore['Tzidkat HaTzadik 49'],'Refinement has an unrecognized source-link preimage');
  for(const f of descriptor.files){const prior=terminalFiles.get(f.path)||batches.at(-1).report.baselineFiles[f.path];
    assert.deepEqual(onlyInfo(prior),f.before,'Unknown English file preimage: '+f.path);terminalFiles.set(f.path,{path:f.path,...f.after});independentFiles.set(f.path,f.after);}
  return {...prepared,chapterAfters:new Map(pack.chapters.map(f=>[f.path,f.after])),
    chapterPreimages:new Map(descriptor.files.filter(f=>pack.chapters.some(c=>c.path===f.path)).map(f=>[f.path,f.before])),
    linkAfters:new Map(Object.entries(pack.linksAfter)),proof:{release:ENGLISH_RELEASE,packSha256:prepared.packSha256,
      descriptorSha256:prepared.descriptorSha256,approvedEnglishReplacements:1369,allOtherNativeNotesUnchanged:true,
      connectedNotesUnchanged:347,allAuthorTextAndAnchorsUnchanged:true,note4031Unchanged:true,historicalReportsUnchanged:true,
      exactSourceScopeRefinement:ENGLISH_SCOPE_CORRECTIONS}};
}
export function verifyEnglishReplacementTerminal({directory,englishPublication,terminalFiles}){
  if(!englishPublication)return;
  for(const f of englishPublication.descriptor.files)assert.deepEqual(sourceFileInfo(local(directory,f.path)),onlyInfo(terminalFiles.get(f.path)),'English terminal differs: '+f.path);
  const mcp=JSON.parse(fs.readFileSync(local(directory,'mcp-data/text/tzidkat-hatzadik.json')));
  for(const item of englishPublication.pack.approval.records){
    const matches=mcp.paras.flatMap(p=>(p.f||[]).filter(n=>String(n[0])===String(item.number)).map(note=>({p,note})));
    assert.equal(matches.length,1);assert.equal(matches[0].note[1],item.afterNote.paragraphs.map(p=>p.text).join('\n'));
    assert.equal(matches[0].note[2],item.afterNote.phraseIndex);
    // Reconstruct the exact authenticated MCP predecessor below. Its older
    // English-side anchor tuples must remain as published, including offsets.
    matches[0].note[1]=item.beforeNote.paragraphs.map(p=>p.text).join('\n');
  }
  const links=JSON.parse(fs.readFileSync(local(directory,'library/data/tzidkat-hatzadik/links.json')));
  assert.deepEqual(links['Tzidkat HaTzadik 49'],englishPublication.pack.linksAfter['Tzidkat HaTzadik 49']);
  const ref=ENGLISH_SCOPE_CORRECTIONS[0].ref,origin='Tzidkat HaTzadik 49:1',row=mcp.paras.find(p=>p.r===origin);assert(row);
  assert.deepEqual(row.a[ref],['n','166']);assert(row.c.some(e=>e[0]===ref));
  assert.deepEqual(row.c.at(-1),[ref,'Talmud']);assert.equal(row.c.filter(e=>e[0]===ref).length,1);
  delete row.a[ref];row.c.pop();
  const mcpBefore=englishPublication.descriptor.files.find(f=>f.path==='mcp-data/text/tzidkat-hatzadik.json').before;
  assert.deepEqual(jsonInfo(mcp),mcpBefore,'MCP changed beyond the exact approved English strings and166 citation addition');
  for(const name of ['mcp-data/cited.json','library/data/cited/shabbat.json'])assert(JSON.parse(fs.readFileSync(local(directory,name)))[ref]?.includes(origin));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,input,output]=process.argv.slice(2);
  if(mode==='--construct'){
    const value=JSON.parse(fs.readFileSync(input));
    for(const r of value.records){r.afterNote=constructEnglishAfterNote(r.beforeNote,r);r.afterNoteSha256=digest(r.afterNote);}
    validateEnglishApproval(value);fs.writeFileSync(output,JSON.stringify(value));console.log(JSON.stringify({ok:true,records:value.records.length,sha256:digest(value)}));
  }else if(mode==='--validate-pack'){
    const value=JSON.parse(gunzipSync(fs.readFileSync(input)));validateEnglishPack(value);console.log(JSON.stringify({ok:true,chapters:value.chapters.length,records:value.approval.records.length}));
  }else if(mode==='--validate'){const value=loadEnglishReplacement(input||REPO);assert(value);console.log(JSON.stringify({ok:true,packSha256:value.packSha256,descriptorSha256:value.descriptorSha256}));}
  else throw Error('Use --construct, --validate-pack, or --validate');
}
