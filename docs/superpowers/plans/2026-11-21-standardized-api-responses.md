# Standardized API Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize every applicable ParaMetrics JSON response and migrate both frontends to the exact same envelope without changing business behavior or special-response semantics.

**Architecture:** Add explicit response builders and an importable Express application boundary, then migrate backend route families in dependency order. Update the Axios and Fetch boundaries before migrating their consumers, preserving binary, redirect, cookie, cancellation, cache, authentication-expiry, and Google-reauth behavior.

**Tech Stack:** Node.js 20+, Express 4, Node test runner, Axios, Fetch, React 19, Vitest, Vite

**Spec:** `docs/superpowers/specs/2026-11-21-standardized-api-responses-design.md`

## Global Constraints

- Start from `main` at `ea0788bce1c0c3c4a08b54142a3b73f75e75f8d8` on `refactor/standardize-api-responses`.
- Carry forward the approved edits in `apps/client/src/hooks/useApi.js` and `apps/client/src/pages/private/Reviews.jsx`.
- Do not check out, rebase, merge, reset, or modify `feat/automatic-google-post-sync` at `c3c5de1321e396e2bda8e98619637f7b802f3262`.
- Applicable JSON successes have exactly `statusCode`, `data`, `message`, and `success: true`; applicable JSON failures have exactly `statusCode`, `message`, `success: false`, and non-empty `errors`.
- Preserve HTTP statuses and every application-authored error code verbatim; normalize only missing or unexpected internal codes to `server_error`.
- Public error messages must be ParaMetrics-authored validation or business messages. Never expose raw provider, MongoDB, filesystem, HTTP-library, stack, credential, or unexpected exception data.
- Permit error `details` only for Google `{ provider: "google", reason }` with the four approved reasons and rate limiting `{ retryAfterSeconds }` with a positive integer.
- Application auth expiry is only HTTP 401 plus code `unauthorized` or `invalid`, excluding login and session probes. Google provider failures never expire the application session.
- Do not wrap redirects, binary or streaming bodies, static files, CORS preflight, 204/304 responses, or required third-party acknowledgements.
- Preserve `/api/v1`, business logic, schemas, permissions, OAuth behavior, cookie behavior, stale-response guards, and user-visible UI behavior.
- Do not add Phase 3 automatic post synchronization or unrelated refactors.
- Do not commit, push, merge, deploy, or update production automatically. Leave all implementation changes uncommitted for review.
- Update the canonical Google Drive PRD only after local implementation evidence is complete.

## Review Focus

- A raw upstream exception containing tokens or provider response bodies must produce a safe `server_error` envelope; Task 2 adds explicit redaction tests.
- A Google 401/403 or `reauth_required` response must trigger reconnect handling without logging the ParaMetrics user out; Tasks 9 and 11 test this distinction.
- A 204, OAuth redirect, PDF/XLSX download, or multipart upload must retain its original transport semantics; Tasks 3, 5, 8, 9, and 11 cover these cases.
- Cached legacy v1 raw payloads must never reach migrated consumers while v2 stale fallback and request deduplication still work; Task 11 tests invalidation and cache behavior.
- An old frontend asset paired with the new backend is incompatible; Task 13 documents and verifies atomic deployment and atomic rollback requirements.

---

### Task 1: Establish the branch and audited response inventory

**Files:**
- Create: `docs/proof/standardized-api-response-inventory.md`
- Preserve: `apps/client/src/hooks/useApi.js`
- Preserve: `apps/client/src/pages/private/Reviews.jsx`

**Interfaces:**
- Consumes: approved design and current router registrations under `apps/api/src/server.js` and `apps/api/src/routes/`
- Produces: a row for every response-writing branch with method/path, old shape/status, target payload/message, consumer, test, and classification

- [ ] **Step 1: Verify the starting references and approved dirty files**

Run: `git status --short && git rev-parse HEAD && git rev-parse feat/automatic-google-post-sync`

