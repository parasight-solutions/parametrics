# S2-32 Deployment Readiness + Real Environment Smoke Plan

Status: implemented, pending GPT verification. S2-32.1 containment applied (see
"S2-32.1 Secret Containment").

Task: S2-32 (Phase 1: Deployment Readiness + Real Environment Smoke Plan).
Starting point: `c951afe` (S2-31 closed, Organization Members proof marked Pass).

This document is a readiness audit and a smoke plan. **No real deployment, staging
host, or Atlas login was attempted.** Every "smoke" below is a checklist to run
later on the real environment. Nothing here claims to have run there.

## Task Record

Docs read: `CLAUDE.md`, `docs/claude-code/README.md`,
`docs/codex/sprint-2-phase-1-guardrails.md`,
`docs/proof/sprint-2-closeout-proof-pack.md`,
`docs/proof/s2-31-organization-members-usability-repair.md` (Atlas, security,
and lessons sections), `docs/runtime/processes.md`,
`docs/architecture/report-history-and-storage.md`,
`docs/architecture/report-service.md` (headings and current-state notes),
`docs/architecture/workspace-members.md`.

Source inspected (read-only unless listed under Files changed):
`apps/api/src/server.js`, `apps/api/src/startup/env.js`,
`apps/api/src/startup/ensureIndexes.js`, `apps/api/src/lib/{corsConfig,authConfig,mongo,queues,crypto,jwt}.js`,
`apps/api/src/config.js`, `apps/api/src/middleware/{auth,rateLimit}.js`,
`apps/api/src/routes/{auth,auth.google,debug,debug.google,health,uploads}.js`,
`apps/api/src/workers/*.js` (connection wiring), `apps/api/package.json`,
`package.json`, `docker-compose*.yml`, `.gitignore`,
`apps/web/vite.config.js`, `apps/web/src/apiClient.js`, `apps/web/src/session.js`,
`apps/web/src/lib/reportHistory.js`,
`apps/web/src/pages/integrations/GoogleConnect.jsx`, the built
`apps/web/dist/assets/*.js` bundle, and env files (**key names and booleans only;
no values were printed**).

Note: the task listed `apps/api/src/startup/reportStorageConfig.js`. That file does
not exist. Report storage validation is `validateReportStorageConfig()` in
`apps/api/src/services/reportStorage.js`, called from `server.js` (S2-28).

Files changed:

| File | Change |
| --- | --- |
| `docs/proof/s2-32-deployment-readiness.md` | New (this file). |
| `apps/api/src/lib/mongo.js` | Bug fix: `maskMongoUri` no longer logs the raw URI on parse failure (see D1). Exported for verification. |
| `docs/runtime/processes.md` | New "Deployment Readiness (S2-32)" section. |
| `docs/codex/sprint-2-phase-1-guardrails.md` | S2-32 entry and deployment lessons. |
| `docs/architecture/report-history-and-storage.md` | S2-32 storage deployment note. |
| `docs/architecture/workspace-members.md` | S2-32 real-environment members smoke note. |
| `apps/api/.env_bak` | **Deleted from the repository** (S2-32.1). |
| `.gitignore` | Widened env/env-backup patterns (S2-32.1). |

No dependency installed. `package.json` and `package-lock.json` are unchanged.

## Summary Of Findings (Challenge Results)

Findings are ranked. Every one was observed in the code or in a local probe in
this task; nothing is speculative unless marked "unverified".

### P0: blocks any real deployment

- **B1. A secrets backup file is committed to a public repository.**
  - `apps/api/.env_bak` is tracked in git. It was added in the Initial Commit
    (`5bca4b0`) and is on `origin/main`.
  - `gh repo view` reports the GitHub repository as **PUBLIC**.
  - `.gitignore` has `.env` and `.env.*`, which do not match `.env_bak`.
  - Key names present with non-empty values include `JWT_SECRET`,
    `ENCRYPTION_KEY` (44 chars, base64 32-byte shape),
    `GOOGLE_OIDC_CLIENT_ID`, and `GOOGLE_OIDC_CLIENT_SECRET`
    (Google client-secret shape). Its `MONGODB_URI` is a local host with no
    credentials.
  - In-process equality checks (booleans only):
    - the committed `ENCRYPTION_KEY` **equals** the `ENCRYPTION_KEY` in the
      current local `.env` and `apps/api/.env`;
    - the committed `JWT_SECRET` **equals** the current local `apps/api/.env`
      `JWT_SECRET`, which is also under 32 chars (fine for development only;
      it would fail the production check);
    - the committed Google OIDC client id/secret do **not** match the current
      ones.
  - Runtime impact today: `APP_ENC_KEY` is set and takes precedence over
    `ENCRYPTION_KEY` in `lib/crypto.js`, so the committed key is a fallback,
    not the active key, in the current local env.
  - **Required owner actions (not performed by this task):**
    1. In Google Cloud Console, delete or rotate the secret of the OAuth client
       whose id appears in `.env_bak`, even though it is no longer the current
       client.
    2. Never use the committed `ENCRYPTION_KEY` or `JWT_SECRET` values in any
       deployed environment. Remove the `ENCRYPTION_KEY` line from local env
       files once `APP_ENC_KEY` is confirmed as the only key in use.
    3. ~~Remove the file from tracking and widen `.gitignore`.~~ **Done in
       S2-32.1** (see "S2-32.1 Secret Containment"). This does not clean history.
    4. Decide whether to purge history (for example `git filter-repo`). Rotation
       is still required either way: the file is already public.

