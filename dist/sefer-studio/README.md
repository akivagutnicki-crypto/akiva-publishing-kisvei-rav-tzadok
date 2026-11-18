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

Linked contents entries in the preview and HTML proof use the page labels of their resolved bookmark targets. This adjusts the displayed references when the browser repaginates the manuscript without rewriting the original Word fields. The export dialog identifies contents entries that could not be resolved. Review the resulting proof; an HTML download is not itself a PDF.

## Connecting ChatGPT to the open app

The application has two distinct MCP connections:

- **Public Torah research:** `https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/mcp` exposes the published library's read-only tools. The MCP Hub can initialize it and run a search without an access code.
- **Your open document:** `https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/studio-mcp` exposes the paired browser workspace. This uses OAuth with PKCE and a one-time pairing code. It does not use the separate AI OCR service code.

Open **ChatGPT Connection** in the app. Leave editing disabled for read-only access, or enable **Allow targeted text edits** before starting the connection. Select **Connect this tab**. When connecting the SeferStudio plugin in ChatGPT, enter the one-time code on the SeferStudio authorization page and review the requested access. Keep the app tab open. A connection lasts up to two hours; **Disconnect** revokes it. If a code has expired or was already used, create a new pairing code in the app.

The document tools inspect structure, read bounded paragraph and footnote ranges, search, navigate, replace an exact text run, undo a bridge edit, and open export controls. Each edit requires the correct document identity, current revision, and exact original text. A changed document or stale request is rejected. Repeated mutation requests use the same request identifier to avoid applying a change twice. Existing paragraph formatting, footnote IDs, and note anchors remain in place; unsupported Word structures and structural paragraph changes are excluded.

PDF tools inspect the loaded PDF, return a bounded image of a selected page for ChatGPT to review, read OCR text, and replace that text with an exact preimage and page check. OCR replacement has its own undo. Sending a page image does not itself run an OCR model: ChatGPT can inspect the returned image and propose or supply a transcription using the tools available in that conversation. Review Hebrew, column order, and uncertain readings against the scan.

Every remote operation returns a job identifier. The client must call `studio_get_job` and inspect its completed result before reporting success. Export preparation opens the relevant app controls and returns `prepared_requires_user_save`; it does not claim that a Word or PDF file was downloaded. Upload files and complete downloads through the browser UI.

This authentication authorizes a particular open workspace, not a GitHub account identity. Browser credentials remain in memory. Requested text, page images, commands, and receipts pass through the existing Cloudflare Worker; completed payloads expire after fifteen minutes, and disconnect or session expiry removes the session's data. No complete manuscript is uploaded automatically. The public research server cannot access a paired private manuscript. A closed, expired, or offline tab cannot accept new commands.

The standard MCP endpoint works independently of experimental browser-native WebMCP. The app also registers its bounded tools when the browser supports WebMCP and the user has connected the tab.

## OCR

Open a PDF in **PDF, OCR & PDF Footnotes**, select a page and language, and click **Run OCR**.

### On-device OCR

- Tesseract recognizes a fresh page image at 400 DPI by default; 300 DPI is available for lower memory use.
- Recognition uses automatic page layout detection independently of the preview zoom.
- Suggested review words can be compared with cropped images from the scan.
- If fresh recognition fails and an existing PDF text layer is available, the status explicitly identifies that fallback.
- OCR results remain editable. Low-confidence flags do not identify every error.

The page image is processed in the browser. The first run downloads the OCR engine and language data.

### AI vision OCR

The vision option sends only the selected page image to the connected OCR service. **Check connection** identifies its provider and model. The built-in address uses Cloudflare Workers AI with `@cf/qwen/qwen3.8-27b`; this is not an OpenAI or ChatGPT model. It is instructed to preserve Hebrew column order, footnotes, literal text, and uncertainty notes. Review the result against the scan.

Select **AI vision**, use **Load connection file** to import your private SeferStudio JSON file, then choose **Check connection**. You can also enter the HTTPS service address and separate service access code manually. The access code remains in the current page session; the app does not store it in browser storage, URLs, or the repository. Keep the connection file private. Loading it is a local operation and does not start an AI request.

The service address is `https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/sefer-studio-api/ocr`. Its native implementation is `cloudflare/ocr.mjs`, using the existing Worker's AI binding. Only a SHA-256 verifier of the random service code is deployed. Model usage is charged under the existing Cloudflare account; no provider key is needed in the browser. The approximate allowance is five OCR requests per minute per Cloudflare location, with a separate health allowance. This is not a global spending cap.

Connection readiness confirms authentication and required bindings, not OCR accuracy or a successful model call. The app reports successful image recognition separately. It respects the service's advertised image limits and retains existing text after a failed, cancelled, incomplete, or stale request. A failed vision request is not silently replaced with an on-device result.

The separate OpenAI-based Worker in `services/sefer-studio-ocr/` remains an optional alternative requiring its own backend provider key and deployment. Selecting the native Cloudflare service does not activate that alternative.

## Hosting and releases

The application is published in `dist/sefer-studio/` through the dedicated `sefer-studio-release.yml` GitHub Actions workflow. That workflow restores the previously deployed Pages artifact, overlays this application, verifies that unrelated site files are unchanged, and deploys the complete artifact. Release commits carry `[sefer-studio-release]` so the older full-site build is not triggered.

GitHub Pages serves the browser application, Word import/export, PDF printing, and on-device OCR. The existing Cloudflare Worker also supplies the authenticated AI OCR endpoint. The service code belongs only in the private connection file or password field, never in public site assets.

Files opened in the browser are not automatically published to GitHub or backed up. The local profile control does not establish a Google Drive account connection. Some fonts, PDF and OCR libraries, and icons load from public CDNs, so a first load needs an internet connection.
