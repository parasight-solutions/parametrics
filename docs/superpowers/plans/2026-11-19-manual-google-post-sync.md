# Phase 2 Manual Google Business Profile Post Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe user-triggered Google post synchronization endpoint and frontend action that imports, narrowly updates, and non-destructively reconciles posts while persistent deletion tombstones prevent resurrection.

**Architecture:** Extend the Phase 1 synchronization engine with shared normalization plus distinct insert-only recovery and manual-sync modes. A minimal tombstone service integrates with Google-first deletion and both sync modes; a location-document lease serializes manual syncs, and two-sided tombstone rechecks resolve sync/delete races without MongoDB transactions.

**Tech Stack:** Node.js ESM, Express, MongoDB, native crypto, existing Google Business Profile helpers, React 19, Axios, Node test runner, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-11-19-manual-google-post-sync-design.md`

## Global Constraints

- Start from `fix/google-post-deletion` at verified SHA `2c65f4ced0765ab4c55f1ef01848af9e055736bf`; create a dedicated Phase 2 feature branch before product changes.
- Preserve the user's uncommitted `apps/client/src/pages/private/Posts.jsx` changes and wire the existing Sync Post button.
- Do not commit, push, merge, deploy, or run a live Google sync automatically.
- Phase 1 remains dry-run-first and insert-only, but must skip persistent tombstones.
- No background sync, scheduler, worker, outbox, Redis lock, transaction requirement, tombstone expiry, confirmation dialog, or new frontend page.
- Fetch and validate all Google pages before reconciliation writes or provider-missing decisions.
- Never weaken tenancy/integration checks or overwrite lifecycle, ownership, scheduling, publishing, recurrence, AI, or deletion fields.
- A failed or partial reconciliation must not advance last-success metadata or report complete success.
- Keep normal `GET /api/v1/posts` MongoDB-backed and preserve Google-first deletion.
- Follow current test, API error, Axios/session, index naming, and location-context conventions.

## Review Focus

- Sync finalizes an import immediately before deletion writes its tombstone: deletion must remove only the exact deterministic imported recovery record; Task 2 and Task 3 test this ordering.
- Google omits an optional field versus explicitly returns an empty media/CTA collection: omission preserves the local value while explicit removal clears only that provider-owned field; Task 3 tests both shapes.
- A sync lease expires while the old request is still running: every location metadata/release update must require the operation id so the stale request cannot overwrite a newer sync; Task 4 tests lease takeover.
- A provider listing contains a post that matches a local queued/publishing/deleting record: sync must report a lifecycle conflict and write nothing to that post; Task 3 tests each protected status.
- Active location changes after the frontend request resolves but before callbacks run: stale results must not notify, overwrite timestamp, or refresh the new location's list; Task 5 tests a deferred response and location switch.

---

### Task 1: Persistent Google Deletion Tombstone Contract and Indexes

**Files:**
- Create: `apps/api/src/services/postDeletionTombstones.js`
- Create: `apps/api/src/services/postDeletionTombstones.test.js`
- Modify: `apps/api/src/startup/ensureIndexes.js`
- Create: `apps/api/src/startup/ensureIndexes.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `buildPostDeletionTombstoneIdentity({ provider, providerPostName }): { id: string, providerResourceKey: string }`.
- Produces `buildPostDeletionTombstone({ post, location, userId, providerOutcome, deletedAt }): object`.
- Produces `upsertPostDeletionTombstone(tombstones, document): Promise<object>` using exact deterministic identity and idempotent `$setOnInsert`.
- Produces `findPostDeletionTombstones(tombstones, { provider, providerPostNames }): Promise<Map<string, object>>`.
- Produces startup indexes `uniq_post_deletion_tombstones_provider_resource_key` and `idx_post_deletion_tombstones_provider_resource` with no TTL.
- Produces `ensurePostDeletionTombstoneIndexes(collection): Promise<void>` so index behavior is testable without connecting to MongoDB; `ensureIndexes()` calls it with `col("post_deletion_tombstones")`.

- [ ] **Step 1: Write failing tombstone identity and shape tests**