- **B2. Atlas is not usable.** The old credential was exposed in a session
  transcript (S2-31.3) and must be rotated. The configured SRV hostname returned
  NXDOMAIN. See section 3.

- **B3. There is no deployment target.** No staging/production host, domain,
  process-manager unit, or reverse proxy config exists in the repo or docs.
  Every URL in env files is localhost (S2-31.3 finding, re-confirmed). The smoke
  plan below cannot run until one exists.

### P1: must be fixed or explicitly accepted before public exposure

- **D1. Mongo URI password logged at startup (fixed in this task).**
  - `lib/mongo.js` `maskMongoUri` returned the **raw URI** whenever it could not
    parse it as a URL.
  - Multi-host URIs (`mongodb://<user>:<password>@h1:27017,h2:27017,...`) never parse.
    That is the standard non-SRV Atlas string and any self-hosted replica set.
  - The result: API, worker, and scheduler would all print the database password
    on the `[mongo] connecting to ...` line.
  - Reproduced with fake values: SRV form masked; multi-host form **leaked**.
  - Fix: the catch branch now redacts everything up to the last `@`. Verified
    with 5 fake-value assertions (see Verification).
  - S2-32.1 hardening: a wider fake-value probe found three inputs that still
    leaked: a leading space, a URI with no scheme (the URL parser accepted
    `user:` as a scheme, so the try branch returned it), and a newline in the
    userinfo. The try branch now rejects any parse that is not the expected
    scheme. The catch branch redacts before the last `@` whatever the scheme or
    whitespace. 10/10 credentialed fake cases are masked.

- **D2. Rate-limit IP key is client-spoofable.**
  - `getClientIdentity()` in `middleware/rateLimit.js` keys unauthenticated
    buckets (`auth` login, `oauth`) on the **first** `X-Forwarded-For` value.
  - That value is whatever the client sends. A reverse proxy appends the real
    IP, so it is never first. Rotating the header therefore bypasses the login
    brute-force limit in every topology.
  - Express `trust proxy` is not set either.
  - Not fixed here: the correct fix depends on the real proxy hop count (use
    `req.ip` with `app.set("trust proxy", <hops>)`). This needs a
    topology decision. Recommended follow-up: **S2-33**.

- **D3. `NODE_ENV=staging` leaks stack traces.**
  - There is no Express error handler, so Express's default handler shows stack
    traces whenever `NODE_ENV !== "production"`.
  - Probe: an unknown CORS origin returned `500` with a full stack trace
    (absolute server paths) under `NODE_ENV=staging`, and a generic `500` under
    `NODE_ENV=production`.
  - App code only distinguishes `development|test` from everything else, so
    **staging must run with `NODE_ENV=production`**.

- **D4. Unknown CORS origin returns `500`, not `403`, and logs a stack trace per
  request.**
  - The browser is still blocked: no `Access-Control-Allow-Origin` header is
    sent. Security holds, but the status is wrong and an unauthenticated prober
    can flood stderr.
  - The smoke checklist expects the current behavior (`500`, no ACAO header, no
    stack in the body).
  - Recommended follow-up: a small error handler mapping CORS rejection to
    `403` with a one-line log.

- **D5. Debug routes are mounted in every environment.**
  - Routes: `/api/v1/debug/google/status`, `/api/v1/debug/google/access`, and
    `POST /api/v1/debug/google/clear`.
  - They are authenticated and limited to the caller's own data, but:
    - `status` returns the **first 10 characters of the Google access token**;
    - `access` returns provider error bodies;
    - `clear` deletes the caller's Google integration.
  - This violates the no-token-output rule. Until a code task gates them, block
    `/api/v1/debug/` at the reverse proxy.

- **D6. Redis has no auth support.**
  - `lib/queues.js` (used by API, workers, and scheduler) reads only
    `REDIS_HOST`, `REDIS_PORT`, and `REDIS_TLS`. `REDIS_URL` and any
    password/username are ignored.
  - A managed Redis with `AUTH`/ACL cannot be used as-is. Phase 1 options:
    1. Redis on a private network or bound to localhost with no public port.
    2. A follow-up code task to accept `REDIS_URL` or `REDIS_PASSWORD`.
  - The API also needs Redis, because route modules create BullMQ queues on
    import.
  - `maxRetriesPerRequest: null` means enqueue calls wait instead of failing
    while Redis is down. This is unverified live; observe it in the smoke.

- **D7. A web build bakes whatever `apps/web/.env.local` says.**
  - Vite loads `.env.local` in build mode too. The current
    `apps/web/dist` bundle contains `http://127.0.0.1:5050` (2 occurrences).
  - A production build on a machine where `npm run dev:prepare` ran would ship a
    bundle that calls localhost.
  - Build with `VITE_API_BASE_URL` exported in the shell (shell env wins over
    `.env*` files), on a clean checkout with no `apps/web/.env*`.

