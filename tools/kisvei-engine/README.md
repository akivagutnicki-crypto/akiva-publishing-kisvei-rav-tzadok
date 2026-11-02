# Kisvei Rav Tzadok footnote, hyperlink and parallel engine

A reusable toolkit, built from the Tzidkat HaTzadik Complete Editorial Master, for making
source footnotes, Sefaria hyperlinks and cross-work parallels for the other writings of
R. Tzadok HaKohen (and the Ishbitz–Radzin works) in the Akiva Publishing reader.

Rav Tzadok repeats his ideas across his works, usually with the same proof-texts and the same
distinctive phrases. The engine exploits that: it detects what a passage cites, looks for the
passages elsewhere that cite the same things or say them in the same words, and ranks them with
weights learned from the reviewed editorial parallels.

## What it learned from

| Signal | Size | Use |
|---|---|---|
| Editorial master citations (Sefaria sources anchored to Hebrew phrases) | 3,397 | gold for citation detection and quotation matching |
| Editorial master parallels (Kisvei Rav Tzadok / Ishbitz–Radzin, with explanations) | 703 | gold for parallel ranking |
| Reader reviewed connections and Connected Ideas threads | 20 + 423 records | gold for parallel ranking |
| Reader library text (24 works, 13,906 paragraphs, 46,649 citation edges) | whole corpus | candidate index |
| Elucidated editions (Pri Tzadik HaMevoar, Biur Meshulav, Biurei HaChasidut PDFs) | partial (see below) | citation vocabulary and footnote style |

The large elucidated volumes (Neimos HaTzedek I–II, Biur Meshulav I–II, Pri Tzadik HaMevoar
volumes) exceed the 10 MB Google Drive connector limit of this environment and could not be
ingested here. `ingest/` documents how to add them: run `pdftotext -layout` (or OCR for the
image-only files), then `python3 run.py cite` over the commentary text to harvest the
citations each commentator attaches to each siman; those become additional gold pairs for
`learn.py`.

## Modules (`kisvei_engine/`)

