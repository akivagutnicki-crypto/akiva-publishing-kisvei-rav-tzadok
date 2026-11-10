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

- **`torat-hakohen.jsonl.gz`** — 427 entries indexing **תורת הכהן** (הקדמות ושערים במשנת הרה"ק רבי צדוק הכהן, R' Mordechai Yosef Zakutinsky, Lawrence NY 5787): one entry for each place that sefer quotes and explains a library passage. Same record shape, with `v`/`c` = `th`, `p` = PDF page, `pl` = printed page, `Th` = siman, `Uh` = os › sub-topic (from the sefer's table of contents), `t` = the sub-topic and the opening words of the quoted passage in the library's own text, `r` = the library ref, and `T` where the sub-topic names a glossary heading (221 entries). Built from an OCR of the sefer matched against the library (scripts outside this repo); index only, the sefer's text is not included. The MCP tools serve it as corpus `torat-hakohen`; the reader's Mafteach search leaves it out.

`scripts/build-mafteach-index.mjs` (run by `scripts/build-mcp-index.mjs`) turns these into the shards under `dist/mcp-data/mafteach/` that the Worker serves.

The entries are OCR output: references are occasionally misread, and about 2% are flagged uncertain. Check a passage before citing it.