Expected: HEAD is the approved main SHA, the Phase 3 SHA matches the constraint, and only the two approved client edits plus approved planning documents are dirty.

- [ ] **Step 2: Create and verify the implementation branch without discarding dirty work**

Run: `git switch -c refactor/standardize-api-responses`

Expected: `git branch --show-current` prints `refactor/standardize-api-responses`, and the approved edits remain in `git diff`.

- [ ] **Step 3: Enumerate every response site and reconcile it with mounted routers**

Search `res.json`, `res.status`, `res.send`, `res.end`, `res.redirect`, `res.download`, and `res.sendFile` in `apps/api/src`, then trace every router mount in the application entry point. Record every branch in the inventory; explicitly mark `.bak` files as non-runtime evidence rather than endpoints.

- [ ] **Step 4: Verify inventory completeness**

Run the response-site search again and account for every runtime match in an inventory row. Expected: no unclassified runtime response writer and no route whose frontend consumers/tests are blank without an explicit `none` explanation.

### Task 2: Build and pin the canonical response utility

**Files:**
- Create: `apps/api/src/utils/apiResponse.js`
- Create: `apps/api/src/utils/apiResponse.test.js`

**Interfaces:**
- Produces: `buildSuccess({ statusCode, data, message })`, `buildError({ statusCode, message, errors })`, `normalizeApiError(error, defaults)`, `sendSuccess(res, options)`, and `sendError(res, options)`
- Guarantees: exact top-level keys, HTTP/body status agreement, non-empty normalized errors, stable authored codes, and closed detail allowlist

- [ ] **Step 1: Write failing builder tests**

Add tests asserting exact key sets and defaults for 200 success, 201 success, payload-free JSON success, one validation error with `field`, and multiple errors. Assert an already-enveloped payload is rejected or treated as business data according to one documented no-nesting rule.

- [ ] **Step 2: Run the focused tests and confirm the utility is missing**

Run: `node --test apps/api/src/utils/apiResponse.test.js`

Expected: FAIL because `apiResponse.js` does not exist.

- [ ] **Step 3: Add failing security-normalization tests**

Cover preservation of authored codes, fallback `server_error`, all four Google reasons, rejection of unknown Google reasons, positive-integer retry timing, removal of arbitrary `error.data`, provider bodies, tokens, stack traces, database details, and raw library messages.

- [ ] **Step 4: Implement the pure builders and Express senders**

Implement the exported interfaces above. `sendSuccess` and `sendError` must set the HTTP status and send only the canonical body; normalization must copy only explicitly allowed fields.

- [ ] **Step 5: Run the focused tests**

Run: `node --test apps/api/src/utils/apiResponse.test.js`

Expected: PASS with all contract and redaction cases.

### Task 3: Create an importable Express application and HTTP contract harness

