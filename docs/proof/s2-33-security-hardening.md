# S2-33 Security Hardening Batch — Proof Pack

Status: implemented and locally verified, **pending GPT verification**.

- **Task:** S2-33, Phase 0, Stabilization, P0. Execution: Claude Code with four parallel read-only investigation subagents.
- **Start:** `711c72c`. **Branch:** `security/s2-33-phase0-hardening`, in the isolated worktree `/var/www/html/parametrics-s2-33`.
- **Not deployment approval.** Deployment stays blocked on the S2-32 external items: Google OAuth secret rotation, fresh JWT/APP_ENC/ENCRYPTION keys, Atlas password rotation and a valid hostname, network allowlist, and real-environment smoke.
- **No Atlas use.** The exposed Atlas credentials were not used. Every DB interaction used `mongodb://127.0.0.1:27017` with a dedicated `parametrics_s2_33_smoke` database, which was dropped afterwards.

## 1. Summary

| # | Area | S2-32 ref | Severity | Outcome |
|---|---|---|---|---|
| 1 | Debug routes mounted everywhere; `token_prefix` (10 chars of a Google access token); `/clear` used `req.user.id` (always undefined), so it filtered on a null `user_id` | D5 + new | P0 | Fixed |
| 2 | Login rate limit keyed on the first client-supplied `X-Forwarded-For` (audit IP too) | D2 | P0 | Fixed |
| 3 | Unknown CORS origin returned `500`, a stack trace under non-production `NODE_ENV`, and an unbounded log line with the raw origin | D3, D4 | P1 | Fixed |
| 4 | Google Connect sent the 7-day app JWT in `?t=`. `authenticate` accepted `?t=` on every route. OAuth state was a replayable stateless JWT not bound to a browser (account-linking CSRF) and was accepted as an app token | D8 + new | P0 | Fixed |
| 5 | Uploads: no auth, no ownership check, no size or type limit, client filename kept, active content (HTML/SVG/JS) served from the API origin, stored inside the checkout | G1 + new | P0 | Fixed |
| 6 | Seed wrote `password_hash`, login reads `password`; default password printed; no local-Mongo guard (local `.env` points at Atlas) | S2-31.2 risk | P1 | Fixed |

New findings documented but not fixed (`docs/backlog/security-hardening.md`):

- **SEC-01:** the login email regex is built from unescaped input.
- **SEC-02:** the Google sign-in `?gjwt=` redirect.
- **SEC-04:** the post-connect page query mismatch.
- **SEC-05:** `GOOGLE_REDIRECT_URI` should be required outside local.

## 2. Task Record

**Docs read:**

- `CLAUDE.md`
- `docs/codex/README.md`, `verification-checklist.md`, `local-proof-pack.md`, `sprint-2-phase-1-guardrails.md`
- `docs/runtime/processes.md`
- `docs/proof/s2-32-deployment-readiness.md` (findings D2–D8, G1)

**Investigation:** four read-only subagents, none of which edited files.

- A: API perimeter
- B: Google OAuth
- C: uploads
- D: verification and architecture

**Implementer-inspected sources:** `server.js`, `middleware/{auth,rateLimit}.js`, `lib/{corsConfig,authConfig,jwt,mongo,crypto}.js`, `routes/{debug,debug.google,integrations.google,uploads,auth,posts,locations}.js`, `services/{auditLog,ownership,organizationAccess,reportStorage,reportStore}.js`, `startup/ensureIndexes.js`, `scripts/{seed,seed.mongo,admin.reset,seed.local-review.s2-31}.js`, and `apps/web/src/{apiClient.js,session.js,pages/Integrations.jsx,pages/NewPost.jsx,pages/integrations/GoogleConnect.jsx,components/ActiveLocationPicker.jsx}`.

**No dependency was installed.** The worktree uses symlinks to the main checkout's `node_modules` (ignored by `.gitignore`). Playwright 1.64.1 came from the existing npx cache.

### Files changed (41 files: +2281 / −225 before this proof doc)

**API, new:**

- `lib/trustProxy.js`, `lib/errorHandler.js`, `lib/debugRoutes.js`
- `services/googleConnectState.js`, `services/uploadStorage.js`, `services/localDevSeed.js`
- Tests: `lib/{trustProxy,errorHandler,debugRoutes}.test.js`, `middleware/auth.test.js`, `routes/{integrations.google,uploads}.test.js`, `services/{googleConnectState,localDevSeed}.test.js`