- **D8. Google Connect falls back to localhost and puts the app JWT in the URL.**
  - `GoogleConnect.jsx` uses `VITE_API_BASE_URL || VITE_API_BASE ||
    "http://localhost:5050"`. A same-origin deploy that leaves
    `VITE_API_BASE_URL` empty works for `apiClient.js` (relative `/api/v1`), but
    **breaks Google Connect**.
  - It navigates to `.../integrations/google/start?t=<app JWT>`. The token lands
    in browser history and reverse-proxy access logs.
  - Mitigation now: always set `VITE_API_BASE_URL` to the public API origin, and
    exclude query strings from access logs for `/api/v1/integrations/google/start`.
  - Follow-up: replace the query token with a short-lived one-time code (an
    auth-behavior change, so out of scope here).

- **D9. Env-file fallback on deploy hosts.**
  - `startup/env.js` fills any **missing or blank** variable from
    `apps/api/.env.local`, then `<repo>/.env`, then `apps/api/.env`.
  - `config.js` also calls `dotenv.config()` (cwd `.env`), and `lib/mongo.js`
    searches upward for `.env` when no Mongo variable is set.
  - On a deploy host, any leftover file in the checkout therefore silently
    supplies values the process manager forgot. The worst cases are a stale
    `.env.local` setting localhost `CORS_ORIGINS`/`APP_URL`/`PORT`, or a dev
    `MONGODB_URI`.
  - Rule: deploy hosts have **no `.env*` files inside the repo checkout**. The
    environment comes from a process-manager env file outside the repo (mode
    `0600`, owned by the runtime user), and every required variable is set
    explicitly.

### P2: known gaps to accept and track

- **G1. Uploads are not durable.** `/uploads` is served from
  `process.cwd()/uploads`; with `npm run -w @parametrics/api start` that is
  `apps/api/uploads`, inside the checkout. A fresh checkout on redeploy loses
  uploaded media. Point it at persistent disk (for example a symlink to
  `/var/lib/parametrics/uploads`) until a storage task exists.
- **G2. `.env.example` is stale.** It uses `CORS_ORIGIN` (the code reads
  `CORS_ORIGINS`) and lacks `MONGODB_URI`, `APP_ENC_KEY`, `REDIS_HOST/PORT/TLS`,
  `REPORT_STORAGE_LOCAL_DIR`, and `OPENAI_API_KEY`. Do not build a production env
  from it; use section 2. The root `.env` also uses the ignored `CORS_ORIGIN`
  name.
- **G3. Health is liveness only.** `GET /api/v1/health` checks neither Mongo nor
  Redis. Readiness has to be proven by a real login (section 6).
- **G4. Logout is client-side only.** JWTs last `7d`, are stored in
  `localStorage`, and cannot be revoked server-side. A copied token stays valid
  after logout until it expires. This is the current, documented behavior.
- **G5. Mongo connection failure crashes startup without a clean message.**
  `ensureIndexes().then(...)` has no `.catch`. An unreachable DB becomes an
  unhandled rejection that exits the API (fail-fast, but noisy), and the process
  manager will restart-loop.
- **G6. Rate limits are in-memory.** They reset on restart and are multiplied by
  cluster/multi-instance mode. Run **one API process** (fork mode) in Phase 1.
- **G7. `docker-compose*.yml` is dev-only.** It publishes Redis `6379`, Mongo
  `27017`, and mongo-express `8081` on all interfaces with no auth. Never run it
  on a public host.
- **G8. The Atlas cluster hostname is in tracked public proof docs.** Six tracked
  proof docs (S2-04.1, S2-22.1 through S2-25.1, S2-29.1) contain the real
  `cluster0.<id>.mongodb.net` hostname. Credentials there are masked
  (`***:***@`). A hostname is not a credential, but it removes obscurity, so the
  rotated password must be strong and the IP allowlist must be tight. Past proofs
  were not rewritten (out of scope).
- **G9. Download filenames fall back when cross-origin.** The API does not set
  `Access-Control-Expose-Headers: Content-Disposition`, so a cross-origin web app
  cannot read the server filename. `reportHistory.js` then falls back to
  `report-<runId>.<format>`. The file is still correct, but only a real browser
  shows this; tests cannot.
- **G10. Workers and scheduler have no graceful shutdown** (already documented in
  `docs/runtime/processes.md`).

## 1. Current State vs Target State

Current state (true today):

- Code at `c951afe` passes API `232/232`, web `84/84`, and the web build.
- All live smokes so far ran on **local** MongoDB and localhost ports. Real-account
  login and real org data have **never** been verified in this sprint
  (S2-31.3).
- There is no staging or production host, domain, TLS, reverse proxy,
  process-manager unit, or deploy script in the repo.
- Atlas is unreachable (NXDOMAIN) and its credential needs rotation.
- Report storage is local disk, rate limiting is in-memory, and report generation
  is synchronous.

Target state (for the first real deployment, not yet true):

- One staging host with HTTPS, a reverse proxy, and three process-manager services
  (API, workers, scheduler) plus static web hosting.