**Files:**
- Create: `apps/api/src/app.js`
- Modify: `apps/api/src/server.js`
- Create: `apps/api/src/app.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `sendSuccess` and `sendError` from Task 2
- Produces: `createApp(options)` that mounts production middleware/routes without listening, plus an executable `server.js` that performs startup validation/index work and calls `listen()`

- [ ] **Step 1: Write failing HTTP tests for application boundaries**

Using a real ephemeral listener, assert a representative JSON success envelope, unknown `/api/v1/...` standardized 404, unexpected standardized 500 with no raw message/stack, unchanged 204 bodylessness, unchanged non-API/static fallback, and middleware order.

- [ ] **Step 2: Run the focused HTTP tests**

Run: `node --test apps/api/src/app.test.js`

Expected: FAIL because the app cannot yet be imported independently.

- [ ] **Step 3: Extract `createApp(options)` without changing production order**

Keep configuration validation, index creation, process exit handling, and `listen()` in `server.js`. Put API-only unknown-route and final unexpected-error handlers after all `/api/v1` routes in `app.js`.

- [ ] **Step 4: Add the two new tests to the API test script and run them**

Run: `npm test -w @parametrics/api`

Expected: PASS, with existing startup and route behavior unchanged.

### Task 4: Standardize shared middleware and ownership errors

**Files:**
- Modify: `apps/api/src/services/ownership.js`
- Modify: `apps/api/src/middleware/auth.js`
- Modify: `apps/api/src/middleware/rateLimit.js`
- Modify: `apps/api/src/middleware/validateRequestOrigin.js`
- Modify: corresponding `*.test.js` files

**Interfaces:**
- Consumes: `sendError` and `normalizeApiError` from Task 2
- Produces: `toApiError(res, error, defaults)` that delegates to the canonical sender while retaining stable codes/statuses

- [ ] **Step 1: Change middleware tests to require canonical errors**

Assert exact envelopes for missing/invalid/expired sessions, forbidden membership, invalid origin, validation failures, and 429. Assert `Retry-After` is retained and `retryAfterSeconds` is the only rate-limit detail.

- [ ] **Step 2: Run the middleware tests and observe old-shape failures**

Run the auth, rate-limit, request-origin, organization-access, and organization-member test files with `node --test`.

- [ ] **Step 3: Migrate shared middleware and `toApiError`**

Use canonical senders at every JSON response branch. Log raw unexpected errors through existing logging paths and expose only safe route/status messages.

- [ ] **Step 4: Run the focused middleware/service tests**

Expected: PASS, including exact-code and redaction assertions.

### Task 5: Migrate authentication and Google integration routes

**Files:**
- Modify: `apps/api/src/routes/auth.js`
- Modify: `apps/api/src/routes/auth.google.js`
- Modify: `apps/api/src/routes/integrations.google.js`
- Modify: `apps/api/src/routes/integrations.google.extras.js`
- Modify: relevant route tests

**Interfaces:**
- Consumes: canonical senders and shared errors
- Produces: envelope-based login/session/integration JSON while preserving cookie, logout 204, OAuth redirect, and approved Google reconnect details

- [ ] **Step 1: Update/add failing route tests**

Assert login and session successes expose the user under `data.user`; invalid credentials keep their status/code; logout remains bodyless and clears cookies; OAuth redirects retain status/location/cookies; reconnect errors expose only provider plus allowlisted reason.

- [ ] **Step 2: Run focused auth/integration tests and confirm old-shape failures**

Run: `node --test apps/api/src/routes/auth.test.js apps/api/src/routes/integrations.google.extras.test.js`

- [ ] **Step 3: Replace only JSON writers with canonical senders**

Do not route redirect, cookie, or 204 behavior through JSON helpers. Add safe messages per inventory row.

- [ ] **Step 4: Run focused and complete API tests**

Run: `npm test -w @parametrics/api`

Expected: PASS with OAuth/session transport assertions intact.

### Task 6: Migrate organization, member, client, and location routes

**Files:**
- Modify: `apps/api/src/routes/orgs.js`
- Modify: `apps/api/src/routes/locations.js`
- Modify: `apps/api/src/routes/locationOrg.js`
- Modify: relevant route/service tests

**Interfaces:**
- Consumes: canonical senders and `toApiError`
- Produces: organization/member/client/location payloads under `data`, preserving permission and tenant scoping

- [ ] **Step 1: Update/add failing tests for list/detail/create/update/delete and access failures**

Assert arrays/pagination retain their business shape inside `data`, created responses keep 201, conflicts keep 409, validation keeps 422 and fields, forbidden keeps 403, and not-found keeps 404.

- [ ] **Step 2: Run focused route/service tests and confirm old-shape failures**

Run the locations, orgs, organization-access, organization-members, and location-binding test files with `node --test`.

- [ ] **Step 3: Migrate route response branches and update inventory rows**

Keep all ownership queries and authorization decisions unchanged; only replace serialization and safe message selection.

- [ ] **Step 4: Run focused tests**

Expected: PASS with unchanged scoping assertions.

### Task 7: Migrate post, synchronization, deletion, and recurrence routes

**Files:**
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/src/routes/recurrence.js`
- Modify: post/sync/deletion/detail/list/lifecycle tests under `apps/api/src/`

