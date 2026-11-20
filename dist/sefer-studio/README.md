# SeferStudio Pro

A browser workspace for Hebrew and English DOCX manuscripts, PDF review, and OCR.

[Open Sefer Pro](https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/sefer-pro/#/studio)

Select **Install Sefer Pro** at the left of the workspace toolbar. If the browser does not offer an install prompt, the button shows instructions for Chrome, Edge, and Safari.

[Open the original Studio URL](https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/sefer-studio/#/studio)

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

Results are not automatically backed up. **Save OCR session** downloads every current page result, including corrections, word positions, review flags, number/Rashi audits, timings, and the font needed for searchable export. It saves all processed pages regardless of the selected range, without the PDF, annotations, or service access code. A save during a running scan captures completed results at that point; save again for later results or corrections.

To continue after closing or reloading, open the same PDF and choose **Restore OCR session**. The app verifies the PDF's SHA-256, byte length, and page count, validates the complete checkpoint before applying it, and keeps any page results already in the tab. With an empty OCR session it restores the scan options and selected page. **Rescan saved pages** is turned off, so Run resumes unfinished pages. The session file is limited to 64 MB and the same 250,000 matched-word limit as the live app. It is distinct from a review report, which cannot restore page text.

Use **Download matching source PDF** to keep the exact PDF bytes beside the session, especially after merge, rotation, insertion, or deletion. The ordinary annotated PDF export may reserialize the source and will not necessarily match the checkpoint. Opening a different PDF or changing its page structure still stops the run and resets OCR so old text cannot be attached to different pages; save the session first. PDF bridge tools continue to read, edit, and undo the currently displayed page's OCR text; they do not substitute the combined book text.

### On-device OCR

- Tesseract recognizes a fresh page image at 400 DPI by default; 300 DPI is available for lower memory use.
- The primary local worker is reused for the selected pages and released when the run finishes or stops. The small-number helper or optional faster Rashi refinement may add one auxiliary worker; the two options apply to different language profiles. Only one bounded page canvas is used for recognition at a time.
- Recognition uses automatic page layout detection independently of the preview zoom.
- Each page stores text and at most 40 concise review flags. Suggested words and possible missed header areas can be compared with a crop rendered on demand; full page images and recognition block trees are not retained for the whole book.
- If fresh recognition fails and an existing PDF text layer is available, the status explicitly identifies that fallback.
- OCR results remain editable. Low-confidence flags do not identify every error.

The page image is processed in the browser. The first run downloads the OCR engine and language data.

### Rashi script and conservative line refinement

Select **Hebrew — Rashi script** with the on-device engine to use the pinned `heb_rashi` best LSTM model. Its weights, license, source and hashes are under `ocr-models/rashi-v1/`. This option is distinct from ordinary square-Hebrew recognition. The model download is approximately 4.7 MB compressed and is cached by the OCR engine.

**Refine detected Rashi lines** re-reads each line that the first OCR pass detected. It uses the engine's line boxes, not an experimental custom row splitter. An empty, failed, substantially shorter, fewer-word, or positionless refinement keeps that line's first reading. If line positions do not cover the complete first-pass text, the complete first reading is retained. Optional engine-configuration failures also retain the first reading and retire the worker. Stop and source changes cannot commit late text.

The line crop can extend horizontally within its detected paragraph when it finds letter-sized dark pixels outside the original line box that no other detected line covers. The vertical line bounds remain unchanged. Empty margins, small specks, unusually wide paragraphs, and ink belonging to a neighboring line do not trigger expansion. The audit retains both `bbox` and `cropBbox`. In a bounded check of 226 saved lines, 224 retained exactly the same text and word positions; the two changed lines recovered an omitted edge word or final letter. The original 107-word accuracy sample stayed at 17 word edits. This does not establish full-book coverage: wholly undetected lines and page numbers can still be absent.

**Faster Rashi refinement** is off by default and is available when local Rashi line refinement is enabled. It reads at most two detected lines at a time, using the same model and fallback checks. The extra worker uses more memory. Results and audit records retain source order even when lines finish out of order. Both workers are reused across pages and released on Stop, source changes, or completion. A failed optional worker leaves the healthy worker to continue; failed or unattempted lines retain their first reading. Single-line pages do not start a second worker.

The review report records requested and actual worker counts, additional startup time, and any worker fallback. OCR sessions preserve this preference; older version-1 sessions restore it as off. In a real-model comparison of 242 detected lines (the existing 107-word references plus 226 complete-page lines), ordinary and faster refinement produced identical selected text, word positions, and line audit records. Processing speed depends on the device and the scan; it is measured separately from accuracy.

Local Rashi OCR also checks a narrow header area for substantial visible marks outside the detected word boxes. **Possible missed header** opens a crop for manual review; it never guesses a page number, inserts text, or changes searchable word positions. The review report and saved sessions retain the check's scope, status, and region count. Blank regions, tiny specks, rules, scan-edge bars, and already recognized words are excluded. Large or unreadable inputs are explicitly skipped or reported unavailable. A zero-region result does not prove complete OCR coverage. On the existing 30 saved page maps, this check found one region: the omitted page number on physical page 196. The same omission is detected from the actual browser OCR geometry and PDF.js source pixels.

The review report includes the complete first-pass text and every detected line's first, refined and selected readings. Changed lines still require comparison with the image: retaining detected lines does not establish that every printed line was detected or that every word is correct. Manual or ChatGPT edits mark the earlier refinement audit as historical.

The integrated Tesseract.js 5.1.1 helper was checked on three previously adjudicated image crops (107 normalized words, physical pages 5, 100 and 180 of the supplied Machshavos Charutz scan) at 300 DPI. Word-edit counts fell from 24 to 17. This small controlled check confirms the port's behavior; it is not a whole-book accuracy estimate or a claim of publication-ready text. Select 300 DPI to reproduce those settings; 400 DPI remains available.

### Numbers, timing and review reports

Ordinary Hebrew has an optional **Improve small numbers** pass. It compares two image readings using a separate English digit worker, changes only high-confidence agreements, and flags disagreements or overlapping crops. Unsupported or failed checks keep the original number. The report records changed and uncertain numbers rather than treating model confidence as measured accuracy.

**Download OCR review report (.json)** saves source-page identities, actual rendering/recognition/refinement times, engine/model provenance, result status, searchable-position status and refinement/number audit records. Processing speed and OCR accuracy are separate measurements. The latest-run time includes initialization, waiting and failures; saved-page timings describe those specific successful results.

### Searchable PDF export

After on-device recognition, open **Searchable PDF** and select **Download searchable PDF**. The export requires saved results with word positions for every selected page. It renders the scan to lossless page images and adds a new invisible Unicode text layer; the old PDF text layer is replaced, avoiding duplicate or contradictory text. Hebrew words retain their logical character order. The underlying scan's appearance is preserved at the OCR rendering resolution, while original forms, links and vector objects are flattened.

Single-word edits retain their matched position. Larger rewrites, added/deleted words and AI-only text have no reliable word alignment, so they block searchable export until rescanned; TXT stays available. A source change, changed OCR, changed annotations or Stop aborts the download rather than producing stale output. Export has explicit page/image/memory limits and suggests smaller ranges when necessary.

Supported Studio annotations are applied after the new text layer. The legacy annotation renderer currently supports ASCII text only. Hebrew/other Unicode annotations, Unicode footnotes, and footnotes exceeding its one-line limit stop binary PDF export with a clear message; they are never silently replaced by question marks or truncated. This restriction does not prevent a scanned Hebrew page's OCR text from being searchable.

### Provider OCR in PDF Studio

Select **Gemini 4 Neon Vision**, **Gemini 4 Carbon Vision**, **Sofer.Ai OCR**, or **Hybrid** in the OCR engine menu. Enter the required provider keys for this page session. **Hybrid** sends each selected page to Sofer.Ai and Gemini Neon concurrently, then asks Gemini Hydrogen to reconcile both readings against the original image. Sofer.Ai offers Standard, Enhanced, and Handwriting. Adding nikkud with Sofer.Ai alone requires a Gemini key for the text-only vocalization pass.

Use **Current page**, **Entire PDF**, or **Page range** to choose what to send. **Hebrew columns** prompts Gemini to finish the right column before starting the left. **Tzurat HaDaf** prompts it to separate the central text from marginal commentary. **Old Print** highlights degraded type, Rashi forms, and catchwords. Review each result against its scan, especially if the page has multiple columns or complex margins. **Send this page to Word Studio** inserts the current page’s extracted text.

Page images and session keys go over HTTPS to the existing OCR Worker, which forwards each request to the chosen provider. The app does not save provider keys in local storage, URLs, reports, or session files. Provider usage can be charged for each submitted page. Stopping a request stops the app from accepting its result. Sofer.Ai may continue a job it has already received. On a timed-out job, check the provider before resubmitting the page.

### AI vision OCR

The vision option sends each chosen page image to the connected OCR service, one page at a time. **Check connection** identifies its provider and model. The built-in address uses Cloudflare Workers AI with `@cf/qwen/qwen3.8-27b`; this is not an OpenAI or ChatGPT model. It is instructed to preserve Hebrew column order, footnotes, literal text, and uncertainty notes. Review the result against the scan.

Select **AI vision**, use **Load connection file** to import your private SeferStudio JSON file, then choose **Check connection**. You can also enter the HTTPS service address and separate service access code manually. The access code remains in the current page session; the app does not store it in browser storage, URLs, or the repository. Keep the connection file private. Loading it is a local operation and does not start an AI request.

The service address is `https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/sefer-studio-api/ocr`. Its native implementation is `cloudflare/ocr.mjs`, using the existing Worker's AI binding. Only a SHA-256 verifier of the random service code is deployed. Model usage is charged under the existing Cloudflare account; no provider key is needed in the browser. The approximate allowance is five OCR requests per minute per Cloudflare location, with a separate health allowance. This is not a global spending cap.

Connection readiness confirms authentication and required bindings, not OCR accuracy or a successful model call. The app reports successful image recognition separately. It respects the service's advertised image limits and retains existing text after a failed, cancelled, incomplete, or stale request. A failed vision request is not silently replaced with an on-device result.

Batch vision requests use the same checked connection and are spaced by at least 13 seconds. Authentication failures, rate limiting, service failures, unreadable responses, network failures, and timeouts pause the batch with completed pages retained. The app does not automatically retry failed model calls. After resolving the issue or waiting for a rate limit to clear, select **Run OCR** to retry unfinished selected pages. **Stop** also works during the pacing countdown. Each page can incur AI usage, and a large PDF can take substantial time.

The separate OpenAI-based Worker in `services/sefer-studio-ocr/` remains an optional alternative requiring its own backend provider key and deployment. Selecting the native Cloudflare service does not activate that alternative.

## Audio Transcribe and Hebrew & Rashi OCR

Open **Audio Transcribe** to record a shiur from your microphone, upload existing audio, or enter a public Sofer.Ai-supported link. Recordings stay in the browser until you select **Run Transcription**. Uploads support M4A, MP3, WAV, OGG, WebM, FLAC, AIFF, AAC, and Opus. The upload limit is 18 MiB for Sofer.Ai and 12 MiB for Gemini or Hybrid. Longer recordings can use a supported Sofer.Ai link. A submitted Sofer.Ai job can be retrieved with its ID if you stop waiting or close the tab.

**Hybrid** runs Sofer.Ai and Gemini Neon in parallel, then uses Gemini Hydrogen to reconcile their transcripts. Choose a language and Hebrew word format, plus optional timestamps, speaker labels, nikkud, or abbreviation expansion. The editable transcript supports Markdown, Word HTML, and sending the text to Word Studio. **Nikkudot Lab** also works on pasted text. Keys are shared between the audio and PDF workspaces for the current page session.

In **PDF Studio**, click **Hebrew & Rashi OCR** for a two-panel scan and transcript view. Drop a PDF, PNG, JPEG, WebP, or TIFF. Page images are converted to PDF locally; the TIFF decoder is downloaded on first use. Scan settings use the same PDF OCR engine, saved pages, and Word Studio handoff. Optional Gemini text tools can add nikkud, expand abbreviations, or include a separate English translation after the OCR text. Review AI-added text against the scan.

## Hosting and releases

The application is published in `dist/sefer-studio/` through the dedicated `sefer-studio-release.yml` GitHub Actions workflow. That workflow restores the previously deployed Pages artifact, overlays this application, verifies that unrelated site files are unchanged, and deploys the complete artifact. Release commits carry `[sefer-studio-release]` so the older full-site build is not triggered.

GitHub Pages serves the browser application, Word import/export, PDF printing, and on-device OCR. The existing Cloudflare Worker also supplies the authenticated AI OCR endpoint. The service code belongs only in the private connection file or password field, never in public site assets.

Files opened in the browser are not automatically published to GitHub or backed up. The local profile control does not establish a Google Drive account connection. Some fonts, PDF and OCR libraries, and icons load from public CDNs, so a first load needs an internet connection.

## Managed SoferStudio access

The website, Sefer Pro PWA and standalone SoferStudio AI PWA use a single session-only sfpro_ access key. Add SOFERAI_API_KEY, GEMINI_API_KEY and SOFERSTUDIO_ADMIN_KEY as Cloudflare Worker secrets. After deploying, create a key with POST /v1/admin/keys and X-Admin-Key. Use GET /v1/admin/keys to list keys and DELETE /v1/admin/keys/{id} to revoke one. Do not put provider credentials or access keys in a public page, repository, mobile binary or URL.

The Cloudflare Worker exposes /v1/health, /v1/audio, /v1/transcribe, /v1/ocr, /v1/ocr/json and /v1/nikkud. The browser uses /v1/audio for resumable audio jobs and Hydrogen post-processing. /v1/transcribe returns a Sofer job ID for asynchronous providers. Poll with /v1/audio using action sofer-poll and the same access key. Hybrid also returns the Neon draft, which can be reconciled after Sofer completes.

Production usage requires funded, authorized provider accounts. On-device PDF OCR and local audio recording remain available independently of provider authentication.