- A rotated Atlas credential, a resolving hostname, and a tight IP allowlist.
- Every required env var set explicitly, outside the repo.
- Sections 6 through 9 executed and recorded in a follow-up live proof (for
  example S2-32.1).
- P0 blockers B1 through B3 resolved, and D2 through D9 fixed or explicitly
  accepted.

Out of scope and still future: cloud object storage, distributed rate limiting,
queued report generation, scheduled reports or email, email invitations, and
Phase 2 providers.

## 2. Required Production/Staging Environment Variables

Values are never written here. "Req" columns: **A** = API, **W** = workers,
**S** = scheduler, **B** = web build time.

| Variable | A | W | S | B | Rule / failure if wrong |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | yes | yes | yes | – | Use **`production`** on staging and production (D3). Anything other than `development`/`test` enables strict checks. |
| `PORT` | yes | – | – | – | API listen port. Defaults to `5050`. Bind behind the reverse proxy; do not expose it publicly. |
| `VITE_API_BASE_URL` | – | – | – | yes | Public API origin with no trailing slash and no `/api/v1`. Must be exported in the build shell (D7). It is needed even with a same-origin proxy, because of Google Connect (D8). |
| `JWT_SECRET` | yes | yes | yes | – | At least 32 chars and not a placeholder, or startup fails. Fresh value; never one from any committed file (B1). Same value in all three roles. |
| `APP_ENC_KEY` | yes | yes | – | – | 32-byte key (base64 or 64 hex); passphrases are scrypt-derived. Fresh value (B1). **Never change it after go-live without a migration:** existing encrypted Google integrations would become undecryptable and users would have to reconnect. Do not also set `ENCRYPTION_KEY`. |
| `MONGODB_URI` | yes | yes | yes | – | Rotated credential only (section 3). URL-encode special characters in the password. |
| `MONGO_DB` | yes | yes | yes | – | Database name. Defaults to `parametrics`; set it explicitly so a typo can't create a new empty DB. |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_TLS` | yes | yes | yes | – | No password support (D6). Private network only. `REDIS_URL` is **ignored** by queues. |
| `CORS_ORIGINS` | yes | – | – | – | Comma-separated exact web origins (`https://app.<domain>`). Required, or startup fails; `*` is rejected. |
| `APP_URL` | yes | – | – | – | Public web origin used for Google login redirects. Defaults to localhost if unset. |
| `REPORT_STORAGE_LOCAL_DIR` | yes | – | – | – | See section 5. Startup fails fast if it is missing or unsafe. |
| `OPENAI_API_KEY` | – | yes | – | – | Needed by the `post-generate` worker. Optional `OPENAI_*_MODEL` overrides. |
| `GOOGLE_OIDC_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | yes | – | – | – | Google sign-in. The redirect URI defaults to `http://localhost:<PORT>/api/v1/auth/google/callback`; set it to `https://<api>/api/v1/auth/google/callback` and register that exact URI in Google Cloud. |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | yes | yes | – | – | GBP integration OAuth. Workers need id/secret to refresh tokens. Register the production redirect URI. |
| `GOOGLE_POST_CONNECT_REDIRECT` | yes | – | – | – | Web URL to return to after Google Connect. |
| `RATE_LIMIT_*` | opt | – | – | – | Defaults are documented in `docs/runtime/processes.md`. Leave them unset unless intentionally tuned. |

Unsafe or misleading values to reject:

- Anything copied from `apps/api/.env_bak` (B1) or `.env.example` names (G2).
- `CORS_ORIGIN` (singular, ignored).
- `REDIS_URL` alone (ignored).
- Any `localhost`/`127.0.0.1` URL.
- `NODE_ENV=staging`.

## 3. Atlas Security Requirement

Status: **NOT READY.** Do not attempt a real Atlas login until every box is
checked by the owner.

- [ ] The Atlas DB user password exposed in S2-31.3 tool output is **rotated**,
  and the user confirms it. Prefer a new DB user with least privilege
  (`readWrite` on the app database only) and delete the old one.
- [ ] **Do not reuse the old password anywhere**, including the local
  `apps/api/.env`, backups, or the rollback env (section 10).
- [ ] The cluster exists (resumed, restored, or replaced), and its **current**
  hostname resolves from the deployment host:
  `dig +short SRV _mongodb._tcp.<cluster-host>` returns records. NXDOMAIN means
  stop.
- [ ] The Atlas Network Access allowlist contains the deployment host's egress IP
  (and the developer IP only if needed, temporarily). **Never `0.0.0.0/0`** (G8).
- [ ] The new URI exists only in the process-manager env file outside the repo
  (mode `0600`). It is never in docs, proofs, shell history, or the terminal.
  Check presence with booleans only:
  `node -e 'console.log(!!process.env.MONGODB_URI)'`.
- [ ] The first API start against Atlas logs `[mongo] connecting to
  mongodb+srv://***:***@...` with masked credentials (the D1 fix covers
  multi-host URIs too).
- [ ] TLS is on (the Atlas default; do not add `tls=false`).

## 4. Runtime Process Checklist

