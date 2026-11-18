# SeferStudio Pro

A browser workspace for Hebrew and English DOCX manuscripts, PDF review, and OCR.

**Live application:** https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/sefer-studio/

## Opening and saving Word manuscripts

Choose **Word & DOCX → Open DOCX** and select a `.docx` file. The importer reads native footnotes, embedded Word fonts, paragraph styles, direct formatting, section geometry, headers, and footers. The status bar reports import time and the number of pages and footnotes.

The browser preview has its own layout engine. It is useful for reviewing a manuscript, but its pagination can differ from Microsoft Word or LibreOffice. Field recalculation, complex drawings, tables, typography, and some Word layout rules are not fully reproduced. Review a PDF proof before publishing a print edition.

Saving an imported document without edits returns the original file byte for byte. Supported edits update the original Word package while keeping unrelated XML, relationships, fonts, notes, and section definitions. Unsupported structural changes stop with an explanation instead of silently rebuilding and stripping the original package. Editing a partial paragraph or footnote continuation is protected so a visible fragment cannot replace the complete source text.

Contents entries use the paginator's measured line boundaries and heights in both the browser view and print proof. Labels, dotted leaders, and page fields have separate line boxes so compact Word TOC styles do not collapse into overlapping rows. Wrapped titles and continuation slices keep their measured spacing; page fields remain on one line. This display correction preserves the source DOCX, the existing page references, and manuscript pagination.

## Full screen reading

Select **Full screen** in either the Word/DOCX toolbar or the PDF toolbar. The reading view hides the suite navigation, editing ribbons, and side inspectors while keeping document navigation and zoom available. DOCX retains its page-jump control and zoom in the bottom bar; PDF provides previous/next page, a page-number field, and zoom in the top bar. Global dialogs remain available.

Select **Exit full screen** or press **Esc** to return. If the browser does not support or allow native fullscreen, the app uses a clearly labeled **Focus view** inside the browser; **Exit focus view** and **Esc** restore the normal interface. Moving to another workspace or back to the website also exits the reading view.

Entering or leaving this view does not reload the page, repaginate the manuscript, change its trim or formatting, or save/upload a file. Open documents and unsaved content remain in memory. The previous sidebar visibility is retained, and the app preserves the reading position where possible, including when a DOCX spread changes the number of visible columns. Fullscreen is not remembered after a reload.

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

Open a PDF in **PDF, OCR & PDF Footnotes**. In the scanner, choose **Current page**, **Entire PDF**, or **Page range**. The scope summary shows how many pages are selected, saved, and unfinished. Choose the engine, language, and quality, then select **Run OCR**.

Pages scan sequentially, with a progress bar and the current page shown. **Stop** keeps completed pages. Select **Run OCR** again to continue unfinished selected pages; saved OCR, edited text, and pages on which recognition found no text are skipped. Changing the engine, language, or quality does not silently replace saved work. Select **Rescan saved pages** when you intentionally want fresh results; it applies to one run, and a failed rescan keeps the earlier text and identifies the failure. Text edited after a batch starts is protected even if that batch was set to rescan. If Stop is pressed while the local engine is still starting, Run becomes available once that initializer has finished and been cleaned up.

Use **Review saved page text**, its previous/next buttons, or the PDF page navigator to move between results. Each result belongs to its source page. Text edits are kept when you change pages, and you can review completed pages while later pages are scanning. The page currently being scanned is temporarily read-only. Results distinguish image recognition, edited text, no text found, failures, and an existing-PDF-text fallback. Suggested confidence flags are cleared when you change the text so old confidence does not appear to describe your correction.

**Download selected OCR (.txt)** combines the currently selected scope in source-page order. Every selected page has a labeled section, including explicit markers for missing text, failed scans, and pages with no recognized text. Partial output is labeled **PARTIAL**. **Send this page to Word Studio** inserts only the displayed page's text.

Results and resume state stay in the open tab; they are not automatically backed up. Download TXT to keep them before reloading or closing the tab. Opening a different PDF, or changing PDF bytes through merge, rotation, insertion, or deletion, stops the run and resets its OCR results so old text cannot be attached to different pages. PDF bridge tools continue to read, edit, and undo the currently displayed page's OCR text; they do not substitute the combined book text.

### On-device OCR

- Tesseract recognizes a fresh page image at 400 DPI by default; 300 DPI is available for lower memory use.
- One local worker is reused for the selected pages and released when the run finishes or stops. Only one bounded page canvas is used for recognition at a time.
- Recognition uses automatic page layout detection independently of the preview zoom.
- Each page stores text and at most 40 concise confidence flags. Suggested review words can be compared with a crop rendered on demand; full page images and recognition block trees are not retained for the whole book.
- If fresh recognition fails and an existing PDF text layer is available, the status explicitly identifies that fallback.
- OCR results remain editable. Low-confidence flags do not identify every error.

The page image is processed in the browser. The first run downloads the OCR engine and language data.

### AI vision OCR

The vision option sends each chosen page image to the connected OCR service, one page at a time. **Check connection** identifies its provider and model. The built-in address uses Cloudflare Workers AI with `@cf/qwen/qwen3.8-27b`; this is not an OpenAI or ChatGPT model. It is instructed to preserve Hebrew column order, footnotes, literal text, and uncertainty notes. Review the result against the scan.

Select **AI vision**, use **Load connection file** to import your private SeferStudio JSON file, then choose **Check connection**. You can also enter the HTTPS service address and separate service access code manually. The access code remains in the current page session; the app does not store it in browser storage, URLs, or the repository. Keep the connection file private. Loading it is a local operation and does not start an AI request.

The service address is `https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/sefer-studio-api/ocr`. Its native implementation is `cloudflare/ocr.mjs`, using the existing Worker's AI binding. Only a SHA-256 verifier of the random service code is deployed. Model usage is charged under the existing Cloudflare account; no provider key is needed in the browser. The approximate allowance is five OCR requests per minute per Cloudflare location, with a separate health allowance. This is not a global spending cap.

Connection readiness confirms authentication and required bindings, not OCR accuracy or a successful model call. The app reports successful image recognition separately. It respects the service's advertised image limits and retains existing text after a failed, cancelled, incomplete, or stale request. A failed vision request is not silently replaced with an on-device result.

Batch vision requests use the same checked connection and are spaced by at least 13 seconds. Authentication failures, rate limiting, service failures, unreadable responses, network failures, and timeouts pause the batch with completed pages retained. The app does not automatically retry failed model calls. After resolving the issue or waiting for a rate limit to clear, select **Run OCR** to retry unfinished selected pages. **Stop** also works during the pacing countdown. Each page can incur AI usage, and a large PDF can take substantial time.

The separate OpenAI-based Worker in `services/sefer-studio-ocr/` remains an optional alternative requiring its own backend provider key and deployment. Selecting the native Cloudflare service does not activate that alternative.

## Hosting and releases

The application is published in `dist/sefer-studio/` through the dedicated `sefer-studio-release.yml` GitHub Actions workflow. That workflow restores the previously deployed Pages artifact, overlays this application, verifies that unrelated site files are unchanged, and deploys the complete artifact. Release commits carry `[sefer-studio-release]` so the older full-site build is not triggered.

GitHub Pages serves the browser application, Word import/export, PDF printing, and on-device OCR. The existing Cloudflare Worker also supplies the authenticated AI OCR endpoint. The service code belongs only in the private connection file or password field, never in public site assets.

Files opened in the browser are not automatically published to GitHub or backed up. The local profile control does not establish a Google Drive account connection. Some fonts, PDF and OCR libraries, and icons load from public CDNs, so a first load needs an internet connection.
