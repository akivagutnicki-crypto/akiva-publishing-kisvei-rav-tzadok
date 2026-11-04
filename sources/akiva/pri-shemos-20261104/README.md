# Supplied Pri Tzaddik Shemos Word edition

These are the two unchanged Word files supplied by Akiva Gutnicki on November 4, 2026. The Word XML is the authoritative text, phrase order, native footnotes, hyperlinks, and placement source for this publication.

| Stored source | Supplied filename | Footnotes | SHA-256 |
|---|---|---:|---|
| volume-i.docx | Pri_Tzaddik_Shemos_Part_1_With_Footnotes.docx | 2098 | 5f750c2ecd9e6b862b43db0677fce73109a937610e9c2b7efbf3e6809b89e58f |
| volume-ii.docx | Pri_Tzaddik_Terumah_Pekudei_With_Footnotes.docx | 1378 | 67916f39e116d22d0e7eee6da3fad23171e90aed71c71f44a1e3ccbe1c8f497a |

`python3 scripts/pri-shemos/build.py` imports nested Word bidi runs and complete native footnotes. `verify.py` independently checks every source paragraph and original note marker in reading order. `pri-shemos-release.yml` restores the complete current public-site artifact, adds the edition, synchronizes Reader/MCP/offline archives, inventories every unrelated file, runs desktop/mobile browser checks, publishes, and verifies every changed public file by SHA-256. The full-rebuild preservation gate remains in force.

2026-11-04 (edition v2): 325 reviewed parallel footnotes added across all 148 sections (Rav Tzadok / Ishbitz–Radzin, Chassidus, Kabbalah, Machshava),
each placed on the phrase that states the shared idea, with verified Sefaria links. Same notes as the print volumes.
