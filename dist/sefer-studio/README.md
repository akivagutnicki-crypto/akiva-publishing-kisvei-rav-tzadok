# SeferStudio Pro

A browser publishing workspace for Hebrew and English manuscripts, Word footnotes, newsletters, PDF/OCR, and visual design.

This release uses the latest uploaded SeferStudio/OfficeStudio web bundle with launch, file-opening, routing, and PWA cache repairs. It is hosted under `sefer-studio/` within Akiva Publishing’s GitHub Pages site.

## Use

Open `index.html` through the hosted HTTPS website. Choose **Launch Studio** or upload a DOCX or PDF. Word, Publisher, PDF, and Design are available from the workspace bar. Save documents with **Save .DOCX** to keep your work. Document contents are not automatically backed up by the local author profile.

Chrome can offer **Install app** on supported devices. Core app files and supported public libraries are cached after the first visit. OCR language downloads and connected services can require internet access.

## Optional connected features

AI providers require the user’s own supported credentials and endpoint. Google Drive requires a configured Google OAuth client. Saving a local author profile does not authenticate with Google. Remote MCP tools require a configured HTTPS endpoint; the separately supplied Python server is not run by GitHub Pages.

## Publishing

The scoped `sefer-studio-release.yml` workflow restores the complete current published site, overlays only this directory, verifies that every unrelated file remains byte-for-byte unchanged, and deploys the complete result. Push app changes to main with `[sefer-studio-release]` in the commit message. The existing Cloudflare mirror can also include the new directory after Pages publication.

## Launch verification

The launch check opens the four workspaces, imports a PDF, and exports the bilingual sample as DOCX. The exported DOCX contains four native Word footnotes, exact 7 × 10 inch page dimensions, and mirrored margins. This is a functional launch check, not a complete fidelity audit of arbitrary manuscripts. Inspect important final Word/PDF output before publication.
