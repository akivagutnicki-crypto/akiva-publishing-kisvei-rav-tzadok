# Tzidkat HaTzadik — Complete Editorial Master edition (November 2026)

`sources/akiva/Tzidkat_HaTzadik.json` now carries `editionId: "tzidkat-editorial-master-2026-11"`:
the phrase-by-phrase vocalized Hebrew–English edition from `Tzidkas_Complete_Editorial_Master_REVISED_2.docx`
(264 simanim, 512 paragraphs, 7,312 phrase pairs, 47 editorial subheadings) with all 4,407 numbered notes
embedded in the reviewed TZ-note schema: exact UTF-16 Hebrew anchors (`heCharOffset`, `heAnchorPrefix`, `heWord`),
rich paragraphs, canonical Sefaria `sources` (3,397; 3,142 of 3,147 distinct references verified against the live
Sefaria API, canonical ref and URL recorded), `nativeConnections` to 703 Kisvei Rav Tzadok / Ishbitz–Radzin passages,
and `crossReference` for the 436 "See note N" notes. Every legacy Tzidkat layer (2,141/2,096 overlays, the archived
13-volume Tzidkat folder, quoted-source patches, source-accuracy/attribution/batch packs) is retired: the scripts
exit immediately when the edition marker is present, and the corresponding steps were removed from `pages.yml`.

## Publishing (book only, preserving every other sefer)

Push to `main` with `[tzidkat-editorial-master]` in the commit message, or dispatch
**Publish Tzidkat HaTzadik editorial master (book only)**. The workflow builds the fresh Tzidkat data with the
canonical builders, restores the current Pages artifact, and `scripts/publish-tzidkat-editorial-master.mjs`
replaces only `library/data/tzidkat-hatzadik/*`, the catalog entry, the Tzidkat anchors in the citation reverse
indexes, the MCP text and parallels for the book, the offline manifest and the two cache markers.

## Evidence and tools

- `editorial/tzidkat-editorial-master-2026-11/connections.json` — every citation as a connection record
  (anchor paragraph and phrase, displayed and canonical ref, match type `quotation`/`reference`, status).
- `editorial/tzidkat-editorial-master-2026-11/sefaria_links.json` — Sefaria link-schema export.
- `editorial/tzidkat-editorial-master-2026-11/sefaria_and_library_verification.json` — the API verification map.
- `tools/kisvei-engine/` — the citation / parallel / footnote engine and the conversion scripts (see its README).

- `editorial/tzidkat-editorial-master-2026-11/topic-index/` — the search topic index: 263 simanim, 1,105 editorial
  topic labels (English + Hebrew, kind, weight), 2,196 Hebrew search terms checked against the text, 544 Sefaria topic
  slugs recommended from each siman's cited sources, and a per-siman summary file for the reader.
- `editorial/tzidkat-editorial-master-2026-11/connected-ideas-reanchoring.json` — the re-anchoring report (below).

## Connected Ideas threads

The 428 Connected Ideas threads into Tzidkat HaTzadik (`sources/akiva/themes/*.json`) were pinned to the previous
edition's Hebrew; 366 of them would have been hidden by the reader's pin check. `scripts/reanchor-tzidkat-themes.mjs`
relocated every quotation in the master edition (215 word-for-word, 138 with a few edited words, 13 re-cut to whole
interlinear phrases where the master divides the siman inside the quotation, with the master's own English), updated
the refs, Hebrew and pins, and recorded the change in each record's `reanchoring` field. The book-only publisher
rebuilds those records against the published texts and keeps every other record of
`library/connected-ideas/catalog.json` unchanged; a thread whose other side no longer matches the published text is
kept as published and listed under `provenance.partialRebuild.unresolved` (at the time of writing: seven threads whose
Peri Tzadik side awaits the pending Peri Tzadik transition). Connected Ideas notes in Tzidkat are numbered after the
4,407 manuscript notes (the retired quoted-sources pack no longer pins supplementary numbers).

The edition guard prepended to the retired scripts only fires when the script is the entry point, so
`build-connected-ideas.mjs` and the tests that import helpers from them keep working.

Known follow-ups: the 13 re-cut threads and the 138 edited quotations are flagged in the re-anchoring report for an
editorial reread; the seven unresolved threads resolve once the Peri Tzadik transition is published.