**API, modified:**

- `server.js`, `middleware/{auth,rateLimit}.js`, `lib/corsConfig.js`
- `routes/{debug,debug.google,integrations.google,uploads}.js`
- `services/auditLog.js`, `startup/ensureIndexes.js`
- `scripts/{seed.mongo,seed,admin.reset}.js`
- Test expectations updated: `lib/corsConfig.test.js`, `services/auditLog.test.js` (the old assertion encoded the XFF trust)

**Web:**

- New: `lib/googleConnect.js` + test
- Modified: `apiClient.js` (+ test), `pages/Integrations.jsx`, `pages/NewPost.jsx`
- **Deleted:** `pages/integrations/GoogleConnect.jsx`. It was dead (no route), imported the missing `@/lib/auth`, and carried the `?t=<jwt>` pattern.

**Repo/docs:**

- `.gitignore`: `/uploads/` and `/apps/api/uploads/` for new files. The tracked legacy JPEG stays tracked.
- `docs/runtime/processes.md`, `docs/codex/sprint-2-phase-1-guardrails.md`
- New: `docs/architecture/api-security-perimeter.md`, `docs/backlog/security-hardening.md`, and this proof

**No package changes:** no `package.json` or lockfile is modified.

## 3. Vulnerabilities: Previous vs Corrected Behavior

Full contract: `docs/architecture/api-security-perimeter.md`.

### 3.1 Debug endpoints (P0)

- **Threat:**
  - `GET /api/v1/debug/google/status` returned the first 10 characters of a live Google access token in production.
  - `/access` returned the raw provider error body.
  - `POST /clear` ran `deleteMany({provider:'google', user_id: undefined})`, which likely deleted other users' rows that have a null or missing `user_id`.
- **Before:** both routers were mounted unconditionally at `/api/v1`. Any valid JWT could call them.
- **After:**
  - Mounted only when `NODE_ENV ∈ {development,test}` **and** `ENABLE_DEBUG_ROUTES=true`, and re-checked per request (`next("router")`, so 404). This doesn't rely on `NODE_ENV` alone.
  - Responses are `{ok, token_present}` or `{ok:false, reason:<fixed code>}`.
  - `/clear` uses `req.user.user_id`, deletes only the caller's rows, and requires `{"confirm":"delete-my-google-integration"}`. A token with no user id gets `401`.
- **Modules:** `lib/debugRoutes.js`, `routes/debug*.js`, `server.js`.

### 3.2 Login rate limiting (P0)

- **Threat:** sending a new `X-Forwarded-For` on each request gave unlimited login attempts. Audit logs recorded the attacker-chosen IP.
- **Before:** `getClientIdentity` and `auditLog.getIp` read the first XFF value, and `trust proxy` was unset.
- **After:**
  - Both use only `req.ip`, falling back to `socket.remoteAddress`.
  - `TRUST_PROXY` (default off; a hop count; or loopback/uniquelocal/IP/CIDR) feeds Express `trust proxy`. `true` is refused at startup.
  - The 429 body, `Retry-After` and `X-RateLimit-*` headers are unchanged.
- **Proxy assumption:** there is no deployment topology yet (S2-32 B3). The default is the safe one, which means no forwarded header is trusted. Behind a reverse proxy, operators **must** set `TRUST_PROXY=1` (or the real hop count). Otherwise every client shares the proxy IP and one global login bucket. That failure is noisy but safe, and it is documented in `processes.md`.
- **Modules:** `lib/trustProxy.js`, `middleware/rateLimit.js`, `services/auditLog.js`, `server.js`.

### 3.3 CORS and errors (P1)

- **Before:**
  - `cb(new Error(\`CORS origin not allowed: ${origin}\`))` went to Express finalhandler and produced a `500`.
  - The body contained the stack whenever `NODE_ENV≠production`.
  - `console.error` logged the full stack plus the raw attacker origin on every request.
