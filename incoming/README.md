# Akiva Publishing — verified 13-volume reader release

This release includes two binary ZIPs and a SHA-256 manifest:

- `akiva-reader-13-part-1.zip`
- `akiva-reader-13-part-2.zip`
- `akiva-reader-13-manifest.json`

The uploaded ZIP bytes are preserved in `incoming/chunks/akiva-reader-13-part-1/` and `incoming/chunks/akiva-reader-13-part-2/`, because the connected GitHub binary-upload interface has a request-size limit. During GitHub Pages deployment, `scripts/assemble-akiva-reader-13.py` reconstructs byte-identical ZIPs in this directory and checks both SHA-256 digests. The workflow then installs and validates 20,570 annotated footnotes across the 13 specified volumes, and stores the complete ZIPs in GitHub after successful publication.

The installer does not change `takanat-hashavin`, `resisei-layla`, `et-haochel`, or `dover-tzedek`, and preserves the existing footnote display/UI. Individual quotations and fallback Sefaria topic links have not all been independently source-verified.