**Interfaces:**
- Consumes: canonical senders and stable lifecycle error codes
- Produces: post lists/details/actions and sync results under `data`, retaining multipart create behavior and atomic publishing/deletion protections

- [ ] **Step 1: Update/add failing route-level contract tests**

Cover list pagination, detail, create 201, direct/scheduled publish, edit, delete, retry, manual sync, conflict/reconciliation codes, multipart metadata, and validation. Assert no lifecycle error code or status changes.

- [ ] **Step 2: Run focused post tests and confirm old-shape failures**

Run the post list/detail/image/publish/deletion/sync/recovery/manual-sync suites with `node --test`.

- [ ] **Step 3: Migrate JSON response branches**

Do not alter job claiming, tombstones, Google-first deletion, image persistence, scheduler behavior, recurrence calculations, or MongoDB writes.

- [ ] **Step 4: Run focused post tests and complete API suite**

Run: `npm test -w @parametrics/api`

Expected: PASS.

### Task 8: Migrate reviews, reports, uploads, health, debug, and demo routes

**Files:**
- Modify: `apps/api/src/routes/reviews.js`
- Modify: `apps/api/src/routes/reports.js`
- Modify: `apps/api/src/routes/uploads.js`
- Modify: `apps/api/src/routes/health.js`
- Modify: `apps/api/src/routes/debug.js`
- Modify: `apps/api/src/routes/debug.google.js`
- Modify: `apps/api/src/routes/demo.js`
- Modify: relevant tests and `docs/proof/standardized-api-response-inventory.md`

**Interfaces:**
- Consumes: canonical senders
- Produces: canonical JSON metadata/error branches while preserving report bytes/headers, multipart uploads, static uploads, debug gating, and health statuses

- [ ] **Step 1: Add failing tests for remaining JSON and special responses**

Assert review/list/action envelopes; report metadata envelopes; byte-for-byte PDF/XLSX bodies plus content type/disposition/filename; canonical download errors; multipart upload metadata; static-file behavior; health/debug/demo envelopes; and protocol/bodyless exceptions.

- [ ] **Step 2: Run focused remaining-route tests**

Expected: failures only where JSON still uses legacy shapes.

- [ ] **Step 3: Migrate JSON branches and leave classified special responses untouched**

Every remaining runtime response-site search result must now be either a canonical sender or an inventory-documented exception.

- [ ] **Step 4: Reconcile the inventory and run the API suite**

Run: `npm test -w @parametrics/api`

Expected: PASS; inventory has no unclassified endpoint branch.

### Task 9: Migrate the Axios boundary and authentication failure detection

**Files:**
- Modify: `apps/client/src/services/api.service.js`
- Modify: `apps/client/src/services/authFailure.js`
- Modify: `apps/client/src/services/authFailure.test.js`
- Create: `apps/client/src/services/api.service.test.js`

**Interfaces:**
- Produces: JSON requests resolve to the envelope; HTTP failures reject the envelope; explicit blob/arraybuffer requests retain the Axios response; cancellation remains native; network failures reject the status-0 client envelope
- Produces: auth expiry detector operating on the original Axios error before transformation

- [ ] **Step 1: Write failing interceptor tests**

Cover JSON success, standardized HTTP rejection, status-0 network rejection, native cancellation, blob/arraybuffer preservation, and no accidental content-type guessing.

- [ ] **Step 2: Add the complete auth/provider decision table**

Assert only 401 plus `unauthorized`/`invalid` dispatches expiry; login/session probes, 403, missing code, message-only matches, code without 401, and Google reconnect failures do not. Assert Google reconnect metadata remains available to consumers.