Test deterministic/versioned identity, different provider resources producing different keys, exact provider/account/location/tenancy scope, minimal audit fields, and absence of summary/media/CTA/token/provider-body fields.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-isolation=none apps/api/src/services/postDeletionTombstones.test.js`

Expected: FAIL because the tombstone service does not exist.

- [ ] **Step 3: Implement tombstone pure helpers and idempotent collection operations**

Use SHA-256 over `post-deletion-tombstone:v1|provider:<provider>|post:<exact provider resource>`. Reject malformed Google provider resources before constructing documents. The write must never replace or delete an existing tombstone.

- [ ] **Step 4: Write failing index tests**

Assert the unique provider-resource-key index and scoped lookup index are created with the exact names and options, and no tombstone TTL index exists.

- [ ] **Step 5: Add the collection indexes through existing `ensureIndex` conventions**

Keep index creation inside `ensureIndexes()` and avoid changes to existing index signatures.

- [ ] **Step 6: Register and run focused tests**

Expected: all Task 1 tests pass.

### Task 2: Tombstone-aware Google-first Deletion

**Files:**
- Modify: `apps/api/src/services/postDeletion.js`
- Modify: `apps/api/src/services/postDeletion.test.js`
- Modify: `apps/api/src/routes/posts.js`

**Interfaces:**
- Consumes Task 1 `buildPostDeletionTombstone` and `upsertPostDeletionTombstone` through injected deletion dependencies.
- Extends `deletePostWithProvider(..., { tombstones, persistTombstone, removeRecoveryImport, ... })` without changing callers' public route response.
- Produces exact conditional recovery cleanup by deterministic import `_id`, full scope, `origin: "google_imported"`, `status: "published"`, and exact provider name.

- [ ] **Step 1: Write failing deletion success and 404 tests**

Assert Google success and verified 404 each persist one minimal tombstone after `provider_deleted_at` and before local post deletion, then delete the claimed post. Assert repeated deletion/tombstone writes remain idempotent.

- [ ] **Step 2: Run deletion tests and verify RED**

Run: `node --test --test-isolation=none apps/api/src/services/postDeletion.test.js`

Expected: new ordering/tombstone assertions fail.

- [ ] **Step 3: Implement tombstone persistence in the deletion lifecycle**

Persist the tombstone after provider progress is conditionally recorded and before local cleanup. Preserve all existing Google error mapping, claims, leases, and worker exclusion.

- [ ] **Step 4: Write failing tombstone failure and retry tests**

Assert a tombstone write failure retains `status: deleting`, `provider_deleted_at`, and provider outcome; releases the operation lease; returns `post_delete_tombstone_failed`; and a retry writes the tombstone and deletes locally without a second Google call.

- [ ] **Step 5: Implement safe failure/retry behavior**

Use existing deletion recovery mechanics; never clear provider progress after tombstone failure.

- [ ] **Step 6: Write failing deletion-wins-race cleanup tests**

Create a deterministic recovery import between the sync postcheck and tombstone persistence. Assert deletion removes the claimed original plus only the exact matching deterministic `google_imported` document, while leaving unrelated/legacy records untouched.

- [ ] **Step 7: Implement exact recovery-import cleanup and route dependency wiring**

Inject `post_deletion_tombstones` from the route. Recovery cleanup may use `deleteOne` only with deterministic identity and the complete protective filter.

- [ ] **Step 8: Run deletion and publishing lifecycle suites**

Run: `node --test --test-isolation=none apps/api/src/services/postDeletion.test.js apps/api/src/services/postPublishLifecycle.test.js`

Expected: all deletion and lifecycle tests pass.

### Task 3: Shared Reconciliation Engine, Manual Sync Mode, and Phase 1 Tombstone Safety

**Files:**
- Modify: `apps/api/src/services/postSync.js`
- Modify: `apps/api/src/services/postSync.test.js`
- Modify: `apps/api/src/services/postRecoveryCli.js`
- Modify: `apps/api/src/services/postRecoveryCli.test.js`
- Modify: `apps/api/src/scripts/recover.google-posts.js`

**Interfaces:**
- Consumes Task 1 tombstone lookup and deterministic identity.
- Preserves `recoverGooglePosts({ location, integration, apply?, now? }, deps)` as insert-only, adding required `tombstones` dependency and `tombstoneSkipped` outcomes.
- Produces `buildGoogleOwnedPostPatch({ googlePost, existingPost, now }): object` with only the approved allowlist and explicit-empty semantics.
- Produces `syncGooglePosts({ location, integration, now, operationId }, deps): Promise<SyncResult>`.
- `SyncResult.summary` contains `fetched`, `inserted`, `updated`, `unchanged`, `missingOnGoogle`, `tombstoneSkipped`, `skipped`, and `conflicts`.

- [ ] **Step 1: Write failing provider patch tests**

Assert meaningful Google values update the allowlist, missing optional properties preserve existing values, explicit empty media/CTA clears corresponding fields, unsafe URLs sanitize to null only when explicitly supplied, unchanged inputs produce no database patch, and forbidden fields never appear.

- [ ] **Step 2: Run focused service tests and verify RED**

Expected: FAIL because manual-sync patching is absent.

- [ ] **Step 3: Implement shared normalization and narrow patch building**

Reuse `providerFieldsFromGooglePost` and existing URL rules. Keep import mapping backward compatible.

- [ ] **Step 4: Write failing reconciliation-plan tests**

Cover new remote import, eligible published update, unchanged record, legacy duplicate conflict, cross-scope conflict, deterministic collision, duplicate/malformed provider names, tombstoned provider name, and protected `scheduled`, `queued`, `retrying`, `publishing`, `failed`, and `deleting` records.

- [ ] **Step 5: Implement complete read-only manual-sync planning**

Fetch and validate all pages first; then load selected scoped provider posts, conflict candidates, deterministic identities, and tombstones. Do not mutate during planning.

- [ ] **Step 6: Write failing conditional apply and missing-provider tests**

Assert imports use `$setOnInsert`; updates require exact full scope, provider name, and `status: published`; unchanged posts are not rewritten; missing posts retain `status: published` and receive only provider reconciliation fields; reappearing posts clear `provider_missing_since`; provider fetch failure produces zero writes and no missing marks.

- [ ] **Step 7: Implement idempotent manual apply**

Apply narrow sequential operations, count only matched/modified outcomes, convert lifecycle races to conflicts, and throw a compact partial-apply error containing safe counts when any database operation fails.

- [ ] **Step 8: Write failing two-sided tombstone race tests**

Exercise tombstone-before-import, tombstone-between-precheck-and-upsert, and tombstone-after-sync-postcheck/deletion-cleanup orderings. Assert no deterministic imported document survives and `tombstoneSkipped` is counted.

- [ ] **Step 9: Implement post-upsert tombstone recheck and conditional cleanup**

Only remove the deterministic imported document when every protective identity/scope/origin/status condition still matches.

- [ ] **Step 10: Write failing Phase 1 compatibility tests**

Assert dry-run/apply recovery skips tombstones, remains insert-only, never updates provider-owned fields or location metadata, and the existing CLI passes the tombstone collection dependency.

- [ ] **Step 11: Update Phase 1 wiring without broadening behavior**

Keep command arguments and output backward compatible, adding only a safe tombstone-skipped count/outcome.

- [ ] **Step 12: Run the complete sync/recovery service suite**

Run: `node --test --test-isolation=none apps/api/src/services/postSync.test.js apps/api/src/services/postRecoveryCli.test.js apps/api/src/services/postDeletionTombstones.test.js`

Expected: all Task 3 tests pass.

### Task 4: Authorized Manual Sync API, Location Lease, and Success Metadata

**Files:**
- Create: `apps/api/src/services/manualPostSync.js`
- Create: `apps/api/src/services/manualPostSync.test.js`
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/src/routes/locations.js`
- Create or modify: `apps/api/src/routes/locations.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes Task 3 `syncGooglePosts`.
- Produces `claimPostSyncLease(locations, { location, operationId, now, leaseMs }): Promise<object>`.
- Produces `releasePostSyncLease(locations, { locationId, operationId }): Promise<void>`.
- Produces `completePostSyncLease(locations, { locationId, operationId, summary, now }): Promise<object>`.
- Produces `runManualPostSync({ userId, locationId, now? }, deps): Promise<{ success, locationId, summary, lastSyncedAt }>`.
- Adds `POST /api/v1/posts/sync` before `GET /:id` with `authenticate` and `syncRateLimit`.
- Produces a safe location-list projection containing only completed `post_sync` summary fields; operation ids and lease expiry are never returned.

- [ ] **Step 1: Write failing lease tests**

Cover first claim, live-lease conflict, expired-lease takeover, release by matching id, stale release ignored, completion by matching id, and an old operation unable to overwrite a newer lease or success metadata.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-isolation=none apps/api/src/services/manualPostSync.test.js`

