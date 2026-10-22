# API Security Perimeter (S2-33)

Current state as of S2-33 (Phase 0 security hardening). This describes what the API does today. It is not a target-state auth design.

ParaMetrics is still a Google Business Profile first operations app. The app session is an HS256 JWT kept in browser `localStorage` and sent as `Authorization: Bearer <jwt>`. There is no cookie session.

## 1. Request Pipeline (`apps/api/src/server.js`)

Startup order:

1. `validateUploadConfig()`: fail fast (exit 1) on unsafe `UPLOAD_DIR`.
2. `resolveTrustProxy()`: fail fast on `TRUST_PROXY=true` or invalid values. The result goes into `app.set("trust proxy", …)`.
3. `helmet()`, then `cors(createCorsOptions())`, then `express.json()`. Helmet runs first so CORS rejections also carry security headers.
4. `/uploads` static handler (`createUploadStaticHandler`).
5. Routers. The debug routers are mounted only when `isDebugRoutesEnabled()` returns true.
6. `createErrorHandler()`, mounted last.
7. `validateReportStorageConfig()` (unchanged from S2-28), then `ensureIndexes()`, then `listen`.

## 2. Client IP (`lib/trustProxy.js`, `middleware/rateLimit.js`, `services/auditLog.js`)

- The rate-limit key and the audit `ip` use `req.ip`, falling back to `req.socket.remoteAddress`. Raw `X-Forwarded-For` is never read.
- `req.ip` honours `X-Forwarded-For` only through Express `trust proxy`. `TRUST_PROXY` accepts:
  - unset, `false` or `0`: off (default);
  - a hop count from 1 to 10;
  - a comma list of `loopback`, `linklocal`, `uniquelocal`, IPs or CIDRs.
  `true` is refused.
- Authenticated requests are still keyed by `user_id`. Login, OAuth start/go/callback and anything else unauthenticated are keyed by IP.
- The 429 contract is unchanged: `{ error: { code: "rate_limited", message, retry_after_seconds } }` plus `Retry-After` and the `X-RateLimit-*` headers.
- The store is still an in-memory `Map`, so limits are per process.

## 3. Errors and CORS (`lib/errorHandler.js`, `lib/corsConfig.js`)

- **Disallowed `Origin`:** `createCorsRejectionError()` (`code=cors_origin_not_allowed`, `status=403`). The response is `403 { error: { code: "cors_origin_not_allowed", message: "Origin not allowed" } }`, with no `Access-Control-Allow-Origin`. Preflight `OPTIONS` gets the same response.
  - The rejected origin is never embedded in the error.
  - Logging is one line per minute at most, with control characters stripped, the origin truncated to 200 chars, and a count of suppressed lines.
- **No `Origin`:** unchanged. The request continues without CORS headers. Server-to-server callers and Google's callback redirect rely on this.
- **Other 4xx errors** (for example malformed JSON or payload too large): that status, with `{ error: { code: "bad_request" | "payload_too_large" | "unsupported_media_type" | "request_error" } }`.
- **Anything else:** `500 { error: { code: "internal_error" } }`. The stack is logged server-side only (truncated), with the request path but never the query string. No stack reaches a client under any `NODE_ENV`.
- **CORS is not an authentication boundary.** It only controls which browser origins may read responses. Every protected route still needs the Bearer JWT and its own ownership checks.

## 4. Debug Routes (`lib/debugRoutes.js`, `routes/debug*.js`)

- **Mounting:** `/api/v1/debug/*` is mounted only when `NODE_ENV` is `development` or `test` **and** `ENABLE_DEBUG_ROUTES=true`. Each router re-checks at request time and falls through to 404 otherwise (`next("router")`).
- **Responses:** `GET /google/status` and `GET /google/access` return `{ ok, token_present }`. Errors return `{ ok: false, reason: <fixed code> }`. No token prefix or length, no provider error body or message.
- **`POST /google/clear`** deletes only the caller's own Google integration rows (`user_id` from the JWT). It requires `{"confirm":"delete-my-google-integration"}` and refuses a token without a `user_id`.

## 5. App JWT Transport (`middleware/auth.js`)

- `authenticate` accepts **only** `Authorization: Bearer`. The `?t=` query token was removed (S2-33).
- A signed token without a `user_id` claim is not a session. Before S2-33, OAuth `state` JWTs signed with the same secret were accepted as sessions with an undefined user.

## 6. Google Connect OAuth Initiation (`services/googleConnectState.js`, `routes/integrations.google.js`)