- [ ] **Step 3: Run focused Vitest tests and confirm failures**

Run: `npm test -w client -- src/services/api.service.test.js src/services/authFailure.test.js`

- [ ] **Step 4: Implement the Axios interceptor contract**

Run auth detection first against the original error, then transform. Keep the status-0 envelope client-only and exclude diagnostics from its enumerable contract keys.

- [ ] **Step 5: Run focused client tests**

Expected: PASS.

### Task 10: Migrate all new-client services, hooks, contexts, and page consumers

**Files:**
- Modify: `apps/client/src/hooks/useApi.js`
- Modify: `apps/client/src/context/auth/AuthContext.jsx`
- Modify: `apps/client/src/context/auth/authState.js`
- Modify: `apps/client/src/pages/authentication/loginHelpers.js`
- Modify: `apps/client/src/utils/postDeleteUi.js`
- Modify: JSON consumer modules under `apps/client/src/services/`, `context/`, `pages/`, `components/`, and `utils/`
- Modify/create: corresponding Vitest tests

**Interfaces:**
- Consumes: Task 9 envelope-returning Axios boundary
- Produces: all business reads from `result.data`; errors read `statusCode`, `message`, and `errors[]`; `useApi` retains callback/handled-error semantics

- [ ] **Step 1: Inventory every Axios-service consumer and add/update failing tests by feature family**

Cover login/session/logout, organization/location switching, integrations, posts/pagination/create/edit/delete/retry/manual sync/image upload, reviews, notifications, and report metadata/downloads. Include stale-response/location-switch assertions where already present.

- [ ] **Step 2: Run the client suite and record the expected old-assumption failures**

Run: `npm test -w client`

- [ ] **Step 3: Migrate consumers feature-by-feature**

Read business payloads from `result.data`, retain binary consumers on the explicit Axios-response path, and replace nested legacy error reads. Preserve the approved response log in `useApi.js` and the `Sync Reviews` label/import edit.

- [ ] **Step 4: Search for legacy Axios shape assumptions**

Search for `response.data.data`, `error.response.data.error`, raw `res.user`, and direct nested legacy error objects. Expected: no runtime match except an explicitly documented binary/Axios diagnostic path.

- [ ] **Step 5: Run tests, lint, and build**

Run: `npm test -w client && npm run lint -w client && npm run build -w client`

Expected: all PASS.

### Task 11: Migrate the legacy Fetch boundary and cache

**Files:**
- Modify: `apps/web/src/apiClient.js`
- Modify: `apps/web/src/apiClient.test.js`
- Modify: `apps/web/src/hooks/useCachedApi.js`
- Create or modify: `apps/web/src/hooks/useCachedApi.test.js`

**Interfaces:**
- Produces: successful JSON returns the envelope; non-OK JSON throws the envelope; 204 returns `null`; AbortError remains native; network failures use status 0
- Produces: cache v2 stores complete envelopes and rejects/removes v1 raw entries while retaining SWR, dedupe, abort, fallback, and 404 invalidation

- [ ] **Step 1: Rewrite/add failing Fetch-client tests**

Cover success/error envelopes, empty 204, non-contract fallback, network failure, native abort, exact application-auth decision table, Google reconnect without logout, and location 404 behavior.

- [ ] **Step 2: Add failing cache migration/regression tests**

Assert v1 entries are ignored/removed, v2 envelopes persist/restore, concurrent requests deduplicate, stale fallback survives transient errors, abort behavior is preserved, and relevant 404 responses invalidate.

- [ ] **Step 3: Run focused legacy tests and confirm failures**

Run: `npm test -w @parametrics/web -- --run src/apiClient.test.js src/hooks/useCachedApi.test.js`

- [ ] **Step 4: Implement the Fetch and cache contracts**

Remove any temporary `error.status` alias unless a Task 12 consumer test proves it is still required; if retained temporarily, document its consumer and removal condition in the inventory.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