- **After:**
  - The error is typed (`code=cors_origin_not_allowed`, `status=403`) and contains no origin.
  - A final `createErrorHandler()` returns `403` JSON for GET and preflight, with no `Access-Control-Allow-Origin`.
  - The log line is sanitised, truncated, and limited to one per minute with a suppressed count.
  - Other 4xx errors become generic JSON. A 5xx becomes `internal_error` JSON, with the stack logged server-side and the query string never logged.
  - Helmet now runs before CORS, so rejections carry security headers.
- **Unchanged:** allowed origins and no-Origin requests behave as before.
- CORS is documented as **not** an authentication boundary.
- **Modules:** `lib/corsConfig.js`, `lib/errorHandler.js`, `server.js`.

### 3.4 Google Connect (P0)

**Before:**

- `Integrations.jsx` navigated to `/api/v1/integrations/google/start?t=<app JWT>`. The JWT ended up in history, proxy logs, and the Referer.
- `authenticate` accepted `?t=` on every protected route.
- State was `signJwt({uid, ru, at}, 10m)`: replayable, not browser-bound (an attacker's consent link could bind a victim's Google account to the attacker's ParaMetrics user), and accepted by `authenticate` as a session with `user_id: undefined`.
- The token-exchange failure logged the provider response body.

**After:**

1. `POST /connect/start` (Bearer) stores a 60 s single-use handoff bound to `user_id` and returns `<callback-origin>/…/connect/go?h=<handoff>`.
2. `GET /connect/go` atomically redeems the handoff, mints a random state and a browser nonce, sets the nonce as an HttpOnly, `SameSite=Lax`, callback-path cookie, and returns 302 to Google.
3. `GET /callback` atomically `findOneAndDelete`s on state hash + nonce-cookie hash + unexpired. The user id comes from the record.

Other changes:

- Only SHA-256 hashes are stored. The `google_connect_states` collection has partial-unique hash indexes and a TTL index.
- Legacy `GET /start` returns `410 connect_start_moved`.
- `authenticate` is Bearer-only and requires a `user_id` claim.
- Callback logs carry the status code only.
- The remaining Google integration logic (code exchange, id_token decode, encrypted upsert, refresh-token preservation) is unchanged.

Not added:

- **PKCE (SEC-08).** It can't be verified against real Google here, and the state is already random, single-use and browser-bound.
- **The Google sign-in `?gjwt=` redirect is not changed (SEC-02).** It is a separate login flow and an auth-behavior change outside this task.

**Modules:** `services/googleConnectState.js`, `routes/integrations.google.js`, `middleware/auth.js`, `startup/ensureIndexes.js`, `web lib/googleConnect.js`, `pages/Integrations.jsx`.

### 3.5 Uploads (P0)

**Threat:**

- Anonymous internet users could write any file to disk and have it served from the API origin. An uploaded `.html` loading an uploaded `.js` gave stored XSS (helmet's `script-src 'self'` allows it). On a same-origin deploy that could steal `localStorage` JWTs.
- There was no size limit, so the disk could be filled.
- Original filenames (which may contain PII) appeared in public URLs and audit logs.
- Files lived in the cwd-dependent checkout.

**Consumers** (inspected before editing):

- `NewPost.jsx` uploads, which sets `posts.image_url`.
- Google fetches `media[].sourceUrl` **without credentials**, so post images are intentionally public.
- `RecurrenceLab.jsx` links to `image_url`.
- `postGenerator.js` writes `uploads/generated` but has no callers.

No private-content consumer exists, so public post media and private content did not need to be separated. Public serving is restricted to raster images under unguessable names.

**After:**

- Pipeline: `authenticate` → per-user rate limit → `requireOwnedOrganizationLocationAccess` with `owner`/`admin`/`manager` on `?locationId` (the post-creation roles) → multer.
- Unauthenticated or unauthorized requests are refused before any file bytes are parsed.
- Memory storage, 5 MB, one file, no fields.
- JPEG/PNG detected by magic bytes. The client MIME type and filename are ignored.
- Stored as `<32hex>.<ext>` with `wx` and mode `0640` into `UPLOAD_DIR`. That directory is absolute, outside the repo and not `/tmp` in production, and it is **required** in production (fail fast).
- The response shape `{url, filename}` is unchanged.
- `/uploads/*` is a strict handler:
  - `UPLOAD_DIR` first, then the read-only legacy `<repo>/uploads`, `<repo>/apps/api/uploads` and `cwd/uploads` (same URLs).
  - Raster extensions only. No dotfiles, no traversal, no nested paths except legacy `generated/`.
  - `nosniff`, `CSP: default-src 'none'; sandbox`, `CORP: cross-origin`.
- Web: `api()` supports `FormData` and sends Bearer auth. `NewPost` sends `locationId`, disables the input until a location is chosen, and shows a size/type error.

**Modules:** `services/uploadStorage.js`, `routes/uploads.js`, `server.js`, `web apiClient.js`, `pages/NewPost.jsx`, `.gitignore`.

### 3.6 Development seed (P1)

- **Before:**
  - `seed.mongo.js` wrote only `password_hash`, while login requires `password`, so the seeded admin could never log in.
  - It printed `admin@example.com` / the default password.
  - It had no Mongo host guard. The local `apps/api/.env` resolves to **Atlas** with `NODE_ENV=development`, so it would have written to Atlas.
  - `admin.reset.js` would have reset an Atlas admin's password to a known value.
- **After:**
  - `seedLocalAdmin()` writes `password` (plus an identical `password_hash`), `normalized_email` and `status: active`.
  - The password comes from `SEED_ADMIN_PASSWORD` (≥12 chars) and is never printed.
  - Idempotent: `created`, then `unchanged`. It `repaired` the legacy hash-only row, and `password_reset` happens only with `--reset-password`.
  - It refuses non-`development`/`test` and any non-localhost Mongo, including SRV, before connecting.
  - `admin.reset.js` has the same Mongo guard. `seed.js` (legacy Postgres, already broken) no longer prints the password.
  - Authentication itself was not rewritten.
- **Modules:** `services/localDevSeed.js`, `scripts/{seed.mongo,admin.reset,seed}.js`.

## 4. Migration and Deployment Implications

- **New required production env:** `UPLOAD_DIR`. The API refuses to start without it.
- **New recommended env:**
  - `TRUST_PROXY`, set to the real hop count behind a reverse proxy.
  - An explicit `GOOGLE_REDIRECT_URI` ending in `/callback` (SEC-05).
- **New optional local env:** `ENABLE_DEBUG_ROUTES`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_EMAIL`.
- **New Mongo collection:** `google_connect_states`, with 3 indexes created by `ensureIndexes()` at startup. No data migration.
- **Uploads:** no automatic migration or deletion. Legacy URLs keep working through the read-only fallback. Operators can copy legacy files into `UPLOAD_DIR` (same names resolve there first). The tracked JPEG is still tracked; untracking it would delete it from other checkouts on pull (SEC-07).
- **Web/API version coupling:** old cached web bundles calling `GET /start?t=` get `410`, and old upload calls without auth get `401`. Deploy web and API together.
- **`?t=` removal:** a grep of `apps/web/src`, `apps/api/src` and `apps/api/http` found no other `?t=` consumers.
- **Rollback:** revert the branch commit(s). `google_connect_states` can be dropped safely. Files uploaded to `UPLOAD_DIR` keep their names, and a rollback would not serve them, because the old static path is `cwd/uploads`.

## 5. Verification

All counts were taken on the final tree.

| Check | Result |
|---|---|
| `node --check` on all changed or new JS (33 files) | 33/33 OK |
| `cd apps/api && npm test` (existing matrix, includes org members, auth-adjacent and report tests) | **232/232 pass** |
| S2-33 API tests (`node --test` on the 8 new files; not yet in `npm test`, SEC-03) | **51/51 pass** |
| `cd apps/web && npm test -- --run` | **7 files, 90/90 pass** (84 before + 6 new) |
| `cd apps/web && npm run build` | 289 modules, built OK. The existing Browserslist age warning is unrelated |
| Built bundle: query-JWT patterns / `connect/start` | 0 / 1 |
| `git diff --check` | clean |
| `package.json` / `package-lock.json` diff | none |
| Deletions | only the intended dead `GoogleConnect.jsx` |
| Truncation (any modified file below 60 % of its HEAD line count) | none |
| Secret scan | see section 7 |

### 5.1 Focused security regression tests (API)

- **`trustProxy.test.js`:**
  - Resolve matrix; `true` and invalid values refused.
  - Real Express app on an ephemeral port: rotating spoofed XFF stays in one bucket, then 429 with the unchanged contract.
  - `TRUST_PROXY=1` uses the proxy-appended address.
  - An untrusted peer cannot inject an address.
- **`errorHandler.test.js`:**
  - Disallowed GET and preflight get 403 with no ACAO and no stack.
  - Allowed preflight gets 204 with ACAO and credentials. No-Origin gets 200.
  - Log throttling: 2 lines for 6 rejections, with `suppressed_since_last=4`.
  - A 500 under `NODE_ENV=staging` returns no stack, and the query string is not logged.
  - Malformed JSON gets 400 JSON.
- **`debugRoutes.test.js`:**
  - Enable matrix.
  - Production plus the flag plus a valid token gives 404 for all 3 routes.
  - The enabled routes still require auth.
  - `/clear` needs confirmation and refuses a token without a user.
  - Source assertions: no `token_prefix`/`token_length`/`e.body`/`req.user.id`.
- **`auth.test.js`:** Bearer works; `?t=` gives 401; signed tokens without `user_id` (OAuth state shapes) give 401.
- **`googleConnectState.test.js`:**
  - Happy path is user-bound; only hashes are stored.
  - Handoff is single-use and expires; under 5 concurrent redemptions exactly 1 succeeds.
  - State replay is refused; expired state is refused before TTL cleanup.
  - Cross-browser forgery gets `browser_mismatch` without consuming; the legitimate flow still succeeds afterwards.
  - Malformed or NoSQL-object inputs are refused.
  - Go-URL origin and cookie attributes checked.
- **`integrations.google.test.js`:** wiring is `authenticate` before `oauthRateLimit` on `/connect/start`; the go/callback routes are rate-limited; legacy `/start?t=` gets 410 with no redirect; `/connect/start` with `?t=` only gets 401.
- **`uploads.test.js`:**
  - Unauthenticated gets 401 (with or without `?t=`), and nothing is written.
  - Cross-user gets 404, viewer role gets 403, missing location gets 400, and nothing is written.
  - PNG and JPEG get random names, and the client name and MIME type are ignored. The original name is not audited.
  - SVG, HTML and HTML-as-`.png` get 415.
  - Oversize gets 413; two files get 400.
  - Legacy JPEG, a legacy name with spaces, and `generated/` are served. HTML, SVG, `.env`, traversal and nested paths get 404.
  - `UPLOAD_DIR` validation matrix.
- **`localDevSeed.test.js`:**
  - The seeded admin passes the real login contract; the old default password fails.
  - Idempotent; legacy repair; explicit reset.
  - Refuses production, staging and empty `NODE_ENV`, and SRV/remote/mixed Mongo.
  - Refuses short or missing passwords.
  - No password in the output or in the script source.

### 5.2 HTTP smoke against isolated local runtimes

- **Setup:** API from the worktree, local Mongo smoke DB, local Redis.
- **Google was mocked** with a `node --import` preload (scratchpad, not in the repo). It answers `oauth2.googleapis.com/token` with fixture tokens and **throws on any other Google host**.
- **No real Google API call was made by the API process.**
- **Port note:** the first port (5061) is on the fetch spec's blocked-port list, so the smoke moved to 5071.

| Runtime | Result |
|---|---|
| Real `seed.mongo.js` against the smoke DB | `created`, then `unchanged` on rerun; `NODE_ENV=production` refused (exit 1). Non-local URI refused for both `seed.mongo.js` and `admin.reset.js` (exit 1) |
| Dev API `:5071` (`NODE_ENV=development`, debug flag unset) | **46/46 PASS** (details below) |
| Production startup refusals | Missing `UPLOAD_DIR`, `UPLOAD_DIR` inside the repo, and `TRUST_PROXY=true` each exit 1 with a coded message |
| Prod API `:5072` (`NODE_ENV=production`, `ENABLE_DEBUG_ROUTES=true`, auth limit 3) | **9/9 PASS** (details below). Log: 0 stack lines, 1 CORS line |
| Dev API `:5073` with `ENABLE_DEBUG_ROUTES=true` (local debugging preserved) | **4/4 PASS:** `/status` and `/access` return only `ok,token_present`; `/clear` without confirmation gets 400; unauthenticated gets 401 |

**Dev API `:5071` checks:**

- **Perimeter:** health; CORS 403 (GET and preflight) with no stack; allowed preflight 204; malformed JSON 400 with no stack.
- **Auth:** seeded admin login 200; old default password 401; `?t=` on `/orgs` 401 while Bearer gets 200.
- **Debug:** 3 debug routes 404.
- **Connect:**
  - Legacy `/start` 410; `/connect/start` with `?t=` only 401.
  - Start gives a go URL on the callback origin with only `h`, and no JWT.
  - Go gives 302 to `accounts.google.com` with a 43-char random state and an HttpOnly, `SameSite=Lax`, callback-scoped cookie.
  - Handoff replay gives a fail redirect.
  - Callback without the cookie 400; with the cookie, `google=ok`.
  - The integration is bound to A, and the tokens are encrypted at rest.
  - Replay 400; expired state 400; expired handoff gives a fail redirect.
  - B's state with A's cookie 400; B with its own cookie is bound to B, and A has no B row.
  - The store holds hashes only.
- **Uploads:**
  - No auth 401; another user 404; SVG 415.
  - Owner PNG gives 200 with a random name, served with `nosniff` and a sandbox CSP, and written to the external `UPLOAD_DIR`.
  - **The tracked legacy `1770385064097-Untitled.jpeg` is served at its old URL.**
  - Traversal, dotfile and HTML paths 404.
- **Regression:** report runs list owner 200 / non-member 403; org members owner 200 / non-member 403.
- **Audit:** no JWT, raw state, mock token or original filename in `audit_logs`.

**Prod API `:5072` checks:**

- Login 200.
- **3 debug routes 404 despite the flag and a valid token.**
- CORS 403 with no stack; malformed JSON 400 with no stack.
- **Rotating spoofed XFF:** 401, 401, then 429. The 429 contract is unchanged.
- Legacy start 410.

**Audit outcomes recorded** (smoke DB, by reason):

- `google.oauth.callback` failures: `browser_mismatch` ×2, `state_unknown_or_used` ×1, `state_expired` ×1. Successes ×2.
- `google.oauth.start` failures: `handoff_invalid` ×2. Successes ×4.
- `upload.file` failures: `unsupported_media_type` ×1, `not_found` ×1. Successes ×1.

### 5.3 Browser (Playwright 1.64.1, headless Chromium)

**Setup:** web dev server on `:5181` (Vite proxy to API `:5071`); Google hostnames made unresolvable in the browser.

**Result: 15/15 PASS.**

- Seeded admin login.
- **The real "Connect Google" button:**
  - Uses `POST /connect/start` and never `GET /start`.
  - Reaches the Google consent URL with a random state.
  - The browser holds the HttpOnly `SameSite=Lax` nonce cookie.
  - A second browser presenting A's state gets 400.
  - A's browser completes with `google=ok`; a replay gets 400.
- **NewPost:**
  - The upload input is enabled once a location is chosen.
  - The upload sends Bearer + `locationId` and gets 200.
  - The image URL is filled in, and the image can be fetched publicly.
- Organization Members page renders for the owner. The screenshot shows the org and a masked owner row.
- **0 of 240 browser request URLs contained the app JWT, `?t=`, or `gjwt`.**
- 0 responses from any real Google host; 0 uncaught page errors.
- Screenshots (scratchpad, not committed): `integrations-after-connect.png`, `newpost-after-upload.png`, `organization-members.png`.

**Disclosure — real Google contact by the browser:** in the first three browser runs, Playwright's `context.route()` did not intercept the *redirected* navigation from `/connect/go`. Headless Chromium therefore loaded the real `accounts.google.com/o/oauth2/v2/auth` URL three times. The request carried only the fake client id `s2-33-smoke-client-id`, a random state, and the localhost redirect URI. It included no credentials, tokens or user data, and Google returned its OAuth error page. After that the browser ran with `--host-resolver-rules` mapping `*.google.com`, `*.gstatic.com` and `*.googleapis.com` to NOTFOUND, and the final run asserts 0 Google responses. The API process never contacted Google.

## 6. Known Limitations and Remaining Risks

1. **The Google sign-in flow still puts the app JWT in a URL** (`/login?gjwt=`), and the login state is a replayable stateless JWT (SEC-02, P0 next).
2. **The login email lookup builds a regex from unescaped input** (SEC-01, P0 next).
   - An email of `.*` matches the first user, which allows password spraying across accounts within the rate limit.
   - Crafted patterns also allow ReDoS.
   - It was kept out because it changes login behavior.
3. **The app JWT still lives in `localStorage`**, so any XSS can read it (SEC-09). The upload XSS vector is closed, but this is not an XSS-proof session.
4. **Residual cross-user window in Google Connect.** A victim who opens an attacker's fresh `/connect/go?h=` link **within 60 s** and then consents would bind the victim's Google account to the attacker. This is inherent while the session is a header-only JWT: no cookie identifies the user on a top-level navigation. Forwarded consent links and callback URLs are fully blocked by the nonce cookie.
5. **Without `GOOGLE_REDIRECT_URI`**, the go/callback URL is derived from client-supplied `X-Forwarded-Host` (SEC-05). It must be set in deployed environments.
6. **Rate limiting is in-memory and per process** (SEC-06). A wrong `TRUST_PROXY` behind a proxy collapses login limiting into one global bucket.
7. **Uploaded post images are public by design** (Google must fetch them). Legacy files keep guessable timestamp names.
8. **The S2-33 API tests are not in `npm test` yet** (SEC-03, needs a package.json script approval).
9. **Not verified against real Google, the real Atlas, the real proxy, or real browsers on the deployed origin.** This is a local proof, not a deployment proof (S2-32 lesson).
10. **`GoogleConnected.jsx` shows "connected" even on failure** (SEC-04). This predates S2-33.

## 7. Secrets and Output Hygiene

- No JWTs, OAuth tokens, client secrets, passwords, emails (beyond fixture placeholders), raw env content or full URIs were printed in terminal output or written to this document.
- The smoke secrets were generated randomly into a mode-0600 scratchpad file and never echoed.
- The smoke DB and `~/.cache/parametrics-s2-33-smoke` were removed after the smoke.
- **Secret scan: PASS.** 41 changed and new files plus the added diff lines were scanned for credentialed URIs, `GOCSPX-`, `sk-`, `eyJ` JWTs, private keys, non-placeholder secret assignments, Google access/refresh token shapes, and non-placeholder emails. Only file, line and pattern class were printed.
  - 0 credential hits.
  - 8 pattern hits, all verified test fixtures against known markers:
    - 3 test-only `TEST_JWT_SECRET` constants;
    - 2 fake JWTs with header `{"alg":"HS256"}`, payload `{}` and signature `sig`;
    - 1 mixed-case `Admin@Example.com` placeholder;
    - 1 `u:p@api.example.com` URL used to test credential-URL rejection (it matches two classes, URI and email).
  - Plus this section's own list of pattern names.

## 8. Lessons Learned

- **Fix the trust decision, not the header parsing.** Reading XFF "more carefully" is still client input. Only `trust proxy` with a known hop count makes `req.ip` meaningful, and the safe default is to trust nothing.
- **A user-bound OAuth state is not browser-bound.** Binding to `user_id` stops replay but not account-linking CSRF. The browser that started the flow must hold a secret too.
- **A shared signing secret blurs token types.** OAuth state JWTs were accepted as sessions. Require the claims a session must have.
- **Check bug shapes, not only names.** `req.user.id` vs `user_id` turned a "delete my rows" endpoint into "delete rows with a null owner".
- **Inspect upload consumers first.** The public-URL requirement (Google fetches media) decided the design: public raster images only, under unguessable names.
- **Browser mocks need a network-level guarantee.** Playwright request routing did not catch a server-issued redirect, so the browser reached real Google. Use host-resolver rules (or a proxy) and assert zero responses.
- **The fetch spec blocks some ports** (5060/5061 and others). Pick smoke ports outside that list.
- **Busboy's `parts: 1` rejects a single file part.** Use `files`/`fields` limits and probe library limits rather than assuming.

## 8.1 Git

- Branch: `security/s2-33-phase0-hardening` (from `711c72c`).
- Commit: recorded in the final report (created after verification, as the task authorizes).
- Push: branch only. **Nothing pushed to `main`; no force-push; no merge.**

## 9. GPT Decision

**Pending.**