Start order: Redis and Mongo reachable → API → workers → scheduler → web.
Stop order for incidents: **scheduler first**, then workers, then API. Stopping
the scheduler first stops new posts from being moved to `queued` while no worker
consumes them.

API (`npm run -w @parametrics/api start`, cwd = repo root):

- [ ] Exactly **one** instance (G6); not in cluster mode.
- [ ] Startup log shows `JWT_SECRET set = true` and `APP_ENC_KEY set = true`,
  `report_storage provider=local configured=true production=true
  root=<persistent-root>/<basename>`, and `API listening`.
- [ ] No `.env*` files in the checkout (D9). The `[env] loaded files: []` line
  should list nothing.
- [ ] Bound behind a reverse proxy with TLS. `/api/v1/debug/` blocked at the proxy
  (D5). Query strings dropped from access logs for the Google start path (D8).
- [ ] Persistent `uploads` directory (G1).

Web (static hosting):

- [ ] Built on a clean checkout with `VITE_API_BASE_URL` exported (D7). Then
  `grep -c "127.0.0.1\|localhost:5050" dist/assets/*.js` prints `0` for every
  file.
- [ ] SPA fallback: unknown paths (`/organization-members`, `/reports/history`,
  `/login`) serve `index.html` with status 200.
- [ ] `index.html` uses `Cache-Control: no-cache`; hashed `assets/*` may be
  long-cache.

Worker (`npm run -w @parametrics/api start:workers`):

- [ ] Same `JWT_SECRET`, `APP_ENC_KEY`, Mongo, Redis, Google, and OpenAI env as
  documented.
- [ ] Registered workers: `post-generate`, `post-publish`, `review-sync` only.
- [ ] Grace period configured in the process manager (G10).

Scheduler (`npm run -w @parametrics/api start:scheduler`):

- [ ] Exactly one instance. Two schedulers would poll in parallel; the atomic
  status update limits duplicates, but this is not intended.
- [ ] Starts only after a worker is running.

Redis/BullMQ:

- [ ] Reachable from all three roles on a private network, with no public port and
  no auth (D6). `redis-cli -h <host> -p <port> ping` returns `PONG` from the
  app host.
- [ ] Persistence (AOF/RDB) is enabled if queued jobs must survive a Redis
  restart.

MongoDB:

- [ ] Section 3 is complete. `ensureIndexes()` succeeded: `API listening` is
  logged, and there is no unhandled rejection (G5).

## 5. Report Storage Checklist

Startup enforces most rules (S2-28). Verify the rest by hand.

- [ ] `REPORT_STORAGE_LOCAL_DIR` is absolute (enforced:
  `report_storage_config_relative_root`). Recommended:
  `/var/lib/parametrics/report-outputs`.
- [ ] Owned by and writable for the API runtime user, mode `0750`, not
  world-writable (writability is enforced: `report_storage_config_not_writable`;
  ownership and mode are not).
- [ ] Outside the repo (enforced: `report_storage_config_inside_repo`) and not
  `/`, `/tmp`, or `/var/tmp` (enforced: `report_storage_config_blocked_root`).
- [ ] **Durable**: on persistent disk, not `tmpfs`, and not on a container's
  ephemeral filesystem (**not enforced**). Check with
  `df -T "$REPORT_STORAGE_LOCAL_DIR"`; the type must not be `tmpfs`/`overlay`
  unless it is a mounted volume. It is included in host backups.
- [ ] Survives redeploy: the directory is not recreated by the deploy script.
- [ ] No absolute path is exposed. The startup log shows only
  `<persistent-root>/<basename>`, and API responses never include it (check in
  section 8).
- [ ] Single host only: multiple API hosts would not share the directory (cloud
  storage is future work).

## 6. Real-Account Login Smoke Checklist

Preconditions: section 3 is complete, the API is running against the real DB, and
the web build points at that API.

Set once per shell. Origins only; never paste tokens or passwords into commands:

```bash
export PM_API="https://api.<your-domain>"   # no trailing slash
export PM_WEB="https://app.<your-domain>"
```

- [ ] API is up: `curl -sS -o /dev/null -w "%{http_code}\n" "$PM_API/api/v1/health"` prints `200`.
- [ ] API is on the real DB: the startup log shows the rotated host with masked
  credentials. Do not print the URI.
- [ ] The web points at the right API: in the browser DevTools Network tab, the
  login request goes to `$PM_API/api/v1/auth/login`, not localhost.
- [ ] The **user types** their real email and password into `/login`. The form
  starts empty (S2-31.3). Nobody pastes credentials into a terminal or a doc.
- [ ] Login succeeds and the dashboard loads the real organization(s).
- [ ] Nothing sensitive is printed: no token, password, or email in the browser
  console, the API logs (`grep -ciE "bearer|password|eyJ" <api-log>` prints
  `0`), or the proof.
- [ ] Logout: clicking Logout returns to `/login`; DevTools → Application →
  Local Storage has no auth token; reloading a protected page redirects to
  `/login`. A copied token remains valid server-side until expiry (G4); record
  this, it is expected.
- [ ] Google sign-in (if used): the redirect goes to the registered production
  callback and returns to `APP_URL`, not localhost.

## 7. Organization Members Smoke Checklist

