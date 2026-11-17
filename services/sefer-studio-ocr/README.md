# SeferStudio OCR service

This Cloudflare Worker supplies the authenticated OpenAI vision endpoint used by SeferStudio’s **PDF → OpenAI vision OCR** controls. The website can continue running on GitHub Pages. Cloudflare hosts this separate backend so an OpenAI API key never belongs in the public website or the browser.

**Status:** implementation and offline contract/security tests are provided. This folder does not activate a service, create credentials, or establish transcription quality. Deployment, a valid OpenAI project key with model access, and a real-page review are still required.

## API contract

The only endpoint is `/ocr`. Both `GET` and `POST` require:

```http
Authorization: Bearer <separate OCR service access code>
```

`GET /ocr` checks service configuration and the rate-limit binding without making a paid model request:

```json
{ "ready": true, "model": "gpt-5.5" }
```

Readiness does **not** prove that the OpenAI key, account allowance, or model entitlement works. The first successful page request checks that path.

`POST /ocr` accepts `Content-Type: application/json` and exactly these four fields:

```json
{
  "imageDataUrl": "data:image/jpeg;base64,<JPEG bytes>",
  "language": "heb",
  "layout": "rtl-columns",
  "pageNumber": 3
}
```

| Field | Accepted values |
| --- | --- |
| `imageDataUrl` | One JPEG data URL; at most 12,000,000 characters |
| `language` | `eng`, `heb`, or `eng+heb` |
| `layout` | `auto`, `rtl-columns`, or `single` |
| `pageNumber` | Positive JavaScript safe integer |

Successful response:

```json
{
  "text": "דִּבְרֵי סוֹפְרִים\n\n…",
  "model": "gpt-5.5",
  "warnings": [],
  "uncertain": ["Right column, final word: unreadable span."]
}
```

`model` identifies the configured model alias. Error responses contain a safe `error` message, a stable `code`, and `ready: false`. They contain no partial transcription, provider error body, or secret.

| HTTP status | Meaning |
| --- | --- |
| 400 / 413 / 415 | Invalid fields, oversized input, or unsupported encoding/file type |
| 401 | Service access code is absent or incorrect |
| 403 | Browser origin or preflight request is not allowed |
| 408 | Page upload exceeded its deadline |
| 422 | Provider response was incomplete, truncated, or refused |
| 429 | Service or provider rate limit; wait before retrying |
| 499 | Client cancelled the request |
| 502 | Provider/network failure or invalid structured output |
| 503 | Service setup or provider access is not ready |
| 504 | Provider deadline exceeded |

## Setup and deployment

These instructions are for the service owner. No deployment workflow is enabled, and this folder does not modify the repository’s existing release workflow.

