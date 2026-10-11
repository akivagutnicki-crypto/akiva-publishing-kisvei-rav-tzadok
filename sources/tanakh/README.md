# Tanakh reference data for parallels

Used by `scripts/build-parallels.mjs` to recognise verses that a passage quotes without naming them, and
distinctive Biblical words that two passages share.

- `wlc-consonantal.json`: every verse of the Westminster Leningrad Codex (as distributed by the Open Scriptures Hebrew Bible project), consonants only,
  keyed "Book chapter:verse". The WLC text is in the public domain.
- `rare-lemmas.json`: Hebrew lemmas found in at most eight verses, with their consonantal forms (prefixes
  removed) and the verses. Lemma data from the Open Scriptures Hebrew Bible project
  (https://github.com/openscriptures/morphhb), licensed CC BY 4.0. Credit: Open Scriptures Hebrew Bible Project.