Run in a browser as an **owner/admin** of a real org, with a second known real
user who is not yet a member. Record only display names or short ids in the
proof, never emails.

- [ ] `/organization-members` loads directly (SPA fallback) and from the nav.
  Check the mobile width too: S2-31.2 found the mobile nav has no Members link,
  so record the result.
- [ ] The member count header and rows show display names and masked emails. No
  raw email appears anywhere on the page.
- [ ] Search the candidate (2 or more chars): the candidate appears with an
  already-member badge where applicable; already-member rows are disabled.
- [ ] Add is disabled until a candidate is **selected**. Editing the search
  clears the selection. Add the selected candidate with role `viewer`; the
  success copy names the user and role, and the row count goes up by 1.
- [ ] Fake user rejected: Advanced → manual `user_id` with a made-up id
  (`definitely-not-real-s2-32-user`) returns `user_not_found`, and the row count
  is unchanged.
- [ ] Disable: the confirm dialog reads "Disable membership for <name>? This does
  not delete the user." Confirm, and the row shows disabled. Your own row cannot
  be disabled.
- [ ] Cleanup: leave the test member disabled, or restore it per the org owner's
  wishes. There is no delete route.
- [ ] `location_org_map` unchanged (count before equals count after; owner-run
  read-only query, counts only).

## 8. Report Smoke Checklist

- [ ] Generate: from the dashboard of a real location, generate PDF and XLSX.
  Both download in the browser.
- [ ] List: `/reports/history` shows the new run, `succeeded`, with two outputs.
- [ ] Download PDF and XLSX from history. Files open correctly. Record whether the
  filename is the server filename or the `report-<runId>.<format>` fallback
  (G9, browser-only).
- [ ] Server-side artifact exists (on the API host, as the API user; prints
  counts and sizes only):

  ```bash
  sudo -u <api-user> find "$REPORT_STORAGE_LOCAL_DIR" -type f -mmin -15 -printf '%s\n' | sort -n
  ```

  This should show at least 2 recent files, with sizes matching the outputs in
  history.
- [ ] The client never sees the storage path. In DevTools, the
  `/api/v1/reports/runs` response contains no `/var/`, `/tmp/`, `/home/`, or
  `/srv/` path, and `path` is `null`. The history page never renders
  `storage_key`.
- [ ] Restart the API, then download again. It still works, which proves
  durability across restarts.

## 9. Security Smoke

Run from a workstation against staging. Status codes and header names only.

```bash
# CORS: unknown origin is rejected (current behavior: 500, no ACAO header; D4)
curl -sS -o /dev/null -D - -H "Origin: https://evil.example.invalid" \
  "$PM_API/api/v1/health" | grep -iE "^HTTP/|^access-control-allow-origin"
# expect: HTTP/... 500 and NO access-control-allow-origin line

# ...and the body carries no stack trace (requires NODE_ENV=production; D3)
curl -sS -H "Origin: https://evil.example.invalid" "$PM_API/api/v1/health" | grep -c "node_modules"
# expect: 0

# CORS: allowed origin preflight
curl -sS -o /dev/null -D - -X OPTIONS -H "Origin: $PM_WEB" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  "$PM_API/api/v1/auth/login" | grep -iE "^HTTP/|^access-control-allow-origin"
# expect: 204 and access-control-allow-origin equal to $PM_WEB

# Unauthenticated protected routes return 401
for p in /api/v1/orgs /api/v1/reports/runs /api/v1/orgs/x/member-candidates?search=ab; do
  printf "%s " "$p"; curl -sS -o /dev/null -w "%{http_code}\n" "$PM_API$p"; done
# expect: 401 for each

# Debug routes are blocked at the proxy (D5)
curl -sS -o /dev/null -w "%{http_code}\n" "$PM_API/api/v1/debug/google/status"
# expect: 403/404 from the proxy (401 means the route is still reachable)
```

Membership denied returns a safe 403. Use your own token: read it silently from
DevTools Local Storage. It is never echoed and never stored in history.

```bash
read -rs PM_TOKEN   # paste, press Enter; nothing is shown
curl -sS -H "Authorization: Bearer $PM_TOKEN" \
  "$PM_API/api/v1/orgs/<org-id-you-are-not-a-member-of>/members" -w "\n%{http_code}\n" \
  | grep -oE '"code":"[a-z_]+"|^[0-9]{3}$'
# expect: "code":"organization_membership_required" and 403; no user/org data in body
unset PM_TOKEN
```

Rate limits still work:

- Login bucket: 10 per 10 minutes per IP. This **locks login from your IP for
  10 minutes**, so run it last or from a throwaway IP.

  ```bash
  for i in $(seq 1 11); do curl -sS -o /dev/null -w "%{http_code} " -X POST \
    -H "Content-Type: application/json" -d '{"email":"nobody@example.invalid","password":"x"}' \
    "$PM_API/api/v1/auth/login"; done; echo
  # expect: ten 401s then 429
  ```

- D2 confirmation (expected to show the bypass until S2-33): repeat with
  `-H "X-Forwarded-For: 203.0.113.$i"`. If all 11 return `401`, the bypass is
  confirmed. Record it as an accepted risk or a blocker.
