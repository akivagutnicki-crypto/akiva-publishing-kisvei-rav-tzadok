# SeferStudio OCR verification

These tests execute the app's real OCR controller and exporter. The controller and safety tests mock browser/worker/network I/O; the model-port check uses real Tesseract.js 5.1.1 and the exact bundled Rashi model.

From the repository root, with `pdf-lib@1.17.1`, `tesseract.js@5.1.1` and `@napi-rs/canvas` available to Node:

```sh
node tests/sefer-studio-ocr/async-controller-check.cjs dist/sefer-studio/index.html
node tests/sefer-studio-ocr/searchable-safety-check.cjs dist/sefer-studio/index.html
node tests/sefer-studio-ocr/rashi-refinement-check.cjs dist/sefer-studio/index.html
node tests/sefer-studio-ocr/rashi-model-port-check.cjs dist/sefer-studio/index.html
node tests/sefer-studio-ocr/ocr-session-check.cjs
node tests/sefer-studio-ocr/session-integration-check.cjs
node tests/sefer-studio-ocr/ocr-review-selection-check.cjs
node tests/sefer-studio-ocr/rashi-edge-coverage-check.cjs
```

The three small source-image crops and ground truth are recovered from the 18 November 2026 manual validation of the user-supplied *Machshavos Charutz* HebrewBooks 14375 scan. The reference texts were independently visually adjudicated, without substituting OCR or another edition. The source PDF SHA-256 is `63003ceb094dd99d962073970f61d3c403668ae44f3cc50225f737a50cc20407`. Full source PDF not included.

The controlled sample contains 107 normalized words. On the integrated helper at 300 DPI, first-pass word edits were 24 and selected refined word edits were 17. The Node canvas adapter transfers the same pixels to Tesseract using PNG buffers. These measurements do not establish whole-volume accuracy or user-browser speed. Generated results and the temporary decompressed model are excluded from git.
