# Supplied Pri Tzaddik Shemos Word edition

These are the two unchanged Word files supplied by Akiva Gutnicki on November 4, 2026. The Word XML is the authoritative text, phrase order, native footnotes, hyperlinks, and placement source for this publication.

| Stored source | Supplied filename | Footnotes | SHA-256 |
|---|---|---:|---|
| volume-i.docx | Pri_Tzaddik_Shemos_Part_1_With_Footnotes.docx | 1897 | f5912aca399c790e5c62d6abe2543c290f26caea6545160051c1cb6104fcd3f0 |
| volume-ii.docx | Pri_Tzaddik_Terumah_Pekudei_With_Footnotes.docx | 1254 | ed30fb6473800fd3dee656154ccd3e8c4ef2cdf09b0682af1fb4becb373f40d3 |

`python3 scripts/pri-shemos/build.py` imports nested Word bidi runs and complete native footnotes. `verify.py` independently checks every source paragraph and original note marker in reading order. `pri-shemos-release.yml` restores the complete current public-site artifact, adds the edition, synchronizes Reader/MCP/offline archives, inventories every unrelated file, runs desktop/mobile browser checks, publishes, and verifies every changed public file by SHA-256. The full-rebuild preservation gate remains in force.