1. Use Node.js 22 or later. From this folder, run `npm ci`, `npm test`, and `npm run check`. The tests use Node’s built-in runner and mocked networking; they need no API keys and make no model calls.
2. Sign in to the intended Cloudflare account with `npx wrangler login`, or supply an appropriately scoped Cloudflare API token through your deployment environment. Confirm the account and Worker name before deploying.
3. Review `wrangler.toml`. Keep the GitHub origin or replace it with the actual website origin. For several approved sites, use a comma-separated `ALLOWED_ORIGINS` list. Origins include scheme and hostname; they do not include a path or trailing slash. Wildcards and credential-bearing URLs are rejected. HTTP is accepted only for explicitly configured localhost development origins.
4. Choose an unused positive integer `namespace_id` for `OCR_RATE_LIMITER` within that Cloudflare account. The included value is an example namespace for this service. Keep the binding at five requests per sixty seconds for personal use.
5. Run `npx wrangler deploy` only when ready to create or update this Worker. A new deployment without secrets returns `503` for authenticated service operations and cannot call OpenAI.
6. Add both values as encrypted Worker secrets using the interactive commands below. Keep them out of `wrangler.toml`, source files, GitHub Pages, screenshots, and URLs. Cloudflare documents this mechanism in [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

```sh
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OCR_ACCESS_TOKEN
```

`OPENAI_API_KEY` is a server-side OpenAI project key. `OCR_ACCESS_TOKEN` is a **different** random access code for this service: 32–256 characters using letters, digits, `_`, or `-`. Generate a 64-character hexadecimal code locally with `openssl rand -hex 32`, keep it privately, and enter it in the second prompt. Codes beginning with `sk-` are rejected to prevent accidental use of an API key.

7. Open SeferStudio, enter the deployed `https://<worker>.<account>.workers.dev/ocr` address and the separate service code, then use **Check connection**. The frontend retains the access code only in page memory and rejects OpenAI keys in this field.
8. Transcribe a representative page and compare every line, reading order, footnote, abbreviation, and visible vowel mark with the scan. A working connection is not a quality measurement. Rotate the service code if it is exposed.

You do not need to move the GitHub Pages site or change its DNS to use a `workers.dev` endpoint. A custom domain can be configured later.

### Local development

Copy `.dev.vars.example` to `.dev.vars` and fill its two blank values locally. Populated local environment files are ignored by Git. Run `npm run dev` for the local Worker. A local server may make real, billable OpenAI calls if it has a real API key; `npm test` never does. The browser UI requires an HTTPS endpoint, so use the deployed endpoint for the integrated browser check.

For a compilation-only deployment check, run:

```sh
npx wrangler deploy --dry-run --outdir dist
```

No GitHub Actions deployment example is enabled here: account identity and the scope of any existing Cloudflare credentials must first be established. A future manual workflow should be limited to this folder, use a protected deployment environment, and leave API keys and the service code in Worker secrets.

## Model and transcription behavior

The server allowlist currently contains **`gpt-5.5`**. The browser cannot select a model, supply a prompt, change a budget, or redirect requests to another provider. Changing the model requires reviewing its support and limits, updating the server allowlist and configuration, and testing it.

The choice is based on the official [GPT-5.5 model documentation](https://developers.openai.com/api/docs/models/gpt-5.5) and [image-input guidance](https://developers.openai.com/api/docs/guides/images-vision), checked on November 17, 2026. GPT-5.5 supports image input, structured output, and low reasoning effort. Its `original` detail mode allows up to 10,000 image patches and a 6,000-pixel maximum dimension; larger images can be resized. The Worker uses `detail: "original"` and warns when a submitted image exceeds that patch budget.

The fixed server instructions require literal, read-only transcription. They preserve visible Hebrew/Aramaic letters, nikkud, punctuation, abbreviations, numbers, and paragraph boundaries; order Hebrew columns right before left; and place headers, main text, footnotes, and footers in a defined sequence. Page instructions are source text to transcribe, never instructions to execute. Unreadable spans become `[illegible]` with a location to review. The prompt prohibits guessed completions, translation, spelling correction, and invented vocalization.

The Responses API request uses a strict JSON schema with `text`, `warnings`, and `uncertain`. It disables tools and input truncation, does not stream partial text, and sets `store: false`. The service separately validates the returned JSON and rejects incomplete/refused output instead of treating a partial response as a completed scan. See [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and the [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create).

These constraints reduce avoidable failures. They do not make OCR infallible or prove that the model identified every uncertainty. The mocked tests do not measure Hebrew OCR accuracy. Publication requires visual proofreading, especially of dense footnotes, small nikkud, similar letters, clipping, and column transitions.

## Authentication, privacy, and cost controls

Authentication is enforced independently of CORS. A permitted website origin does not grant access. Requests without an `Origin` header, such as authenticated command-line clients, still need the service code. Browser preflight is the only unauthenticated success response and never invokes OCR. Tokens are hashed to equal-length buffers and checked with Cloudflare’s native [`crypto.subtle.timingSafeEqual`](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/).

The service fails closed if either secret, its model configuration, the allowed-origin list, or the rate-limit binding is missing or invalid. A thrown or malformed rate-limit decision also blocks OCR. The binding uses fixed service keys rather than a caller-controlled IP, origin, or header. Health checks have a separate five-per-minute allowance so they do not consume the OCR allowance.

| Control | Service limit |
| --- | --- |
| OCR allowance | 5 requests / 60 seconds per Cloudflare location |
| Images per request | 1 JPEG |
| Image data URL | 12,000,000 characters |
| Entire request body | 12,016,384 bytes, enforced while streaming |
| JPEG dimensions | 6,000 pixels per side and 20,000,000 total pixels |
| Upload deadline | 15 seconds |
| Provider deadline | 100 seconds, including reading the response |
| Provider output | 12,000 tokens, including reasoning |
| Provider response body | 1,048,576 bytes |
| Returned transcription | 80,000 characters |
| Review entries | Up to 10 warnings and 30 uncertain locations, 500 characters each |
| Automatic retries | None |

Cloudflare’s [rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) is approximate and local to each Cloudflare location. It is **not a hard worldwide quota or total spending cap**, and concurrent requests can exceed its threshold. The other controls bound the work requested by each accepted call. Use a dedicated OpenAI project, review its usage and account controls, keep the service code private, and rotate or remove it to stop access. A strict global daily allowance would require an additional coordinated quota implementation. Cancelling or timing out a request does not guarantee the provider has incurred no usage.

The code writes no image, transcription, prompt, key, or access-code logs; creates no database or object storage; disables Worker observability in its configuration; and returns `Cache-Control: no-store`. The page image is sent to OpenAI for processing. `store: false` is not a promise of zero provider retention; the applicable account settings and [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) still apply.

## Verification included

`npm test` exercises the contract through real `Request`/`Response` objects with mocked OpenAI networking and a mock rate binding. It covers fixed-length native-comparison inputs, missing/invalid credentials, failed configuration, CORS, preflight, allowed methods, strict fields, streamed request limits, JPEG boundaries, rate-limit failure, sanitized provider failures, incomplete/refused output, malformed structured output, response-size limits, upload/provider deadlines, and cancellation. Success tests inspect the outgoing API request and the frontend response shape.

The tests do not deploy to Cloudflare, validate a live API key, establish model access, or claim transcription quality. A first live page scan and review remain part of activation.

Build verification on November 17, 2026: all 19 test groups passed, the JavaScript syntax check passed, and Wrangler 4.157.0 completed `deploy --dry-run` with the configured rate-limit binding. A supplemental local runtime check could not start because the execution environment rejected network-interface enumeration (`uv_interface_addresses`). This does not constitute a deployed Worker test.
