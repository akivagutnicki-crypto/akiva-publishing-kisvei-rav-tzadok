# HaMafteach HaShalem — source data for the `mafteach_*` MCP tools

**המפתח השלם לספרי רבי צדוק הכהן מלובלין**, compiled by R' Chaim Hirsch (Jerusalem, 2nd ed. 5760): the complete index to R. Tzadok HaKohen's works.

| Part | Index | Covers |
|---|---|---|
| א-ב | Topics | his sefarim other than Pri Tzaddik |
| ג | Sources (Tanach, Shas, Yerushalmi, Midrash, Zohar, Rambam …) | same |
| ד, ה-ו | Topics | Pri Tzaddik |
| ז | Sources | Pri Tzaddik |

All seven parts were OCR'd from the printed volumes (Otzar HaChochma scans), and each line was parsed into an entry with its references. Where the library has the passage, the reference was linked to its ref, e.g. `Tzidkat HaTzadik 100` or `Peri Tzadik, Vayechi 11`.

## Files

- **`entries.jsonl.gz`** — 47,955 entries, one JSON object per line. Fields:
  - `id`, `v` (part), `x` (`t` topics / `s` sources), `c` (`rt` Rav Tzadok's sefarim / `pt` Pri Tzaddik), `p` (scan page), `t` (Hebrew entry text).
  - Topic entries: `T` / `U`, the glossary ids of the topic and sub-topic.
  - Source entries: `b` (book), `ch` / `vs` (chapter/daf and verse/amud), `k` (normalized key, e.g. `Genesis 2:7`, `Berakhot 6b`, `Bereshit Rabbah 2:4`) and `B` (glossary id of an unnumbered source such as Zohar or Tanchuma).
  - `r` — the references. Each is `[label, library ref or null, book (parts א-ג), flags]`. Flags: `*` discussed at length, `?` OCR uncertain, `~` OCR-corrected.
- **`glossary.json`** — the searchable vocabulary:
  - `terms`: 1,744 headings (topics, people, places, mitzvos, festivals, sources), each with Hebrew, English, alternative English, Ashkenazi and Sefardi transliterations.
  - `sefarim`: the index's sefer codes (רל, צה, מח …).
  - `pt_sections`: the Pri Tzaddik sections with spelling variants.
  - `books`: Tanach and Shas names in English, Hebrew, Ashkenazi and Sefardi forms.

`scripts/build-mafteach-index.mjs` (run by `scripts/build-mcp-index.mjs`) turns these into the shards under `dist/mcp-data/mafteach/` that the Worker serves.

The entries are OCR output: references are occasionally misread, and about 2% are flagged uncertain. Check a passage before citing it.

## Page references to the original prints (`print-pages/`)
HaMafteach cites many of R. Tzadok's sefarim by page of the original print (דצ-35 = Dover Tzedek p. 35). For each sefer
whose print the user supplied (hebrewbooks scans, OCR'd outside the repository), `scripts/mafteach-print-pages/align.py`
finds the print's page offset and places every library paragraph on its print page; the result is
`print-pages/<slug>.json` with its own quality check. `scripts/mafteach-print-pages/link.py` then links the index's
page references to the passage on the cited page (the one sharing most of the index line's words) and flags them `p`;
the MCP tools show "the index cites print p. N; passage located by that page". Only maps whose paragraph-level check is
at least 20% and at least twice a random page are used (references the index links itself score 36–51% on the same test).
In use: Dover Tzedek, Kometz HaMincha, Ohr Zarua LaTzaddik, Yisrael Kedoshim, Machshavos Charutz, Sichas Malachei
HaShares, Poked Akarim, Meishiv Tzedek (8,450 references). Not yet: Resisei Layla, Takanas HaShavin, Divrei Soferim (below
the bar), Sefer HaZichronos (the library edition does not align with the print), Likkutei Maamarim and the Pri Tzaddik
supplements (no print supplied).
