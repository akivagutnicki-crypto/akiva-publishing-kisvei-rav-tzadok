# Akiva reader release — 22 October 2026

Release: `20261022-reader-docx-import-v1`

This release places the three supplied manuscripts in their verified locations in the Akiva reader, supplies the remaining missing passages of Mei HaShiloach Volume I, and adds Sefaria hyperlinks and relevant source connections. Counts below describe the built release, including its separately attributed completion material.

## Source identification and placement

| Supplied source label | Verified contents and treatment |
| --- | --- |
| Mei HaShiloach, Part I, “the rest” | Contains Volume I material and genuine Volume II selections. Preserve both and place each passage under its actual canonical volume and reference. |
| Beit Yaakov, Vayishlach | The manuscript is **Vayeitzei**, represented by the canonical reference name `Vayetzei`. Add all 76 osiyos under Vayeitzei. |
| Beit Yaakov, Toldos | This is **Toldos**, represented by `Toldot`. It duplicates an earlier source and omits osiyos 15–19 that had already been recovered. Preserve the complete published sequence of **52 osiyos unchanged**. |

The manuscript filename is not treated as proof of its contents. Section headings, paragraph text, canonical references, and the existing reader determine placement. The supplied Mei Volume II passages remain Volume II; they are not relabeled as missing Volume I passages.

## Coverage

| Added material | Sections | Canonical paragraphs | Hebrew–English phrase pairs |
| --- | ---: | ---: | ---: |
| Beit Yaakov, Vayeitzei | 76 | 96 | 3,467 |
| Mei HaShiloach, supplied and completed material | 220 | 577 | 11,740 |
| **Total additions** | **296** | **673** | **15,207** |

These are addition counts, excluding retained reader material. Together with the **21 previously translated Mei sections**, the resulting Mei reader contains **241 sections and 755 paragraphs**. Volume I is complete against the verified canonical index and the supplied 2005 edition: **208 sections and 693 paragraphs**, including the compiler’s introduction. The main text from Bereshit through Miscellany accounts for 207 sections and 688 paragraphs.

The completion supplement restores **50 missing Volume I paragraphs across 36 sections**; a separate introduction supplement supplies **five paragraphs**. These newly translated passages have their own provenance and are excluded from claims about fidelity to the supplied English manuscript. Selected Volume II and Anthology material remains available; this release does not claim complete coverage of either.

The publisher preserves the original translated Mei sections and verifies **3,253 existing protected chapter/data files** against their baseline hashes. Toldos remains complete at 52 osiyos. The generated report records zero missing Hebrew phrases and zero missing English phrases within the imported material.

## Text preservation and connections

Every supplied sefer passage is accounted for in the source audits. Supplied Hebrew and English words are retained apart from explicitly audited editorial corrections and normalization. This includes the previously reviewed Hebrew repairs in Vayeitzei. English square brackets are removed while retaining the words inside them. Supplied headings, paragraph boundaries, and the two bilingual Torah colophons are accounted for; the verified colophons retain their canonical positions at V’Zot HaBerachah 17–18.

New completion translations use short interlinear phrase pairs, full nikkud, and context-reviewed abbreviation expansions. Their records retain the original Hebrew, normalized Hebrew, expansion or transformation details, and source-letter accounting. Added English translations of Hebrew-only manuscript headings are identified separately from supplied English body text. Edition variants are recorded rather than silently replaced.

The release contains **1,753 source hyperlink anchors**, **1,130 source connection edges**, and **93 scoped citation corrections**. Citation reviews check the cited work, passage, visible label, and relationship to the surrounding text. These figures count recorded anchors, edges, and corrections, rather than distinct source books or independent scholarly endorsements.

## Edition and review scope

The four supplied exports are **four formats of one edition**: *Mei HaShiloach, Publication of Sifrei Izhbitza Radzin, Bnei Brak 2005*. Their 1,469 nonempty Hebrew segments were compared across the formats. They are not evidence of four independent editions.

The earlier footnote work has separate provenance. The [Tzidkat source manifest](../../../sources/akiva/overlays/tzidkat-quoted-sources-20261022.json) records selected quotations checked against both volumes of Neimos HaTzedek and both volumes of Biur Meshulav. The [Shabbos source manifest](../../../sources/akiva/overlays/pri-shabbos-quoted-sources-20261021.json) records use of all four supplied PDFs; two contain Kedushas Shabbos alone, and two contain both Kedushas and Shevisas Shabbos. Those records support targeted use and cross-checking, not a complete independent reread of every printed footnote. The current Mei exports are separate evidence. This release combines source comparison, phrase accounting, targeted Hebrew/English review, and citation review; it does not claim exhaustive independent expert proofreading.

## Evidence guide

Paths below are relative to this README. The sealed release manifest supplies the authoritative file hashes; do not edit its evidence files without regenerating the release.

- [Release manifest](../../../sources/akiva/overlays/docx-import-20261022.json) and [generated publisher report](https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/reader-docx-import-20261022.json): pack identities, preservation hashes, placement, counts, anchors, and connections.
- [Mei supplied-text audit](../../mei-rest-document-audit-20261022.json), [Vayeitzei supplied-text audit](../../beit-vayetzei-document-audit-20261022.json), and [Toldos completeness audit](toldos-completeness.json): manuscript accounting, corrections, and retained coverage.
- [Canonical references](mei-canonical-references.json), [2005 edition comparison](mei-2005-edition-audit.json), and [original missing-passage ledger](mei-missing-volume-i.json): reference identities, order, edition differences, and the 50 main-text gaps.
- [Completion audit](mei-completion-audit.json), [completion language review](mei-completion-language-review.json), and [introduction audit](mei-introduction-audit.json): separately attributed new translations and Hebrew accounting. The `mei-supplement-*.json` files retain the phrase-level records.
- [Final citation review](citation-final-review.json) and [connected Torah source checks](connected-torah-source-checks.json): citation decisions and the recorded Sefaria, TorahLM, and Kisvei source checks.