- Report buckets were already proven live in S2-29.1 (`200/200/429` with low
  overrides). On staging, do not lower limits; one list and one download returning
  `200` with `X-RateLimit-Limit` headers present is enough.

## 10. Rollback Plan

- **Before every deploy:**
  - Record the running commit (`git rev-parse --short HEAD`).
  - Back up the process-manager env file to a root-only location outside the repo
    (`cp -p <env-file> <backup-dir>/env.$(date +%F-%H%M)`, mode `0600`).
  - Back up the report storage directory if the release touches report code.
- **Revert code:**
  1. Stop the **scheduler**, then the workers, then the API.
  2. `git checkout <previous-commit>`, then `npm ci` (lockfile unchanged
     between releases means identical deps).
  3. Rebuild the web with the same `VITE_API_BASE_URL`.
  4. Start the API, then the workers, then the scheduler.
  5. Re-run the section 6 health, login, and logout checks.
- **Restore env from backup:** only from a backup taken **after** the Atlas
  rotation. **Never restore an env file that contains the old exposed Atlas
  password**; destroy any such backup. Keep `APP_ENC_KEY` identical across
  rollback, or encrypted Google integrations break.
- **Queue jobs failing:**
  1. Stop the scheduler first, so no more posts move to `queued`.
  2. Stop the workers, and leave the API up.
  3. Jobs stay in Redis; posts already `queued` stay `queued`. Inspect with
     counts only: `redis-cli -h <host> llen bull:post-publish:wait`, plus the
     `zcard` of the `bull:post-publish:failed` key.
  4. Resume the workers only after the cause is fixed.
- **Report storage:** never delete `REPORT_STORAGE_LOCAL_DIR` on rollback. Old
  `report_runs` rows reference files there.
- **Data:** no S2-32 change mutates data. Org/member smoke mutations (one test
  membership) are reversed by disabling it.

## 11. Remaining Risks

- **Open P0 blockers B1 through B3:** the committed secrets file (untracked in
  S2-32.1, but still in public git history and not yet rotated), the unusable
  Atlas cluster, and the missing deploy target.
- **Open P1 items D2 through D9:** spoofable rate-limit key, staging stack traces
  (mitigated by `NODE_ENV=production`), CORS `500`, debug routes, Redis without
  auth, build-time API URL, JWT in the Google Connect URL, and env-file fallback.
  D1 is fixed.
- **Open P2 gaps G1 through G10:** uploads durability, stale `.env.example`,
  liveness-only health check, client-only logout, noisy Mongo-failure crash,
  in-memory rate limits, dev-only compose, public Atlas hostname, cross-origin
  filename fallback, and no graceful shutdown.
- **Never run in this sprint:** a real-account login, and any test of worker or
  scheduler jobs against real Google/OpenAI.
- **Browser-only checks:** these cannot be proven by unit tests and need a real
  browser on the real deployment:
  - SPA deep links;
  - download filenames;
  - the mobile Members nav;
  - logout storage clearing;
  - the Google OAuth redirect round-trip;
  - CORS from the real web origin.

Recommended follow-up tasks (each needs explicit approval):

- **S2-33:** rate-limit client identity with a configured `trust proxy` (D2),
  plus an error handler that maps CORS rejection to `403` without stack logs
  (D3/D4).
- **S2-34:** gate debug routes outside development (D5); add `REDIS_URL`/password
  support (D6).
- **S2-35:** Google Connect without a JWT in the query (D8). This is an
  auth-behavior change.
- **S2-32.1:** execute sections 6 through 9 on staging and record a live proof.

## S2-32.1 Secret Containment

Task: S2-32.1 (P0). Containment only: no history rewrite, no Atlas contact, no
deploy, no dependency change. No secret value was printed or written here.

- **Exposure:** `apps/api/.env_bak` was tracked in the **public** repository
  from the Initial Commit (`5bca4b0`) until this change (B1).
- **Removed from tracking:** `git rm apps/api/.env_bak`. The file is deleted
  from the working tree and the index; `git ls-files apps/api/.env_bak` now
  returns nothing. A local copy was moved outside the repo first, into a
  `0700` directory with a `0600` file. It was compared byte-for-byte without
  printing anything.
- **`.gitignore` widened** so this cannot recur:
  - New patterns: `.env*`, `.env_bak`, `.env*.bak`, `*.env`, `*.env.*`,
    `*.env_bak`, `*_env`, `*_env_bak*`. The existing `.env` and `.env.*` remain.
  - The requested `*_env*` and the tried `*_env.*` were **not** used. They also
    ignore legitimate source names such as `process_env.js`, checked with
    `git check-ignore --no-index`. The narrower `*_env` / `*_env_bak*` cover
    the backup shapes.
  - Verified ignored: every local `.env*` file in `apps/api`, `apps/web`, and the
    repo root, plus fake backup names `x/.env.bak`, `x/prod.env`,
    `x/prod.env.old`, `x/old.env_bak`, `x/api_env`, and `x/old_env_bak.txt`.
  - Verified not ignored: `apps/api/src/startup/env.js`,
    `docs/test_environment.md`, and `src/process_env.js`.
  - Tracked files matching ignore rules: `0`.
  - `.env.example`: the repo tracks no example env file. `apps/api/.env.example`
    is local-only and was already ignored by `.env.*`. It stays ignored; no
    `!.env.example` exception was added, because the file is stale (G2) and
    has not been reviewed for real values.
