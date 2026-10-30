# Takanas HaShavin — 29 October 2026 native Reader reconciliation

**Not for production merge until the native note-level review is complete.** The final source-collation JSON was validated against an older inline-footnote representation, not the live, later native-footnote Reader. The scoped Pages workflow correctly failed before deployment, on a source/live segmentation mismatch.

## Reproduced mismatch from workflow 40988765804

- 161 matching paragraphs inspected across Simanim 1–9; all 161 have source/live text differences.
- 33 paragraphs have different interlinear phrase counts; 0 of those 33 had matching full text.
- Siman 8 contains a native Reader paragraph 8 missing from the candidate.
- Native Reader notes are `row.footnotes[]`; candidate notes are embedded in `<sup class="footnote-marker">…</sup><i class="footnote">…</i>`.
- Do not suppress the merge assertions or replace the live chapters wholesale.

## Audited native-note identity inventory

29 historical footnote identities were reviewed against the saved native Reader ZIP; four IDs were absent from that specific edition: **2:75**, **2:93**, **3:125**, **5:249**. Absence is not evidence they should be created: these need reconciliation against editorial decisions and other surviving notes. Some staged relocations already exist natively (4:222; 5:231–232; 6:984/987; 9:1224 split into two child notes).

## Precisely stageable native repairs

Only these seven text/citation/transmission changes were mechanically tested with old-text-unique and rich/text-preservation checks; they are **not yet deployed**:

| Note | Original | Corrected |
|---|---|---|
| 3:134 | Dover Tzedek, Likutim §1 | Dover Tzedek, Likutim I §11 |
| 3:165 | Ohr Zarua LaTzadik §7 | Ohr Zarua LaTzadik, Large Beis and Small Beis §2 |
| 3:180 | Poked Akarim §2 | Poked Akarim 2:7 |
| 3:184 | Dover Tzedek, Likutim §4 | Dover Tzedek, Likutim IV §120 |
| 3:194 | Peri Tzadik, Shemos §7 | Pri Tzaddik, Kedushas Shabbos 7:1 |
| 4:220 | Peri Tzadik, Vayakhel §1 | Pri Tzaddik, Kuntres Shevisas Shabbos 1:5 |
| 6:357 | R’ Shmuel bar Nachmani said: | R’ Shmuel bar Nachmani said in the name of R’ Yonatan: |

For notes 3:194 and 4:220, the obsolete hyperlinks point to the wrong works. The staged preview **de-links** those references, without fabricating replacement Sefaria URLs. No Hebrew, English, paragraph count, phrase segmentation, native placement, or other note is changed in the preview.

## Remaining review and release gate

- Reconcile the 22 other audited historical IDs, distinguishing already-applied corrections from actual omissions and from notes that were renamed or split. Review note 1:7/14 placement and note 2:108, 3:124, 3:128 quote attribution.
- Maintain the existing 10–13 revised native sections, 14–15 published sections, and entire other-book inventory.
- Rebuild and verify the live data index, citation reverse index, connected-ideas catalog, service worker, and both Reader ZIPs from one complete verified site artifact.
- Only then permit the scoped GitHub Pages deployment with both pre-publish and after-publish readback checks.
- 186 original-source clustered-marker locations remain a separate substantive scholarly audit, **not** a reason to automatically merge notes.

Related CI proof: https://github.com/akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok/actions/runs/40988765804

This branch documents the incompatibility; it is intentionally separate from production.
