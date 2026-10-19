# Editorial review for source connections

This directory contains the approved source-to-passage records used by the reader's source sidebar, citation links, and linked footnote sources. The JSON files are editorial inputs. `dist/library/source-connections/catalog.json` is generated from them after the final canonical reader edition is built.

## Adding or revising a connection

1. **Verify the cited source.** Retrieve its actual Hebrew from an identified edition or authoritative source, read the surrounding passage, and record its precise reference and working source URL. Save the primary response's complete relevant passage in `evidence/<source>.json`, with `ref`, `apiUrl`, `versionTitle`, `verifiedAt`, and `hebrew` (a string or ordered array of strings). Each `sourceRefs` entry must resolve to one proof with the same canonical reference. Preserve segment and range boundaries. A shared daf, chapter, phrase, or keyword is a search lead, not evidence that the proposed interpretation is relevant.
2. **Read the proposed connection in context.** Locate the exact canonical paragraph in Kisvei Rav Tzadok or the Ishbitz–Radzin works. Check what it says before and after the proposed quotation and how that explanation bears on the originating discussion. If it does not illuminate that specific point, omit the connection. There is no minimum number of connections or school quota to fill.
3. **Supply enough of both texts.** Record the cited source's Hebrew and English and a contiguous Hebrew excerpt from the connected paragraph with its complete English translation. The excerpt must contain the argument needed to explain the connection. Translate any untranslated excerpt accurately from the verified Hebrew. Record whether the English is an identified existing translation or a newly prepared and checked translation; do not replace the quotation with contextual commentary. Pin both full reviewed Hebrew contexts using SHA-256 and the shared matcher's `normalizedHebrew`: `reviewedTargetHebrewSha256` covers the canonical paragraph's joined Hebrew phrase strings or its `t` text, and `reviewedSourceHebrewSha256` covers the full saved primary-source Hebrew. These pins include the surrounding arguments, not only the selected excerpts.
4. **Explain the relationship separately.** Write a concise explanation of the specific interpretive contribution. Choose `focusTerms` from the relevant originating discussion so the connection will not appear merely because the same source is quoted elsewhere in a long paragraph. Use `originRefs` when the relationship was checked for particular exact originating paragraphs.
5. **Approve only after review.** Set `reviewed: true` only after source attribution, Hebrew quotation, English translation, surrounding context, and relevance have been checked. Search scores, source co-occurrence, shared words, translation length, and a successful structural test cannot promote a candidate. Keep unresolved candidate notes outside this directory's `*.json` publication inputs.
6. **Run the final-edition checks.** After the normal source-quotation build and MCP refresh, run `node scripts/build-reviewed-connections.mjs`, `node scripts/test-reviewed-connections.mjs`, `node scripts/test-reviewed-connections-reader.mjs`, and `node scripts/test-reviewed-source-rendering.mjs`. The last command checks the shipped source loader in an isolated Node VM. Review any source or target mismatch rather than changing a citation merely to make the test pass. Inspect the actual sidebar from an inline citation, a footnote source link, and a source lookup, including a nearby discussion where the connection should be absent.
7. **Publish through the existing workflow.** The Pages workflow verifies the generated catalog and reads back the live catalog and shared matcher. Edit the editorial record and rebuild for later corrections; do not hand-edit the generated catalog or its SHA-256 evidence.

## Required record fields

Each JSON file has `schemaVersion: 1` and a `records` array. Every record includes:

| Field | Editorial meaning |
| --- | --- |
| `id` | Stable lowercase record identifier, unique across the directory. |
| `sourceRefs` | Exact cited source references, including the appropriate segment or range. |
| `sourceHebrew`, `sourceEnglish`, `sourceUrl` | Actual source quotation, its translation, and its verified source location. |
| `targetRef`, `targetHebrew`, `targetEnglish` | Exact canonical connected paragraph, a contiguous Hebrew quotation, and the translation of that quotation. |
| `school` | Exactly `Kisvei Rav Tzadok` or `Ishbitz–Radzin`, agreeing with the canonical target book. |
| `explanation` | How the quoted target illuminates the cited source in the relevant discussion. |
| `focusTerms` | Distinctive words or phrases in the originating discussion, used to restrict display. |
| `originRefs` | Optional exact originating paragraph references individually included in the review. |
| `translationProvenance` | A plain-text statement identifying the translation and its review. |
| `reviewedTargetHebrewSha256` | SHA-256 of the full normalized canonical Hebrew paragraph that was read and approved. |
| `reviewedSourceHebrewSha256` | SHA-256 of the full normalized primary-source Hebrew that was read and approved. |
| `reviewed` | Must be `true` for publication, reflecting the completed editorial work above. |

## Primary-source evidence

The `evidence` directory is separate from the top-level publication records. Keep one JSON proof per exact canonical source reference. Retain the full relevant Hebrew supplied by the identified primary edition, including material before or after the displayed excerpt. The record's `sourceHebrew` must be a contiguous whole-word excerpt in that proof; punctuation, nikkud, HTML, and whitespace may be normalized, while consonantal spelling and word order remain exact. This permits a complete verse to omit a trailing paragraph marker or a translated teaching to omit a following mnemonic without weakening verification of the surrounding source.

Compute `reviewedSourceHebrewSha256` after editorial review by flattening and joining the proof's Hebrew strings with spaces, applying `normalizedHebrew`, and hashing the result. If a record declares multiple source references, each proof must contain its quoted source text; concatenate the normalized full proofs in `sourceRefs` order, separated by one space, before hashing. A Sefaria proof's API URL must identify the same passage or the containing passage from which the exact segment was selected. The generated catalog records the proof's path, file SHA-256, canonical reference, edition, API URL, quotation location, and full-source hashes.

## Continuing the review

Add a connection when a new source lookup reveals a substantive, verifiable parallel. Revisit existing records when a source attribution, translation, or canonical passage changes, or when an actual reading context exposes an irrelevant match. Read the changed context again, revise or remove the record, and repeat the checks. A later search result or higher score never upgrades an existing record automatically.

The catalog contains hashes of the saved primary source, exact canonical target paragraph, and selected quotations used for each release. The builder refuses missing or mismatched primary evidence, noncontiguous source quotations, and changed surrounding Hebrew in either text even when the selected excerpt still matches. Re-read the new context before updating `reviewedSourceHebrewSha256` or `reviewedTargetHebrewSha256`; do not refresh a failing pin automatically. Use the released evidence when comparing editions. Structural validation confirms reference identity and quotation fidelity; the editorial review remains responsible for the interpretation and translation.
