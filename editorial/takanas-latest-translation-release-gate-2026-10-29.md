# Takanas HaShavin: latest English translation is a mandatory publication gate

**Draft/review only — do not merge or deploy this editorial record by itself.**

User requirement: the current Reader must use the **latest verified revised English translation**, not merely retain the English in an older source or automatically preserve an outdated live rendering. The corrected English must be aligned to the precise Hebrew phrase, alongside the reviewed native footnotes.

## Comparison performed against uploaded source files

- Reviewed translation: `Takanas_Hashavin_Interlinear_Reviewed_v4.docx` (Part 1, through Siman 13).
- Saved native Reader source: `Takanas_HaShavin_Latest_Reader_Synchronized_2026-10-29.zip`.
- Across Introduction and Simanim 1–13, **243 Word bilingual paragraph units** align with **246 native Reader paragraphs**. Three Word units each combine two Reader paragraphs: Siman 7 §§5–6; Siman 8 §§6–7; Siman 12 §§6–7. The Hebrew consonant overlap for each combined group was greater than 97%. Therefore these three different paragraph counts are **not automatically evidence of missing material**.
- No paragraph units were left unmatched after recognizing those merges. This is a structural match, not proof that every Hebrew word is identical.
- All 243 aligned units have differing English wording after simple markup/whitespace normalization. **The comparison does not by itself establish which translation is the latest approved or better**; timestamps and a v4 label are inadequate.
- The saved native Reader contains native footnote objects and exact Hebrew phrase anchors; the previously staged full-source JSON contains inline footnote markers. Replacing native content wholesale is unsafe.
- Prior source-collation audit specifically proved that candidate English was unchanged outside footnotes; that proof **does not certify that the candidate contains the latest translation**.

## Do-not-merge conditions

1. Establish and document the authoritative latest English for each paragraph, considering reviewed v4, current saved Reader, and any subsequent corrections.
2. Verify all Hebrew passages and phrase-by-phrase English alignment; do not lose, duplicate or silently revert any passages.
3. Map and source-verify the full set of 29 reviewed footnote identities against native Reader; resolve the four historically absent note numbers without inventing entries; preserve source-rich runs and exact Hebrew anchors.
4. Keep Simanim 14–15 and unrelated sefarim untouched; update complete library indexes, citation links, site cache and *both* downloadable ZIPs only from a verified complete successor website.
5. Deploy only after the source, alignment, footnotes and preservation checks pass, and confirm exact changed bytes on the public GitHub Pages site.

The machine-readable comparative report and an offline side-by-side HTML were prepared in the ChatGPT conversation for local editorial reconciliation; this PR records the findings and constraints, not a publication approval.