Expected: FAIL because the orchestration service does not exist.

- [ ] **Step 3: Implement atomic location lease helpers**

Use `findOneAndUpdate` filters constrained by location id, canonical scope, and absent/expired lease. Keep all mutable fields nested under `post_sync` and preserve prior success metadata on failures.

- [ ] **Step 4: Write failing orchestration and error tests**

Cover authorized owner/admin/assigned-manager, unauthorized/missing/invalid location, wrong/disabled/reauth integration, inaccessible account/location, Google 401/403/429/5xx mapping, concurrent request, successful metadata, provider/partial failure not advancing metadata, and lease release on every failure.

- [ ] **Step 5: Implement manual orchestration**

Route authorization remains `requireOwnedOrganizationLocationAccess` with operation roles. The service claims the lease, loads the exact bound integration, delegates sync, conditionally completes metadata, and safely releases on error.

- [ ] **Step 6: Write failing route contract/order tests**

Assert `POST /sync` is registered before `/:id`, requires session and rate limit, accepts only nonblank `locationId`, ignores/rejects supplied provider/scope ids, returns the approved response, and uses existing API error serialization.

- [ ] **Step 7: Add the route and dependencies**

Inject posts, locations, tombstones, Google helpers, integration lookup, and organization access through existing modules; return no raw provider payloads.

