# Connected Ideas: whole-library editorial standard

The user’s Pri Tzaddik example establishes the model for **all works in the Rav Tzadok and Ishbitz–Radzin library**: a thoughtful account of a section’s developing ideas, with exact, substantial bilingual passages that clarify those ideas at their proper place. A bibliography of related words does not meet this requirement. The model is the depth and presentation of the example; each reference and interpretation must still be checked against its actual sefer.

## Review each section as an argument

1. Read the **complete actual section** in the canonical Hebrew before outlining it. Confirm its real title, numbering, scope, and place in the work. The order of an example or a previous generated outline is not evidence of canonical numbering.
2. Identify distinct developments in the argument: its question, distinction, explanation, application, and conclusion where present. A long section may need several theme anchors. Do not force every section into the same number of themes or connections.
3. Seek passages across both **Kisvei Rav Tzadok** and **Ishbitz–Radzin**. Search terms and shared citations are candidate-finding aids. They do not approve a connection.
4. Read the full connected paragraph and enough surrounding discussion to understand its position. Prefer a passage that explains a mechanism, supplies an essential distinction, resolves a difficulty, or deepens the author’s argument. Do not include a connection merely because it discusses the same broad subject.
5. Select a **contiguous, complete thought** in both works. Keep qualifications, limiting conditions, contrasts, and conclusions needed to understand it. A longer passage is justified when that extent carries the argument; length alone is not quality. If one paragraph cannot contain the necessary thought, choose an appropriate complete paragraph or expand the supported schema before publishing.
6. Translate every selected Hebrew passage faithfully into English. Prepare a new translation where an adequate checked translation is unavailable. Review technical terms, pronouns, negations, Biblical allusions, and the direction of inclusions or dependencies. Explain interpretation separately from the translation. Never attach English from a shorter, neighboring, or different passage to the selected Hebrew.
7. Write a precise theme title, a concise account of the originating idea, and an explanation answering **what this other passage adds to this particular argument**. Do not claim an explicit quotation or historical dependence unless the text supports it. Avoid interchangeable explanations that would fit many unrelated paragraphs.
8. Anchor the theme to the exact paragraph and the first phrase of the approved Hebrew excerpt. The section overview must follow those anchors in reading order. Where both schools develop one idea, use a shared title and summary at that anchor; preserve each source’s distinct contribution.
9. Perform a second bilingual review of the quotation, translation, interpretation, reference, and placement. Resolve concrete objections before publication. Reject the connection if its relevance remains uncertain. Review scripts check integrity; they do not award scholarly approval.

## Reciprocal connections require their own review

A connection is directional. Before displaying it as a thread in the other sefer, read that **entire target section**, write a title and summary appropriate to its own discussion, and explain precisely how the original passage illuminates it. Do not copy a Pri Tzaddik-specific section summary into another work’s outline. A forward connection can remain approved without a reciprocal connection.

## Publication fields and integrity

Each JSON input has `schemaVersion: 1` and a `records` array. Required fields are:

- `id`, `themeTitle`, `themeSummary`;
- exact canonical `originRef`, `originHebrew`, `originEnglish`;
- exact canonical `targetRef`, `targetHebrew`, `targetEnglish`;
- `school`, `explanation`, `translationProvenance`, and `reviewed: true`;
- `reviewedOriginHebrewSha256`, `reviewedOriginSectionHebrewSha256`, and `reviewedTargetHebrewSha256`.

The hashes pin the full normalized canonical Hebrew paragraph or section that was actually reviewed. Normalize with `source-connections.js.normalizedHebrew`. Changing a review pin is an editorial act: reread the changed context; do not regenerate pins to silence a build failure. The reader’s current interlinear edition takes precedence over older duplicate Hebrew leaves.

A reciprocal record additionally requires **all** of `reverseExplanation`, `reverseThemeTitle`, `reverseThemeSummary`, and `reviewedTargetSectionHebrewSha256`. Incomplete reciprocal metadata is rejected.

`scripts/build-connected-ideas.mjs` locates exact paragraphs in the final MCP edition, verifies quotation boundaries and full-context pins, derives phrase placement, and writes the separate `library/connected-ideas/catalog.json`. No canonical body text or footnote is edited by this feature. A changed surrounding argument fails the build even when a selected excerpt is unchanged. Ambiguous repeated excerpts require a more specific quotation.

The catalog’s coverage section records every library work and identifies **which actual sections have reviewed ideas**. A section with no entry has not thereby been certified to have no relevant parallels. Do not represent the shared whole-library interface or a successful build as completion of editorial review of the entire corpus.

## Every book, section, and subsection remains in scope

Run `node scripts/build-theme-review-progress.mjs` after building the approved catalog. The separate `connected-ideas/review-progress.json` enumerates **every canonical subsection**, including those without an approved connection. It chooses the same current edition as the quotation builder and adds new canonical content as pending. A reviewed anchor and a complete contextual reading do not complete the connection search for every idea in that paragraph.

Save explicit completed subsection reviews in `sources/akiva/theme-reviews/*.json`, outside the approved connection files. The schema is `{schemaVersion:1, reviewedOn:"YYYY-MM-DD", method:"…", entries:[…]}`. Each entry requires the exact `ref` and `sectionRef`, `status` (`reviewed-with-connections` or `reviewed-no-approved-connection`), both schools in `schoolSearch`, `reviewedParagraphHebrewSha256`, `reviewedSectionHebrewSha256`, a substantive `assessment`, and `candidatesReviewed` containing exact canonical `ref`, `school`, and the reason for approval, rejection, or deferral. Record a real comparison from each school. Do not create hypothetical candidate assessments to complete the inventory.

The ledger is an account of the finite passages actually examined. A completed pass is not a claim to every possible connection. An unsuccessful pass means that those reviewed candidates produced no approved link; it does not establish that no illuminating parallel exists. Changed context, wrong references or schools, duplicate completion entries, and completion states that contradict the approved catalog fail the build. A section and work count as reviewed only when every subsection has an explicit completed review. Run `node scripts/test-theme-review-progress.mjs` to verify these distinctions and full corpus inclusion.

## Calibrate each subsequent iteration

Read the user’s whole-library requirement before every new batch. Use the existing approved examples as models of depth, then select the next unreviewed section or a clearly identified weakness. Read the sources afresh, record and resolve translation or relevance objections, inspect the deployed reading position, and update coverage from actual approved records. Avoid repeatedly linking the same familiar passage across neighboring sections unless its distinct contribution can be stated and verified in each.

Retain rejected-candidate notes outside the approved JSON inputs so they do not become future matches by accident. Priority is argumentative usefulness and faithful translation, with an orderly path through the corpus. Never fill a school category or section with a weak match to satisfy a quota.

## Source edition preferences and hosting

The shared source viewer requests **Metsudah Chumash** for the five books of the Torah, **The Koren Jerusalem Bible** for the remaining Tanach, and the verified **Metsudah Rashi** editions wherever available. Exact version titles and availability evidence are in `source-editions.js` and `sources/akiva/source-editions/availability-20261019.json`. An unavailable preferred edition must be identified as unavailable rather than silently replaced by JPS. This source-viewer preference does not rewrite a sefer’s canonical text or previously published notes.

Publish these features through the existing GitHub Pages workflow. The user has expressly rejected adding Netlify or a new monthly service. Editorial generation and review happen before publication; the reader consumes the verified static catalog without a paid inference gateway.
