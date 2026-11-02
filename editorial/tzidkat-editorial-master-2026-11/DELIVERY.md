# Tzidkat HaTzadik — Complete Editorial Master (November 2026) — delivery

Everything here was generated from `Tzidkas_Complete_Editorial_Master_REVISED_2.docx` and verified
against the live Sefaria API and the Akiva reader library.

## 1. The edition in three formats (`edition/`)

| File | What it is |
|---|---|
| `tzidkat_hatzadik_editorial_master.json` | Full structured edition: 263 simanim (74 is absent in every printing), 511 paragraphs, 7,312 Hebrew–English phrase pairs, 47 editorial subheadings, 4,407 footnotes typed as `source` (3,221), `parallel` (329), `internal` (373), `see-note` (436), `source-external` (47), `see-siman` (1); every note anchored to its siman, paragraph, phrase and Hebrew word. |
| `tzidkat_hatzadik_phrases.csv` | One row per phrase: siman, title, paragraph, phrase index, Hebrew, English, note numbers, inline Sefaria refs, Sefaria and reader refs. |
| `tzidkat_hatzadik_footnotes.csv` | One row per footnote source: number, type, anchor, Hebrew phrase, headline, source kind/ref/canonical ref/school/url, quote, context, explanation, cross-references. |
| `tzidkat_hatzadik_editorial_master.txt` | Readable plain text of the whole edition with markers and notes per siman. |

## 2. The reader package (`reader-package/Tzidkat_HaTzadik.json`)

The canonical book file for the Akiva reader (`sources/akiva/Tzidkat_HaTzadik.json`), `editionId: tzidkat-editorial-master-2026-11`:
264 sections (siman 74 kept as the editorial placeholder), 512 paragraphs, the two preface lines as 1:1 and 1:2,
editorial subheadings and notes as heading rows, and all 4,407 notes embedded in the reviewed TZ-note schema:
`TZ-0001`…`TZ-4407` (identical to the Word numbering, so every "See note N" resolves), exact UTF-16 Hebrew anchors,
rich paragraphs with hyperlinks, canonical Sefaria `sources`, `nativeConnections` to library passages, `crossReference`
for see-notes, provenance and verification status.

## 3. Sefaria hyperlinks and connections (`connections/`, `verification/`)

- 3,147 distinct Sefaria references were sent to the Sefaria API; 3,142 resolved to a canonical ref, Hebrew text and URL
  (2 garbled chapter numbers were repaired from the displayed citation; 3 Zohar segment ranges fall outside Sefaria's
  segmentation and keep the editorial link, flagged `unverified`).
- Zohar citations given by daf (e.g. Zohar III 232a) are resolved to Sefaria's parashah passages through the Zohar "Daf"
  alternate structure (`engine/zohar_alt_structs.json`).
