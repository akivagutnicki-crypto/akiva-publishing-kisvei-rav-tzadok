/* Reviewed conceptual connections, anchored to actual library passages. */
(function (root, factory) {
  const sources = typeof module === 'object' && module.exports ? require('./source-connections.js') : root.AkivaSourceConnections;
  const api = factory(sources);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AkivaConnectedIdeas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (sources) {
  'use strict';
  const VERSION = '20261019-connected-ideas-v1';
  const SCHOOLS = ['Kisvei Rav Tzadok', 'Ishbitz–Radzin'];
  const normalized = sources.normalizedHebrew;
  const refKey = ref => sources.normalizeRef(ref || '').toLowerCase();
  const required = ['id','themeTitle','themeSummary','originRef','originHebrew','originEnglish','targetRef','targetHebrew','targetEnglish','school','explanation','translationProvenance'];
  function validRecord(record) {
    const reverseKeys=['reverseExplanation','reverseThemeTitle','reverseThemeSummary','reviewedTargetSectionHebrewSha256'];
    const hasReverse=record && reverseKeys.some(key=>Boolean(record[key]));
    return Boolean(record && record.reviewed === true && required.every(key => typeof record[key] === 'string' && record[key].trim())
      && SCHOOLS.includes(record.school) && record.originRef !== record.targetRef
      && /[א-ת]/.test(record.originHebrew) && /[א-ת]/.test(record.targetHebrew)
      && /[A-Za-z]/.test(record.originEnglish) && /[A-Za-z]/.test(record.targetEnglish)
      && record.placement && typeof record.placement.originSectionRef === 'string'
      && Number.isInteger(record.placement.originPhraseIndex) && record.placement.originPhraseIndex >= 0
      && Number.isInteger(record.placement.originPhraseEnd) && record.placement.originPhraseEnd >= record.placement.originPhraseIndex
      && typeof record.placement.targetSectionRef === 'string' && record.placement.targetSectionRef.trim()
      && Number.isInteger(record.placement.targetPhraseIndex) && record.placement.targetPhraseIndex >= 0
      && Number.isInteger(record.placement.targetPhraseEnd) && record.placement.targetPhraseEnd >= record.placement.targetPhraseIndex
      && (!hasReverse || (['reverseExplanation','reverseThemeTitle','reverseThemeSummary'].every(key=>typeof record[key] === 'string' && record[key].trim())
        && /^[a-f0-9]{64}$/.test(record.reviewedTargetSectionHebrewSha256 || ''))));
  }
  function orient(record, reverse = false) {
    if (!reverse) return {...record, direction:'forward', anchorRef:record.originRef,
      sectionRef:record.placement.originSectionRef, phraseIndex:record.placement.originPhraseIndex,
      phraseEnd:record.placement.originPhraseEnd, paragraphOrder:record.placement.originParagraphOrder};
    return {...record, direction:'reverse', id:record.id + '-reverse', originalId:record.id,
      originRef:record.targetRef, originHebrew:record.targetHebrew, originEnglish:record.targetEnglish,
      targetRef:record.originRef, targetHebrew:record.originHebrew, targetEnglish:record.originEnglish,
      themeTitle:record.reverseThemeTitle, themeSummary:record.reverseThemeSummary,
      school:record.placement.originSchool, explanation:record.reverseExplanation,
      anchorRef:record.targetRef, sectionRef:record.placement.targetSectionRef,
      phraseIndex:record.placement.targetPhraseIndex, phraseEnd:record.placement.targetPhraseEnd,
      paragraphOrder:record.placement.targetParagraphOrder};
  }
  function directed(records) {
    return (records || []).filter(validRecord).flatMap(record => [orient(record),
      ...(typeof record.reverseExplanation === 'string' && record.reverseExplanation.trim()
        && SCHOOLS.includes(record.placement.originSchool) ? [orient(record,true)] : [])]);
  }
  function unique(records) {
    const seen = new Set();
    return records.filter(record => {
      const key = refKey(record.originRef) + '\0' + refKey(record.targetRef);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a,b) => (a.paragraphOrder || 0) - (b.paragraphOrder || 0)
      || a.phraseIndex - b.phraseIndex || a.themeTitle.localeCompare(b.themeTitle)
      || SCHOOLS.indexOf(a.school) - SCHOOLS.indexOf(b.school) || a.id.localeCompare(b.id));
  }
  function forPassage(records, ref, context = {}) {
    const bounded=Number.isInteger(context.phraseIndex) && context.phraseIndex>=0;
    const end=bounded && Number.isInteger(context.phraseEnd)?Math.max(context.phraseIndex,context.phraseEnd):context.phraseIndex;
    return unique(directed(records).filter(record => refKey(record.originRef) === refKey(ref)
      && (!bounded || (end>=record.phraseIndex && context.phraseIndex<=(record.phraseEnd ?? record.phraseIndex)))));
  }
  function forSection(records, sectionRef) {
    return unique(directed(records).filter(record => refKey(record.sectionRef) === refKey(sectionRef)));
  }
  function groups(records) {
    const grouped = new Map();
    for (const record of records) {
      const key = record.originRef + '\0' + record.phraseIndex + '\0' + record.themeTitle;
      if (!grouped.has(key)) grouped.set(key,{key,id:record.id,title:record.themeTitle,summary:record.themeSummary,
        originRef:record.originRef,phraseIndex:record.phraseIndex,records:[]});
      grouped.get(key).records.push(record);
    }
    return [...grouped.values()];
  }
  function anchorMatches(record, hebrew) {
    const whole = normalized(hebrew || ''), quote = normalized(record.originHebrew || '');
    return Boolean(whole && quote && (' ' + whole + ' ').includes(' ' + quote + ' '));
  }
  function matchesContext(record,context) {
    const reverse=record.direction==='reverse';
    const paragraphPin=reverse?record.reviewedTargetHebrewSha256:record.reviewedOriginHebrewSha256;
    const sectionPin=reverse?record.reviewedTargetSectionHebrewSha256:record.reviewedOriginSectionHebrewSha256;
    return Boolean(context && refKey(record.originRef)===refKey(context.ref)
      && refKey(record.sectionRef || record.placement?.originSectionRef)===refKey(context.sectionRef)
      && /^[a-f0-9]{64}$/.test(paragraphPin || '') && /^[a-f0-9]{64}$/.test(sectionPin || '')
      && context.paragraphHebrewSha256===paragraphPin && context.sectionHebrewSha256===sectionPin);
  }
  return {VERSION,SCHOOLS,validRecord,forPassage,forSection,groups,anchorMatches,matchesContext};
});
