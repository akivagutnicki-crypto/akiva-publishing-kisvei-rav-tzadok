# Akiva Publishing: annotated 13-volume reader payload

This staging directory is intentionally empty until the three files are uploaded:

- `akiva-reader-13-part-1.zip`
- `akiva-reader-13-part-2.zip`
- `akiva-reader-13-manifest.json`

The two ZIP parts are each under 25 MiB for GitHub web upload. Upload all three **unchanged** in the `incoming/` directory on `main`; a push triggers GitHub Pages. The final upload triggers a full SHA-256 and 20,570-footnote audit and applies the prebuilt annotations to their correct 13 `dist/library/data` books *after* the regular build. This leaves the four excluded books and the reader UI untouched. If uploads are incomplete, the build stops rather than silently publishing an incomplete reader.

Only published reader data is replaced; source masters already committed in the repository are not overwritten by the payload. The dynamic cited-source mappings are merged so references from unrelated books are retained.

Source translations and non-specific Sefaria topic URLs have not all been textually verified; the validation tests structural placement and link formatting.