### Task 12: Migrate all legacy-web contexts, helpers, pages, and components

**Files:**
- Modify: `apps/web/src/context/AuthContext.jsx`
- Modify: `apps/web/src/context/authState.js`
- Modify: `apps/web/src/context/authState.test.js`
- Modify: JSON consumers under `apps/web/src/pages/`, `components/`, `context/`, `hooks/`, and `lib/`
- Preserve: direct binary behavior in `apps/web/src/lib/reportHistory.js`
- Modify/create: corresponding Vitest tests

**Interfaces:**
- Consumes: Task 11 envelope-returning `api()` and cache v2
- Produces: all JSON consumers read `result.data`; all standardized failures read `statusCode`, `message`, and `errors[]`

- [ ] **Step 1: Inventory each `api()`/cached result consumer and add/update failing feature tests**

Cover login/session/logout, organizations/members, locations/active location, integrations, posts/actions/sync, reviews, recurrence, reports, and notifications. Pin direct report-download bytes/headers and auth/provider distinctions.

- [ ] **Step 2: Run the legacy suite and record old-shape failures**

Run: `npm test -w @parametrics/web -- --run`

- [ ] **Step 3: Migrate consumers feature-by-feature**

Keep request aborting, stale response protection, location changes, cache refresh, and notification wording intact. Leave direct binary Fetch helpers outside JSON envelope handling.

- [ ] **Step 4: Search for legacy Fetch assumptions**

Search for raw business-field reads from `api()` results, `error.status`, `error.error`, and old Google detail paths. Expected: no runtime matches except documented non-JSON paths.

- [ ] **Step 5: Run tests, lint, and build**

Run: `npm test -w @parametrics/web -- --run && npm run lint -w @parametrics/web && npm run build -w @parametrics/web`

Expected: all PASS.

### Task 13: Complete contract audit, proof, PRD update, and final verification

**Files:**
- Modify: `docs/proof/standardized-api-response-inventory.md`
- Update: canonical ParaMetrics Google Drive PRD

**Interfaces:**
- Consumes: all implementation and test evidence from Tasks 1-12
- Produces: complete response inventory, verification evidence, atomic deployment/rollback notes, and aligned canonical PRD

- [ ] **Step 1: Perform the final response-writer and consumer audits**

Re-run backend response-site searches and frontend legacy-shape searches. Reconcile every remaining match with a canonical helper, binary/redirect/bodyless/static exception, or direct binary consumer row.

- [ ] **Step 2: Run backend syntax and focused HTTP smoke checks**

Run `node --check` for every changed backend JavaScript file, then run the importable-app HTTP contract suite. Expected: all syntax checks and HTTP cases pass.

- [ ] **Step 3: Run the complete verification matrix**

Run:

```text
npm test -w @parametrics/api
npm test -w client
npm test -w @parametrics/web -- --run
npm run lint -w client
npm run lint -w @parametrics/web
npm run build -w client
npm run build -w @parametrics/web
git diff --check
```

Record exact pass/fail counts and do not claim browser verification unless it was actually performed against the updated backend.

- [ ] **Step 4: Update proof documentation**

Add starting/ending SHA, changed-file inventory, final endpoint classification, exact commands/results, smoke/browser status, known deployment coupling, immutable artifact requirement, CDN cache concern, and atomic rollback steps.

- [ ] **Step 5: Update the canonical Google Drive PRD from verified evidence**

Use the Google Drive and Google Docs skills. Add the finalized contract, exclusions, client migration behavior, verification evidence, and coordinated rollout/rollback requirements; do not claim unexecuted results.

- [ ] **Step 6: Confirm review-ready repository state**

Run: `git status --short && git branch --show-current && git rev-parse feat/automatic-google-post-sync`

Expected: current branch is `refactor/standardize-api-responses`, Phase 3 still points to its original SHA, all work is uncommitted/unpushed, and no unrelated files changed.
