# Checked Hebrew contexts for remote reader sources

These snapshots let the reviewed-connection builder verify exact quotations and full paragraph context for sources that the reader already opens through Sefaria. They are source evidence, not replacement reader editions.

- `shaar-haemunah-1996.json` preserves the complete Hebrew text of **Sha'ar HaEmunah VeYesod HaChasidut**, in the 1996 Sefaria edition: 57 sections and 336 paragraphs across its three nodes. The reader continues to use its existing remote bilingual route, including the English annotations in *The Introduction to the Beit Yaakov, Translated and Annotated by Betzalel Edwards*. Those modern English annotations are not copied into this snapshot.
- `mei-shiloach-volume-ii-eikev-behaalotcha.json` preserves the complete **Volume II Eikev and Beha'alotcha** sections of Mei HaShiloach from Sefaria's *Vocalized Edition*: 18 paragraphs. These supply the original printed teachings about “ממרים הייתם עם ה׳” and Nachshon's death at Kivrot HaTaavah.

Each JSON records its exact work title, edition, source URL, retrieval date, section references, paragraph separator, and original Hebrew HTML. The MCP index uses the same HTML and footnote parser as the bundled reader texts. Source snapshots receive a SHA-256 provenance record in the generated index.

The importer rejects overlapping section references. A snapshot may append missing sections to the existing Mei HaShiloach index only when it explicitly sets `extendsExisting: true` and matches the work's title, slug, and school. It never replaces the published interlinear paragraphs, their notes, or their phrase boundaries. Other existing works cannot be overridden by a remote snapshot.

Editorial approval remains separate: exact quotations, translations, source comparisons, and context hashes belong in `sources/akiva/themes/`, with the finite research audit in `editorial/`.
