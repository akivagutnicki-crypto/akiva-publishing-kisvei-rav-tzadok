# SeferStudio private open-tab MCP bridge

This release adds a separate `/studio-mcp` endpoint to the existing Akiva Publishing Cloudflare Worker. The public library `/mcp`, its research tools, and the OCR service are unchanged.

## What is authorized

The identity being authorized is one explicitly paired SeferStudio browser tab, not a GitHub account. A tab starts read-only unless its user enables editing before creating the connection. Its browser credential stays in memory and is never included in a public URL, plugin manifest, or model tool argument. The one-use pairing code expires after ten minutes; the entire session expires after two hours. Disconnect immediately removes the mailbox, payloads, and all access credentials.

ChatGPT authenticates with OAuth authorization code + PKCE S256. The service publishes protected-resource and authorization-server metadata and supports dynamic registration of exact ChatGPT callback URLs. OAuth consent names the client, callback origin, requested scopes, expiry, and document access. The scopes are `studio:read` and `studio:write`; read is required and is the default. Opaque access tokens are hashed in storage and last at most fifteen minutes. Rotating refresh tokens cannot outlive their two-hour browser session; replay of a spent refresh token revokes that grant and cancels its queued commands.

## Browser contract

All browser routes require an allowed SeferStudio `Origin`. After creation, they also require the in-memory `Authorization: Bearer <ownerToken>`.

| Route | Request | Result |
| --- | --- | --- |
| `POST /studio-api/session/create` | `{allowEditing: false}` | `sessionId`, `ownerToken`, one-use `pairingCode`, expiries, `mcpUrl` |
| `POST /studio-api/session/:id/poll` | `{}` | `session` and one `command` or `null` |
| `POST /studio-api/session/:id/result` | `{jobId, result, isError}` | Acknowledgment, with identical retries accepted |
| `POST /studio-api/session/:id/pairing` | `{}` | A new one-use connection code |
| `POST /studio-api/session/:id/disconnect` | `{}` | Revocation and private-data purge |

`session.authorized` means a live OAuth grant exists. `session.browserOnline` describes the separate browser heartbeat. `connected` is true only when both are true. A command carries `{jobId, name, arguments, createdAt, expiresAt, canWrite}`. The browser executes commands sequentially, validates them against its own typed API, and must check the expiry and local editing permission before each edit.

## Tools and receipts

The fifteen tools cover manuscript state, bounded paragraph reads/search, existing footnotes, exact text-run edits, targeted undo, navigation, export preparation, PDF state/page images, OCR text review/edit/undo, and job receipts. Each browser operation first returns a job ID. `studio_get_job` returns the actual acknowledged result. A queued or running job must never be reported as a completed edit.

Text edits require a current document identity, revision, exact complete text preimage, and a unique request UUID. They do not add/remove paragraphs or footnote anchors. Identical retries share a job; reusing a request UUID with different content is rejected. Jobs are delivered once and expire after thirty seconds. The service does not automatically replay commands after a disconnect, lost acknowledgment, expired deadline, or credential revocation.

The browser must remain open and actively able to poll. A missed heartbeat is reported as offline; a suspended/background browser may need to be brought back into view. No claim is made that a closed browser can be remotely edited.

PDF page responses are bounded JPEGs of at most 1 MiB. A completed page-image receipt is returned as MCP `ImageContent`, with only metadata in JSON/text. No OCR provider credential is exposed or required for ChatGPT to inspect the page. Changing OCR editor text does not itself add a PDF text layer or change the source pixels.

`studio_prepare_export` only opens the relevant browser export controls. Browser Print/Save as PDF and a final layout review remain necessary; a prepared dialog is not a generated PDF.

## Storage and limits

One SQLite-backed Durable Object holds each session. Document snippets and images are transient command payloads, not public library content. Payloads use separate 48 KiB chunks; the session record contains only bounded metadata. Receipts expire after fifteen minutes; alarms purge expired payloads and remove the whole session after two hours. Disconnect uses `deleteAll` and clears its alarm. No third-party content URL is fetched by this bridge.

Ordinary requests/results are limited to 256 KiB. The PDF image acknowledgment route accepts at most 1.5 MiB JSON, while enforcing a decoded JPEG limit of 1 MiB. Each session permits at most twelve pending jobs and one hundred total jobs. Connection creation, client registration and OAuth start requests use Cloudflare's configured rate limiter.

## Deployment

Publish these three code/config changes together through the existing repository build:

- `cloudflare/studio.mjs`
- The `studio` import, `SeferStudioSession` export, and isolated route dispatch in `cloudflare/worker.mjs`
- The `STUDIO_SESSIONS` binding, `sefer-studio-session-v1` SQLite migration and `STUDIO_RATE_LIMITER` in `wrangler.jsonc`

The existing Worker deployment provisions the Durable Object namespace. No OCR token or new server secret is needed. Keep the migration entry in later releases. The public research MCP must continue to route to the original handler.

The private plugin points to `/studio-mcp` with OAuth DCR, base/default scope `studio:read`. The browser's one-time pairing code is entered only on this service's OAuth consent form.

## Validation

Run `node --test cloudflare/test/studio.test.mjs` from this release directory. The focused suite covers protocol discovery, OAuth/CSRF/PKCE/resource/client/redirect validation, single-use codes, cross-session isolation, permissions, heartbeat versus authorization, mutation idempotency, dispatch/receipt expiry, refresh replay revocation, request/queue limits, chunk persistence, bounded image content, disconnect and alarm cleanup. A separate independent route suite is maintained under `qa/studio-independent-security-check.mjs` in the working tree.