- Displayed references now match the link exactly (21 cases corrected, e.g. "Jeremiah 31:21" displayed for the verse Sefaria
  numbers 31:22; "Rema on Shulchan Arukh" shown for the Shulchan Arukh segment; Sefaria's redirect of Sanhedrin 107b:16 to Sotah 47a:5).
- Each Sefaria citation is classified `quotation` (889: three or more consecutive Hebrew words shared with the source) or
  `reference` (2,508) by comparing Rav Tzadok's phrase with the fetched Hebrew.
- 619 distinct internal library references were resolved against the reader (598 found; the 21 Mei HaShiloach passages that
  the library names differently link to Sefaria's Mei HaShiloach instead); 173 quotations differ from the reader's current
  English rendering and are listed for editorial review in `connections/package_report.json`.
- `connections/connections.json` — 4,155 connection records (anchor paragraph/phrase, displayed and canonical ref, URL, match type, status, quote, context/explanation).
- `connections/sefaria_links.json` — a Sefaria link-schema export (`refs`, `type`, `anchor_text`) ready to contribute to Sefaria's connections panel.
- `verification/sefaria_and_library_verification.json` — the raw verification map with canonical refs, Hebrew refs and text snippets.

## 4. Search topic index (`topic-index/`)

`topic_index.json`, `topic_index.csv`, `topic_index.md`, `siman_topics.json`: all 263 simanim indexed with a summary,
4–8 editorial topic labels each (1,105 labels in all: English + Hebrew, kind — concept / practice / figure / middah / mitzvah /
time / text — and weight), 2,196 Hebrew search terms (1,158 verified as exact substrings of the Hebrew text; the rest are
root forms), and 544 Sefaria topic slugs (linkable at https://www.sefaria.org/topics/<slug>) recommended from each siman's
cited sources. Labels are shared across simanim so the index merges (Prayer 34 simanim, Torah Study 34, Fear of Heaven 29,
Repentance 29, David 25 …); 805 labels are specific to a single siman. Also committed to the repository under
`editorial/tzidkat-editorial-master-2026-11/topic-index/`.

## 5. The engine (`engine/`) — see `engine/README.md`

Citation detector for Rav Tzadok's Hebrew, Sefaria canonicalizer with Zohar daf resolver, parallel finder over the whole
library with weights learned from the reviewed parallels, footnote drafter, and the conversion scripts used for this delivery.
Also committed to the repository under `tools/kisvei-engine/`.

## 6. GitHub (`git/`)

Branch `tzidkat-editorial-master-2026-11` is pushed to `akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok`
(three commits); `git/*.bundle` and the patch are offline copies. The branch:

- replaces `sources/akiva/Tzidkat_HaTzadik.json` and adds the Word master to `sources/akiva/docx/`;
- adds `scripts/publish-tzidkat-editorial-master.mjs` and `.github/workflows/tzidkat-editorial-master.yml`, a book-only,
  artifact-preserving release (verified locally end to end against a full site build: 757 files updated, every other sefer byte-identical);
- retires the eight legacy Tzidkat layers (18 scripts guarded by the edition marker, the 13-volume installer and the supplied-source
  patches skip the book, 9 `pages.yml` steps removed, stale flags dropped) and updates the three Tzidkat tests, which pass;
- adds `tools/kisvei-engine/`, `editorial/tzidkat-editorial-master-2026-11/` (connections, Sefaria links, verification, topic index, re-anchoring report) and `docs/tzidkat-editorial-master-2026-11.md`;
- re-anchors the Connected Ideas threads (section 8) and lets the publisher patch the live Connected Ideas catalog.

**To publish:** merge the branch into `main` with `[tzidkat-editorial-master]` in the merge commit message (or run the
workflow manually). The tag makes the full `pages.yml` rebuild skip and runs the book-only publisher, which replaces only Tzidkat HaTzadik on the live reader.

## 7. PDFs from Google Drive (`pdfs-from-drive/`)

Seventeen Rav Tzadok PDFs under the connector's 10 MB limit were fetched (Pri Tzadik HaMevoar Kedushat Shabbat, the single-parashah
Biurei HaChasidut and Biur Meshulav files, Dover Tzedek, Poked Akarim, Divrei Soferim excerpt). The Neimos HaTzedek volumes (81–91 MB),
the Biur Meshulav volumes (29–31 MB), the Har Bracha Tzidkat (15 MB) and the four large Pri Tzadik volumes you linked (23–94 MB) exceed the
connector limit and could not be downloaded in this session; most of the fetched single-parashah files are image-only scans and need OCR
(no OCR engine could be installed here). `engine/README.md` explains how to feed them to the engine once extracted.

## 8. Connected Ideas threads (`connections/connected-ideas-reanchoring.json`)

The reader's 428 Connected Ideas threads into Tzidkat HaTzadik were pinned to the previous edition's Hebrew; 366 would
have been hidden on the new edition. They were re-anchored to the master edition (215 word-for-word, 138 with a few edited
words, 13 re-cut to whole interlinear phrases where the master divides the siman inside the quotation), the book-only publisher
now rebuilds them against the published texts while keeping every other thread unchanged, and their note numbers follow the
4,407 manuscript notes. Seven threads whose Peri Tzadik side awaits the pending Peri Tzadik transition stay as published and are
listed in the publication report.

## 9. Known follow-ups

- The 13 re-cut and 138 edited Connected Ideas quotations are flagged in the re-anchoring report for an editorial reread of the
  English excerpt and explanation.
- The parallel ranker's held-out recall@10 is 0.17 (0.22 at 20): proof-text and wording channels are strong, purely thematic
  parallels still need an editor or an LLM reading both passages; more reviewed parallels will improve it.
- The large Drive PDFs (over 10 MB) and the image-only scans still need to be extracted (OCR) and fed to the engine, as
  described in `engine/README.md`.