- [ ] **Step 8: Write failing safe location-metadata response tests**

Assert the active location response exposes `post_sync.last_success_at` and completed safe counts but omits operation id and lease expiry.

- [ ] **Step 9: Implement safe location metadata serialization**

Preserve existing canonical binding fields while explicitly shaping `post_sync` to completed metadata only.

- [ ] **Step 10: Register and run API-focused tests**

Run: `node --test --test-isolation=none apps/api/src/services/manualPostSync.test.js apps/api/src/services/postSync.test.js apps/api/src/services/postDeletion.test.js apps/api/src/routes/locations.test.js`

Expected: all Task 4 tests pass.

### Task 5: New Frontend Sync Action and Stale-location Protection

**Files:**
- Modify: `apps/client/src/services/posts.service.js`
- Create: `apps/client/src/services/posts.service.test.js` if no existing service test is suitable
- Modify: `apps/client/src/pages/private/Posts.jsx`
- Create: `apps/client/src/pages/private/Posts.test.jsx` or extend the existing Posts test
- Create or modify a small sync error formatter under `apps/client/src/utils/` only if existing notification utilities cannot express backend codes cleanly

**Interfaces:**
- Produces `postsEndpoints.syncPosts({ locationId })` calling `POST /posts/sync`.
- The Posts component consumes the existing location context, `useApi`, notifications, `fetchPosts`, and existing Sync Post button.

- [ ] **Step 1: Write failing service method test**

Assert `syncPosts({ locationId: "loc-1" })` sends exactly `POST /posts/sync` with `{ locationId: "loc-1" }` and no provider/integration/tenancy identifiers.

- [ ] **Step 2: Run the focused frontend test and verify RED**

Run the repository-supported Vitest command for the service test.

Expected: FAIL because `syncPosts` is undefined.

- [ ] **Step 3: Add the dedicated endpoint method**

Use the existing Axios instance and cookie/session conventions; do not modify `useApi`.

- [ ] **Step 4: Write failing Posts interaction tests**

Cover disabled without active location, loading/spinning and repeat prevention, same-location success notification plus list refresh without filter reset, meaningful backend error, last-success timestamp display, and no notification/metadata/refresh when active location switches during a deferred request.

- [ ] **Step 5: Wire the existing Sync Post button**

Preserve its placement and current UI component. Capture the requested location in a ref/token, guard repeated calls, and compare against the latest active location before applying callbacks.

- [ ] **Step 6: Run relevant frontend tests**

Run: `npm test -w client -- --run` or the actual focused Vitest command supported by the workspace.

Expected: all sync UI/service tests pass.

### Task 6: Documentation, Full Verification, and Handoff

**Files:**
- Create: `docs/proof/manual-google-post-sync.md`
- Update externally: canonical Google Drive PRD `1lupXsJRs96TBHCbjPoaw0EPDAul-ih8ocAr_gXvXWmQ`

**Interfaces:**
- Consumes all prior tasks' API contract, data model, race guarantees, and test evidence.
- Produces exact live-test and rollback procedures without executing a live sync.

- [ ] **Step 1: Run complete backend verification**

Run:

```powershell
npm test -w @parametrics/api
node --check apps/api/src/services/postDeletionTombstones.js
node --check apps/api/src/services/postSync.js
node --check apps/api/src/services/manualPostSync.js
node --check apps/api/src/services/postDeletion.js
```

Expected: all API tests and syntax checks pass.

- [ ] **Step 2: Run complete frontend verification**

Run the repository-supported commands:

```powershell
npm test -w client
npm run lint -w client
npm run build -w client
```

Expected: tests, lint, and production build pass; report any pre-existing failure exactly.

- [ ] **Step 3: Run repository hygiene and scope checks**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm no unrelated modules, confirmation UI, Phase 3 process, commit, push, merge, or deployment was introduced.

- [ ] **Step 4: Update the canonical PRD and read back the changed section**

Record Phase 2 endpoint, tombstone model/order, race protocol, update/missing rules, sync lease/metadata, frontend behavior, actual automated evidence, mocked-provider limitation, and Phase 3 dependencies.

- [ ] **Step 5: Write the local proof pack**

Include starting/ending SHA, branch, files/purpose, request/response contract, exact insert/update rules, concurrency/duplicate handling, provider-missing behavior, metadata, commands/results, live test procedure, limitations, rollback, and confirmation that no live sync/commit/push/merge/deploy occurred.

- [ ] **Step 6: Perform final whole-change review and leave work uncommitted**

Review against the spec's acceptance criteria and every `Review Focus` case. Verify the dedicated branch, unchanged HEAD, preserved user Posts page work, and complete scoped diff.