| Step | Request | Auth | Effect |
|---|---|---|---|
| 1 | `POST /api/v1/integrations/google/connect/start` | Bearer | Inserts `{ handoff_hash, user_id, redirect_uri, stage: "issued", handoff_expires_at (60 s), expires_at (10 min) }` into `google_connect_states`. Returns `{ url }`, where the URL is `<callback origin>/…/connect/go?h=<random handoff>`. |
| 2 | Browser navigates to `GET …/connect/go?h=…` | handoff | Atomic `findOneAndUpdate` on `{ handoff_hash, stage: "issued", handoff_expires_at > now }`. It sets `stage: "redirected"` plus `state_hash`, `nonce_hash`, and unsets `handoff_hash`. Then it sets the HttpOnly `pm_google_connect` nonce cookie (`SameSite=Lax`, `Path=<callback path>`, `Max-Age=600`, `Secure` on https) and returns 302 to Google with the random `state`. |
| 3 | Google → `GET …/callback?code&state` | state + cookie | Atomic `findOneAndDelete` on `{ state_hash, nonce_hash(cookie), stage: "redirected", expires_at > now }`. The user id and `redirect_uri` come **from the record**. Then the existing code exchange and integration upsert run. The cookie is cleared. |

- Handoff, state and nonce are each 32 random bytes in base64url. Only SHA-256 hashes are stored.
- **Single use:** handoffs and states are consumed atomically. A replay is refused (handoff gives `?google=fail&reason=handoff_invalid`; state gives `400 Bad state`).
- **Expiry:** handoff after 60 s, state after 10 min. Consume queries also check `expires_at` because the TTL monitor (`ttl_google_connect_states_expires_at`) lags by about a minute.
- **Cross-user / cross-browser:** a state is only accepted together with the nonce cookie of the browser that ran `/connect/go`. A forwarded consent link or callback URL fails with audit reason `browser_mismatch` and does not consume the record.
- **Audit reasons:** `state_invalid`, `state_unknown_or_used`, `state_expired`, `browser_mismatch`, `handoff_invalid`.
- **Legacy entry point:** `GET /start?t=<jwt>` returns `410 { error: { code: "connect_start_moved" } }`.
- **Logging:** a token-exchange failure logs the HTTP status only (not the provider body). Fatal errors log name and code only.
- **Indexes** (`startup/ensureIndexes.js`): partial unique `handoff_hash` and `state_hash`, plus a TTL on `expires_at`.
- **Not changed:** Google sign-in (`auth.google.js`) still redirects with `?gjwt=<app JWT>`. See the S2-33 proof, remaining risks.

## 7. Uploads (`services/uploadStorage.js`, `routes/uploads.js`)

All uploads today are GBP post media. Google fetches `image_url` without credentials, so stored files are **public by design** and use unguessable names. No private user content is uploaded through this route.

- **Pipeline:** `POST /api/v1/uploads?locationId=<id>` runs `authenticate` (Bearer), then `uploadRateLimit` (keyed per user), then `requireOwnedOrganizationLocationAccess` with roles `owner`/`admin`/`manager` (the same check as creating a post), then multer. Unauthorized requests are refused before the body is parsed.
- **Limits:** memory storage, 5 MB, exactly one file field `file`, no other fields. Status codes:
  - `413 file_too_large`
  - `400 upload_invalid` / `missing_file` / `location_required`
  - `415 unsupported_media_type`
- **Content:** type comes from magic bytes only (JPEG, PNG). The client MIME type and filename are ignored. SVG, HTML and disguised files are refused.
- **Stored name:** `<32 hex>.png|.jpg`, written with `wx` and mode `0640` into `UPLOAD_DIR`. The response shape is unchanged: `{ url: "${APP_PUBLIC_API_BASE}/uploads/<name>", filename }`.
- **Serving (`GET /uploads/<name>` and legacy `GET /uploads/generated/<name>`):**
  - Lookup order: `UPLOAD_DIR` first, then the read-only legacy dirs `<repo>/uploads`, `<repo>/apps/api/uploads` and `cwd/uploads`.
  - Only `.jpg/.jpeg/.png/.gif/.webp` are served. Dotfiles, traversal, nested paths and every other extension return 404.
  - Headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: cross-origin`, `Cache-Control: public, max-age=3600`.
- **Migration:** none automatic. Legacy files keep their URLs. Operators may copy them into `UPLOAD_DIR`, since the same name resolves there first.

## 8. Local Seed (`services/localDevSeed.js`, `scripts/seed.mongo.js`, `scripts/admin.reset.js`)

- **Login contract:** look up by `normalized_email`, then check bcrypt against `password`. The seed writes `password` (and an identical `password_hash`), `normalized_email` and `status: "active"`.
- **Refusals:** the seed refuses `NODE_ENV` other than `development`/`test`, and any non-localhost MongoDB (including `mongodb+srv`). `admin.reset.js` has the same Mongo guard.
- **Password:** comes from `SEED_ADMIN_PASSWORD` (at least 12 chars) and is never printed.
- **Idempotent:** an existing working admin is left `unchanged`. A legacy `password_hash`-only admin is `repaired`. `--reset-password` rotates the password explicitly.
