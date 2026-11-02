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

Known follow-ups: Connected Ideas records in `sources/akiva/themes/*.json` still pin the previous paragraph
numbering of the 40 re-paragraphed simanim; the reader hides a thread whose pinned Hebrew no longer matches, so
those records should be re-anchored with `build-connected-ideas.mjs` after review.