- **This does not remove the secrets from git history.** Every value in the
  file is still readable in public history at `5bca4b0` and in any clone or fork
  made since. Treat every value as compromised.
- **External rotation is still mandatory** (owner actions; not performed here):
  - **Google OAuth:** rotate the client secret of the OAuth client whose id
    appears in the old file, or delete that client in Google Cloud Console.
  - **`JWT_SECRET` / `APP_ENC_KEY` / `ENCRYPTION_KEY`:** never reuse any
    committed or current local value in a deployed environment. Generate fresh
    values per environment. The committed `JWT_SECRET` and `ENCRYPTION_KEY`
    match current local dev values, so rotate those locally too.
  - **Atlas DB password:** it was exposed earlier (S2-31.3 tool output; B2)
    and must be rotated before any Atlas use. The section 3 gate still applies.
- **History purge and repository visibility:** whether to rewrite history (for
  example `git filter-repo`/BFG, then a force-push) or make the repository
  private is a management/security decision, outside this task. Rotation is
  required either way.
- **Secret scan (before commit):** the changed files, `git diff`, and
  `git diff --cached` were scanned. Checks: credentialed `mongodb(+srv)://`
  and `<scheme>://<user>:<pass>@` URIs; non-placeholder assignments to
  `GOOGLE_*CLIENT_SECRET`, `JWT_SECRET`, `APP_ENC_KEY`, `ENCRYPTION_KEY`, and
  `OPENAI_API_KEY`; `access_token` / `refresh_token` values; `sk-` keys;
  `GOCSPX-` client secrets; `eyJ` JWTs; `-----BEGIN ... PRIVATE KEY`; and raw
  `KEY=value` env lines. Only pass/fail and file paths were printed. The
  result is in the S2-32.1 Verification section.

## 12. GPT Decision

Pending.

## Verification (S2-32)

- `node --check apps/api/src/lib/mongo.js` passes.
- `maskMongoUri` fake-value assertions: **5/5 pass**.
  - SRV and multi-host forms are both masked, including a percent-encoded `@` in
    the password.
  - Credential-free single-host and multi-host URIs are unchanged.
  - No fake user or password appears in any output.
- `cd apps/api && npm test`: `tests 232 / pass 232 / fail 0 / skipped 0`.
- `cd apps/web && npm test -- --run`: `Test Files 6 passed (6) / Tests 84 passed (84)`.
- `cd apps/web && npm run build`: `288 modules transformed`, built OK. The
  pre-existing Browserslist warning is unchanged.
- CORS probe: a throwaway in-process Express app on an ephemeral port, using the
  real `createCorsOptions`, under `NODE_ENV=staging` and `production`. This gave
  the D3/D4 results. No app server, worker, or scheduler was started; no DB was
  touched.
- Secrets handling: env files were read as key names, lengths, shape flags, and
  equality booleans only. The history scan printed counts and classes only. No
  value of any secret, URI, token, or email was printed.
- `git diff --check` is clean, and the `package.json` / `package-lock.json` diff
  is empty (see the final report).
- **No commit or push was performed.**

## Verification (S2-32.1)

- `git ls-files apps/api/.env_bak` returns nothing. The deletion is staged.
- `git ls-files -c -i --exclude-standard` returns `0` (no tracked file matches the
  new ignore rules).
- `node --check apps/api/src/lib/mongo.js` passes.
- `maskMongoUri` fake-value probe: **10/10 credentialed cases masked**: SRV,
  single-host, multi-host, percent-encoded `@`, raw `@` in the password,
  leading whitespace, an uppercase scheme, no scheme, a newline in the userinfo,
  and user-only. Credential-free multi-host is unchanged; a non-string input
  returns a string.
- Secret scan (added lines in `git diff --cached` and `git diff`, plus the full
  staged content of every changed file): **pass**. The only hit was the
  placeholder `<scheme>://<user>:<pass>@` text in this section, which was
  rewritten so it no longer matches.
- Every value from the removed file, compared in-process against all 194 tracked
  files: **no secret value appears in tracked content**. Five values do appear;
  each one is a localhost-only URL or host with no credentials (`APP_URL`,
  `APP_PUBLIC_API_BASE`, `REDIS_HOST`, `GOOGLE_POST_CONNECT_REDIRECT`, and a
  local `MONGODB_URI`). No JWT secret, encryption key, or Google client
  id/secret value appears.
- `cd apps/api && npm test`: `tests 232 / pass 232 / fail 0 / skipped 0`.
- `cd apps/web && npm test -- --run`: `Test Files 6 passed (6) / Tests 84 passed (84)`.
- `cd apps/web && npm run build`: `288 modules transformed`, built OK.
- `package.json` / `apps/*/package.json` / `package-lock.json` diff: empty.
- `git diff --check` and `git diff --cached --check`: clean.
