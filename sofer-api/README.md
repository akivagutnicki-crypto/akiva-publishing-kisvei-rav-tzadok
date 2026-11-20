# SoferStudio FastAPI service

This is the portable backend. The published website and PWAs use the equivalent Cloudflare Worker API.

Set SOFERAI_API_KEY, GEMINI_API_KEY, and a random SOFERSTUDIO_ADMIN_KEY in the host's secret manager. Put SOFERSTUDIO_KEY_DB on a private persistent volume, use explicit HTTPS CORS origins, and run the supplied Dockerfile with that volume mounted at /data. Set a host upload limit as well as the application's per-file limits.

Send X-Admin-Key to POST /v1/admin/keys with a JSON label to mint a client key. Store the returned key securely. GET on the same path lists key prefixes and DELETE /v1/admin/keys/{key_prefix} revokes a minted key. Supply Authorization: Bearer sfpro_… for paid endpoints.

The multipart routes are /v1/transcribe and /v1/ocr. The JSON routes are /v1/ocr/json and /v1/nikkud. /health reports whether provider credentials are configured.