- `hebrew.py` — nikkud stripping, final-letter folding, prefix stripping, abbreviation expansion, gematria numerals, shingles.
- `citations.py` — detects explicit citations in Rav Tzadok's Hebrew: Bavli dapim (ברכות מח., דף מ"ח ע"ב), Tanakh verses (שמות יב יא), Midrash (שמו"ר ל ג), Zohar by volume and daf (זוהר ח"ג רלב.), Tikkunei Zohar, Mishnah (אבות פ"ב מי"ב), Mishneh Torah (הל' דעות פ"ג ה"ג), Shulchan Arukh, Yerushalmi, plus work mentions (רמב"ם, רש"י, האריז"ל…) as weak leads; returns Sefaria refs with confidence.
- `sefaria.py` — canonical Sefaria URLs, reader `data-ref` forms, citation spelling normalisation, and the Zohar daf-to-passage resolver built from Sefaria's "Daf" alternate structure.
- `corpus.py` — loads the reader's source JSON (interlinear works, study parts, Sefaria exports) into uniform paragraph records.
- `parallels.py` — the parallel finder: inverted indexes over cited sources, 3-word Hebrew shingles, stemmed Hebrew words and English words; BM25-style candidate generation; feature channels (shared sources, shared quotations, Hebrew and English cosine, rare terms, same-book, explicit cross-reference); logistic scoring.
- `learn.py` — pairwise ranking training on reviewed gold pairs; writes `models/parallel_weights.json`.
- `footnotes.py` — drafts footnotes for a paragraph or a whole book in the editorial-master shape (source notes with Sefaria links, quotation lookups, parallel notes with reader links), ready for an editor or a Claude session to finish with the source text, Context and Explanation.

## What it learns from (since November 2026)

- **Footnotes of the five edited seforim only**: Peri Tzadik, Tzidkat HaTzadik, Resisei Layla, Takanat HaShavin
  and Dover Tzedek (`footnote_memory.TRUSTED_SLUGS`). The other seforim's footnotes still need an editorial revamp:
  their *text* is indexed and searched (and links written in the text itself count), but their footnotes are never
  used as examples or as parallels.
- **Never the reader's side-panel links** (`c` in the index, built from `links.json`). Only editorial links in the
  text and footnotes (`a`) are evidence.
- `footnote_memory.py` turns every trusted footnote into a record: Hebrew anchor phrase, source ref (parsed from
  the head of the note, Ashkenazi spellings normalised), the words quoted, the context written, and any library
  parallel appended to the note. `SourceMemory` then proposes, for a new phrase, the sources editors attached to
  the same wording elsewhere, with those earlier quotations and contexts as worked examples. Footnote parallels
  become training pairs for the parallel ranker, next to the reviewed connections.
- **Elucidated editions** (OCR, never stored; only refs and anchor positions in `training/`):
  `ingest-biur` reads *Tzidkat HaTzadik im Biur Meshulav* (inline citations in ביאורי החסידות and מקורות וציונים,
  cross-references to Rav Tzadok's writings, לעיל/להלן within Tzidkat); `ingest-peri` reads an annotated Peri Tzadik
  volume (bracketed sources in the text, numbered notes tied to their markers, cross-references by אות / מאמר).
  Each citation is anchored to the closest phrase (interlinear) or 8-word window (Hebrew-only) of the reader's own
  edition. These records feed the footnote memory and the parallel training.
- Measured with `python3 run.py footnote-memory data/live` (leave-one-sefer-out on the trusted footnotes).

## Measured performance (Tzidkat editorial master, superseded by the reports in models/) (held-out reviewed parallels, 97 queries)

| Ranker | recall@5 | recall@10 | recall@20 |
|---|---|---|---|
| hand weights | 0.09 | 0.12 | 0.21 |
| learned weights | 0.14 | 0.17 | 0.22 |

Candidate recall at 400 candidates is 35 %. Most misses are thematic parallels that share no
proof-text and no distinctive wording with the origin; those still need an editor (or an LLM
reading both passages). The channels that do fire are highly discriminative: among reviewed
parallels 25 % share a cited source, 30 % share a verbatim 3-word run and 34 % share rare
terms, against 0.7 %, 1.5 % and 2 % for random pairs.

The citation detector agrees with the editorial citation on the same phrase for 56 % of its
1,534 detections in Tzidkat HaTzadik; the remaining detections are mostly correct daf-level
locators where the editor chose a more specific segment or a commentary on that daf.

## Usage

Always work from the **published** library index. A plain local `build-library.mjs && build-mcp-index.mjs`
misses what the publishing workflows add over the Pages artifact (most of Mei HaShiloach, later Peri
Tzadik and Beit Yaakov sections): locally that gives about 13,900 paragraphs against about 15,700 live.

```bash
python3 run.py fetch-live data/live          # download /mcp-data from the live reader; fails if any book is incomplete
python3 run.py parallels data/live models/parallel_weights.json "Tzidkat HaTzadik 1:3" 10
python3 run.py cite "כמו שאמרו (ברכות מח.) קטן היודע למי מברכין"
python3 run.py footnotes data/live models/parallel_weights.json "Peri Tzadik, Noach 3:1"
python3 run.py annotate-book data/live models/parallel_weights.json peri-tzadik out/peri_tzadik_drafts.json
python3 run.py learn data/live ../../editorial/tzidkat-editorial-master-2026-11/connections.json models/parallel_weights.json ../..
```

`learn` evaluates the previous, hand-set and newly learned weights on the held-out reviewed parallels
and keeps the best, so retraining never makes the ranker worse. `data/` is git-ignored.

The workflow `.github/workflows/kisvei-engine-live-index.yml` does the fetch and retrain on GitHub
(weekly, on demand, and whenever the engine changes) and commits `models/parallel_weights.json` and
`models/library_coverage.json` (books, sections and paragraphs the model was trained on).

## How the editorial pipeline uses it

1. **Citations** — `citations.detect` finds the explicit locators; `sefaria.sefaria_url` and the Zohar resolver give canonical links; the Sefaria `bulktext` API (see `scripts/convert_bulktext.py` in the delivery) verifies each ref and returns the Hebrew for quotation matching (`parallels.longest_common_run` style word-run matching marks a citation as `quotation` when three or more consecutive words are shared).
2. **Quotation lookups** — words Rav Tzadok sets in quotation marks are searched with Sefaria's exact-phrase search (`/api/search-wrapper`, field `exact`) to pinpoint the segment (e.g. Berakhot 48a → Berakhot 48a:2).
3. **Parallels** — `parallels.find` ranks the library; the top candidates, with their shared sources and shared wording, are handed to the editor (or a Claude session) to confirm and to write the headline, bridge sentence and Explanation in the editorial-master style.
4. **Interlinear editions** — the same corpus provides a phrase-level translation memory: `corpus.Corpus` exposes every Hebrew phrase with its English, so a new interlinear edition can reuse established renderings of recurring phrases (search `heBare` by shingle) and keep terminology consistent.

Everything is plain Python 3 with numpy; no network is needed except for the optional Sefaria verification step.
