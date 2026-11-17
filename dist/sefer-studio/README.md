# SeferStudio Pro

A browser workspace for Hebrew and English DOCX manuscripts, PDF review, and OCR.

**Live application:** https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/sefer-studio/

## Opening and saving Word manuscripts

Choose **Word & DOCX → Open DOCX** and select a `.docx` file. The importer reads native footnotes, embedded Word fonts, paragraph styles, direct formatting, section geometry, headers, and footers. The status bar reports import time and the number of pages and footnotes.

The browser preview has its own layout engine. It is useful for reviewing a manuscript, but its pagination can differ from Microsoft Word or LibreOffice. Field recalculation, complex drawings, tables, typography, and some Word layout rules are not fully reproduced. Review a PDF proof before publishing a print edition.

Saving an imported document without edits returns the original file byte for byte. Supported edits update the original Word package while keeping unrelated XML, relationships, fonts, notes, and section definitions. Unsupported structural changes stop with an explanation instead of silently rebuilding and stripping the original package. Editing a partial paragraph or footnote continuation is protected so a visible fragment cannot replace the complete source text.

## Converting DOCX to PDF

1. Open the manuscript and let pagination finish.
2. Select **Convert to PDF**, then all pages or a page range.
3. Select **Print / Save as PDF**.
4. In the browser print dialog choose **Save as PDF**, 100% scale, no added margins, and no browser headers or footers. The document supplies its page dimensions through print CSS.
5. Save the PDF and inspect its page size, Hebrew, footnotes, and page breaks.

The web version uses the browser's PDF printer; it does not run Microsoft Word's PDF engine. The optional desktop bridge can save directly. A downloadable HTML proof includes embedded DOCX fonts and can also be printed to PDF. Neither successful conversion nor a particular trim size constitutes KDP acceptance.

## OCR

Open a PDF in **PDF, OCR & PDF Footnotes**, select a page and language, and click **Run OCR**.

### On-device OCR

- Tesseract recognizes a fresh page image at 400 DPI by default; 300 DPI is available for lower memory use.
- Recognition uses automatic page layout detection independently of the preview zoom.
- Suggested review words can be compared with cropped images from the scan.
- If fresh recognition fails and an existing PDF text layer is available, the status explicitly identifies that fallback.
- OCR results remain editable. Low-confidence flags do not identify every error.

The page image is processed in the browser. The first run downloads the OCR engine and language data.

### OpenAI vision OCR

The vision option sends only the selected page image to a connected OCR service and OpenAI. It supports Hebrew column order, footnotes, literal transcription, and uncertainty notes. It does not assume that model output is error-free.

Select **OpenAI vision**, enter the HTTPS OCR service address and its separate service access code, and choose **Check connection**. The access code is kept only in the page session. Keep the OpenAI API key in the backend's secret settings, never in this public application or repository. Model API usage applies.

Backend source and setup instructions are in the repository's `services/sefer-studio-ocr/` directory. Vision recognition is available only after that service is deployed and configured; frontend tests alone do not verify model quality or model-account access. A failed vision request is reported as a failure, without substituting on-device OCR and labeling it as a model result.

## Hosting and releases

The application is published in `dist/sefer-studio/` through the dedicated `sefer-studio-release.yml` GitHub Actions workflow. That workflow restores the previously deployed Pages artifact, overlays this application, verifies that unrelated site files are unchanged, and deploys the complete artifact. Release commits carry `[sefer-studio-release]` so the older full-site build is not triggered.

GitHub Pages is sufficient for the browser application, Word import/export, PDF printing, and on-device OCR. Model OCR requires a backend to protect the API key; the included Cloudflare Worker is one deployment option. The existing site's Cloudflare mirror is separate from enabling an OCR backend.

Files opened in the browser are not automatically published to GitHub or backed up. The local profile control does not establish a Google Drive account connection. Some fonts, PDF and OCR libraries, and icons load from public CDNs, so a first load needs an internet connection.
