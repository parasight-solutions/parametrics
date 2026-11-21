# Phase 3 Automatic Google Business Profile Post Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add disabled-by-default, two-hour automatic Google post synchronization with durable scheduling, transaction-backed lease fencing, scoped settings APIs, and a dedicated client settings module while preserving Phase 1 recovery, Phase 2 manual sync, publishing, and Google-first deletion.

**Architecture:** Keep `postSync.js` as the single provider fetch/reconciliation engine, but split fetch/planning from a MongoDB-transactional apply phase. A shared runner coordinates manual and automatic operations through renewable location-document leases with operation IDs and fencing counters. The existing scheduler scans due opt-in locations every minute and enqueues location/due-window BullMQ jobs; a dedicated worker reloads all scope and integration state before invoking the shared runner. Per-location settings and operational metadata stay in `locations.post_sync`, and a new `/settings/post-auto-sync` client page manages them through authenticated, organization-scoped APIs.

**Tech Stack:** Node.js 20 ESM, Express, MongoDB transactions, BullMQ/ioredis, pino, native Node test runner, React 19, React Router, Axios, Vitest, Vite, existing UI components.

**Spec:** `docs/superpowers/specs/2026-11-20-automatic-google-post-sync-design.md`

## Global constraints

- Work on `feat/automatic-google-post-sync`, starting at `b33290debc62f697eef0f5f7314c7d9f7c2ca4d3`.
- Leave all changes uncommitted and unpushed; do not merge, deploy, run a live Google sync, or enable production auto-sync.
- Preserve manual Sync Posts regardless of global or per-location automatic settings.
- Reuse the Phase 2 reconciliation engine and preserve the Phase 1 recovery CLI.
- Preserve deletion tombstones, publishing/deletion lifecycle filters, and MongoDB-backed post listing.
- Do not add automatic publishing/deletion, a deletion confirmation dialog, browser-triggered background work, or a second persisted all-locations setting.
- Missing `post_sync.auto_enabled` means `false`; the deployment-wide feature flag is never writable through HTTP.
- Use dotted location updates so unrelated `post_sync` metadata is never replaced.
- Never put OAuth credentials, raw provider payloads, or secrets in BullMQ jobs, logs, API responses, or sync metadata.
- Transaction-backed reconciliation requires a MongoDB replica set or sharded cluster. Automated evidence must distinguish real MongoDB/Redis integration tests from in-memory unit tests.

## File structure

### Backend configuration and coordination

- Create `apps/api/src/config/postAutoSyncConfig.js`: validated environment configuration and defaults.
- Create `apps/api/src/services/postSyncLease.js`: lease acquisition, heartbeat renewal, ownership assertion, conditional completion/release.
- Create `apps/api/src/services/postSyncRunner.js`: shared manual/automatic orchestration and safe provider error classification.
- Modify `apps/api/src/services/manualPostSync.js`: compatibility adapter over the shared runner.
- Modify `apps/api/src/services/postSync.js`: separate fetch/plan from transaction-aware apply, with session propagation.
- Modify `apps/api/src/services/postDeletion.js` and its route wiring: persist tombstone plus location coordination epoch transactionally before exact local cleanup.
- Modify `apps/api/src/lib/mongo.js`: expose a safe client/session entry point without changing existing `col()` callers.

### Backend scheduling and APIs

- Create `apps/api/src/services/postAutoSyncSettings.js`: scoped settings reads, individual changes, and all-or-nothing bulk changes.
- Create `apps/api/src/routes/postSyncSettings.js`: authenticated HTTP contracts.
- Create `apps/api/src/services/postAutoSyncScheduler.js`: due calculation, eligibility, enqueue claims, deterministic job identity.
- Create `apps/api/src/services/autoPostSync.js`: worker-side eligibility reload and automatic runner adapter.
- Create `apps/api/src/workers/postSync.worker.js`: BullMQ worker, retries, logging, and shutdown.
- Modify `apps/api/src/jobs/scheduler.js`: invoke the post-sync scan without disturbing scheduled publishing.
- Modify `apps/api/src/workers/index.js`, `apps/api/src/lib/queues.js`, `apps/api/src/server.js`, `apps/api/src/startup/ensureIndexes.js`, and `apps/api/package.json`: registration, route, queue, index, and test wiring.

### Client

- Create `apps/client/src/services/postSyncSettings.service.js`: settings endpoints.
- Create `apps/client/src/utils/postAutoSyncSettings.js`: derived all-toggle/status/error helpers and stale-scope guard.
- Create `apps/client/src/pages/private/PostAutoSyncSettings.jsx`: page state and UI.
- Modify `apps/client/src/App.jsx` and `apps/client/src/components/SideBar.jsx`: Settings route/navigation only.
- Reuse existing UI components; do not modify form UI components unless a confirmed API mismatch requires it.

## Review focus

- A lease expires after provider fetch but before reconciliation commit: the old transaction must not commit post mutations after a newer fenced operation owns the location.
- Tombstone creation races with an automatic import based on a stale Google listing: transaction conflict/recheck must leave the tombstone present and no active imported post.
- Scheduler claims a location and crashes or fails before enqueue: claim expiry/conditional rollback must make the location schedulable again.
- A retained completed/failed BullMQ job exists: the next due window must use a different ID and run normally.
- Bulk settings target a mixed manageable/read-only scope: validation must fail before writing anything, not partially update manageable rows.
- A location is disabled or disconnected after enqueue: the worker must skip before resolving/accessing Google.
- A manual completion races with automatic metadata: operation/fence filters and dotted updates must preserve the newer result and automatic scheduling fields.
- The user switches organization/account while settings load: a stale response must not replace the selected scope.

---

### Task 1: Validated auto-sync configuration, timing policy, and scheduler index

**Files:**
- Create: `apps/api/src/config/postAutoSyncConfig.js`
- Create: `apps/api/src/config/postAutoSyncConfig.test.js`
- Create: `apps/api/src/services/postAutoSyncScheduler.js`
- Create: `apps/api/src/services/postAutoSyncScheduler.test.js`
- Modify: `apps/api/src/startup/ensureIndexes.js`
- Modify: `apps/api/src/startup/ensureIndexes.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- `resolvePostAutoSyncConfig(env): { enabled, intervalMinutes, concurrency, maxAttempts, leaseMs, heartbeatMs }`.
- Defaults: disabled, 120 minutes, concurrency 1, maximum attempts 3.
- `calculateNextAutoSyncAt({ locationId, completedAt, intervalMinutes }): Date`.
- `calculateInitialAutoSyncAt({ locationId, enabledAt }): Date` with short deterministic staggering.
- `buildPostSyncJobId({ locationId, dueAt }): string` scoped to a stable due window.
- `ensurePostAutoSyncIndexes(locations): Promise<void>` creates the due-scan index using existing index conventions.

- [ ] Write failing config tests covering defaults, strict boolean parsing, numeric bounds, invalid values, `heartbeatMs < leaseMs`, and no accidental enablement.
- [ ] Run `node --test apps/api/src/config/postAutoSyncConfig.test.js` and confirm RED.
- [ ] Implement the minimal configuration parser with documented bounds and actionable startup errors.
- [ ] Write failing clock-controlled tests for 120-minute success scheduling, stable location jitter, prompt first enable, due/not-due boundaries, and different due-window job IDs.
- [ ] Implement pure scheduling helpers only; defer database/queue effects to Task 5.
- [ ] Write failing index tests for the exact location due-scan index and absence of destructive index changes.
- [ ] Add the index through `ensurePostAutoSyncIndexes()` and register the new tests in the API package script.
- [ ] Run the Task 1 tests and confirm PASS.

### Task 2: Renewable fenced lease and transaction-aware reconciliation

**Files:**
- Create: `apps/api/src/services/postSyncLease.js`
- Create: `apps/api/src/services/postSyncLease.test.js`
- Modify: `apps/api/src/lib/mongo.js`
- Modify: `apps/api/src/services/postSync.js`
- Modify: `apps/api/src/services/postSync.test.js`
- Modify: `apps/api/src/services/postDeletion.js`
- Modify: `apps/api/src/services/postDeletion.test.js`
- Modify: `apps/api/src/routes/posts.js`
- Create: `apps/api/src/services/postSync.transaction.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- `claimPostSyncLease(locations, { location, operationId, operationKind, now, leaseMs }): { location, fence }` atomically increments `post_sync.operation_fence`.
- `renewPostSyncLease(locations, { locationId, operationId, fence, now, leaseMs }): boolean`.
- `assertPostSyncLease(locations, { locationId, operationId, fence, now, session }): object`.
- `releasePostSyncLease(...)` and metadata completion require matching operation ID/fence.
- `startPostSyncHeartbeat({ renew, intervalMs, signal }): { stop, lost }` has an injected timer/clock surface for tests.
- `getMongoClient()` or `withMongoTransaction(work, options)` exposes sessions without weakening `getDb()`/`col()`.
- `fetchAndPlanGooglePostSync(...)` performs all provider pagination and validation before writes.
- `applyGooglePostSyncPlan(..., { session, assertOwnership })` uses the same session for lease assertion, tombstone reads, post reads, and mutations.
- Deletion persists the tombstone and increments `post_sync.tombstone_epoch` in one transaction before exact recovery-import cleanup; sync performs a fenced write to the same location document so concurrent operations conflict.

- [ ] Write failing lease tests for initial claim, active conflict, expired takeover, monotonic fence, matching renewal, stale renewal/release rejection, and conditional metadata updates.
- [ ] Run the lease test and confirm RED.
- [ ] Implement atomic dotted lease operations without replacing completed or scheduling metadata.
- [ ] Write failing heartbeat tests for repeated renewal, stop, renewal failure, abort signaling, and never renewing another operation.
- [ ] Implement the heartbeat with injectable timers and a bounded lease/heartbeat ratio.
- [ ] Refactor existing reconciliation tests to first assert fetch/plan behavior remains fetch-all-before-write and preserves all current summary/lifecycle/tombstone semantics.
- [ ] Add failing apply tests that require session propagation to every collection call and an ownership assertion immediately inside the transaction.
- [ ] Implement transaction-aware apply while retaining the public `syncGooglePosts()` compatibility wrapper for Phase 1/2 callers.
- [ ] Write failing deletion tests proving tombstone persistence and location epoch advancement are atomic, transaction failure retains recoverable `deleting` state, and retry does not repeat confirmed Google deletion.
- [ ] Update Google-first deletion route/service wiring to use the MongoDB session while preserving provider-first ordering and existing response/error contracts.
- [ ] Add opt-in real-Mongo integration tests using `TEST_MONGODB_URI` for stale-worker transaction conflict, lease takeover, and both orderings of the tombstone/import race; skip with an explicit reason when no transaction-capable test database is configured.
- [ ] Run `postSync`, lease, transaction, deletion, and publish-lifecycle suites; report unit versus real-database evidence separately.

### Task 3: Shared runner and backward-compatible manual synchronization

**Files:**
- Create: `apps/api/src/services/postSyncRunner.js`
- Create: `apps/api/src/services/postSyncRunner.test.js`
- Modify: `apps/api/src/services/manualPostSync.js`
- Modify: `apps/api/src/services/manualPostSync.test.js`
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/src/routes/locations.js`
- Modify: `apps/api/src/routes/locations.test.js`

**Interfaces:**
- `runPostSync({ location, integration, operationKind, now, ... }, deps)` owns claim, heartbeat, transaction, completion, and safe release.
- Manual adapter retains `runManualPostSync({ userId, locationId, now }, deps)` and its current response/error contract.
- Completion uses dotted fields; manual success updates common last-success/count fields and advances `post_sync.next_auto_sync_at` without erasing automatic attempt/failure metadata.
- Location serialization includes only approved user-facing sync fields and `auto_enabled`; it never exposes operation IDs, fences, or expiry.

- [ ] Write failing shared-runner tests for success, provider failure, auth/rate-limit mapping, heartbeat loss, transaction failure, lease conflict, and release/metadata ownership.
- [ ] Implement the shared runner and error classifier with injected clock/session dependencies.
- [ ] Update manual tests first to prove response compatibility, manual operation when auto flags are false, shared lease exclusion, and preservation of automatic metadata.
- [ ] Convert `manualPostSync.js` into a thin adapter and update the posts route dependency wiring.
- [ ] Add location serializer tests for new safe fields and secret lease-field omission.
- [ ] Run manual API, Phase 1 recovery, Phase 2 sync, deletion, and publishing regression tests.

### Task 4: Scoped auto-sync settings service and authenticated APIs

**Files:**
- Create: `apps/api/src/services/postAutoSyncSettings.js`
- Create: `apps/api/src/services/postAutoSyncSettings.test.js`
- Create: `apps/api/src/routes/postSyncSettings.js`
- Create: `apps/api/src/routes/postSyncSettings.test.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Read roles: owner, admin, assigned manager, assigned viewer.
- Write roles: owner, admin, assigned manager.
- `listPostAutoSyncSettings({ userId, organizationId, integrationId? }, deps)` returns sanitized organizations/accounts/locations with `canManage` and a 120-minute interval.
- `setLocationPostAutoSync({ userId, locationId, enabled, now }, deps)` resolves by server-side location/organization scope, not requester ownership.
- `setScopedPostAutoSync({ userId, organizationId, integrationId?, enabled, now }, deps)` validates the entire server-resolved target set before one scoped `updateMany` and verifies `matchedCount`.
- Endpoints: `GET /api/v1/post-sync-settings`, `PATCH /api/v1/post-sync-settings/locations/:locationId`, and `PATCH /api/v1/post-sync-settings`.

- [ ] Write failing service tests for missing-as-false, organization/client/location assignment, owner/admin/assigned-manager writes, viewer read-only results, cross-organization denial, and location-owner-bound integration/account grouping.
- [ ] Implement sanitized listing without returning tokens, operation fields, or raw integration documents.
- [ ] Write failing individual update tests for strict boolean validation, provider/scope/integration checks, prompt staggered due time on enable, preservation of metadata, and disable behavior.
- [ ] Implement one atomic dotted individual update with a fully server-derived filter.
- [ ] Write failing bulk tests for complete target derivation, no stored aggregate flag, mixed-permission rejection before writes, exact integration scope, one `updateMany`, `matchedCount` conflict, and idempotent already-set values.
- [ ] Implement bulk validation then scoped atomic update; never accept location IDs or tenant ownership from the body.
- [ ] Write route contract tests for authentication, stable errors, request shape, and inability to change the global feature flag.
- [ ] Mount the router and register tests; run all Task 4 tests.

### Task 5: Durable scheduler scan, BullMQ job, and dedicated worker

**Files:**
- Modify: `apps/api/src/services/postAutoSyncScheduler.js`
- Modify: `apps/api/src/services/postAutoSyncScheduler.test.js`
- Create: `apps/api/src/services/autoPostSync.js`
- Create: `apps/api/src/services/autoPostSync.test.js`
- Create: `apps/api/src/workers/postSync.worker.js`
- Create: `apps/api/src/workers/postSync.worker.test.js`
- Modify: `apps/api/src/jobs/scheduler.js`
- Modify: `apps/api/src/workers/index.js`
- Modify: `apps/api/src/lib/queues.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- `claimDuePostSyncLocations({ now, limit, claimMs }, deps)` atomically claims only enabled, due Google locations and returns minimal enqueue records.
- `enqueueClaimedPostSync(record, queue, config)` uses payload `{ locationId, enqueueClaimId, dueAt }` only.
- Enqueue failure conditionally clears the matching claim; expired claims are reclaimable.
- `runAutoPostSyncJob(job, deps)` rechecks global flag, location setting/status/scope, membership, integration ownership/binding, and reauthorization before Google access.
- Queue name: `post-sync`; concurrency comes from validated config.

- [ ] Write failing scheduler tests for global disabled default, eligibility, 120-minute due state, invalid/disconnected locations, expired claims, duplicate scheduler claims, enqueue rollback, due-window deduplication, and future scheduling after terminal jobs.
- [ ] Implement the bounded scheduler scan and queue adapter without changing scheduled-post publishing behavior.
- [ ] Write failing worker service tests for minimal payload, correct owning-user integration, multiple Google accounts, disabled/deleted/disconnected after enqueue, auth failure suppression, 429 `Retry-After`, 5xx exhaustion, contention, and lost lease.
- [ ] Implement `autoPostSync.js` as the testable worker core and call the shared runner.
- [ ] Write worker wrapper tests for configured attempts/backoff/concurrency, sanitized logging, and no credential payloads.
- [ ] Register the queue and worker, preserving existing exports and processes.
- [ ] Add graceful shutdown tests/handlers: stop scans, close worker/queues, bounded drain with heartbeat, then leave owned lease to expire if forced.
- [ ] Add optional real Redis/Mongo integration tests using `TEST_REDIS_*` and `TEST_MONGODB_URI` for duplicate scheduler processes, queue deduplication, crash/lease recovery, and subsequent due windows; explicitly skip when services are unavailable.
- [ ] Run focused scheduler/worker tests and existing scheduler/publishing regressions.

### Task 6: Client service, derived state, and Post Auto-Sync Settings page

**Files:**
- Create: `apps/client/src/services/postSyncSettings.service.js`
- Create: `apps/client/src/services/postSyncSettings.service.test.js`
- Create: `apps/client/src/utils/postAutoSyncSettings.js`
- Create: `apps/client/src/utils/postAutoSyncSettings.test.js`
- Create: `apps/client/src/pages/private/PostAutoSyncSettings.jsx`
- Modify: `apps/client/src/App.jsx`
- Modify: `apps/client/src/components/SideBar.jsx`

**Interfaces:**
- Service methods mirror the three backend endpoints and send only organization/integration selectors plus `enabled`.
- Utilities derive checked/indeterminate/disabled bulk state, format “Every 2 hours”, map safe backend statuses/errors, and determine whether a response still matches the selected scope generation.
- Page route: `/settings/post-auto-sync` under a Settings sidebar group.

- [ ] Write failing service tests for exact GET, individual PATCH, and bulk PATCH request shapes with no tenant/integration ownership claims beyond selectors.
- [ ] Implement the Axios service using existing cookie/session behavior.
- [ ] Write failing utility tests for all-enabled, mixed, none-manageable, missing-as-disabled, status formatting, meaningful error fallback, and stale organization/account responses.
- [ ] Implement pure utilities before page wiring.
- [ ] Build the page using existing `PageHeader`, dropdown, checkbox/toggle-capable controls, buttons/loading conventions, `useApi`, and notifications; do not modify shared form components merely for styling.
- [ ] Implement organization/account scope changes by clearing old rows and ignoring stale responses; show every authorized location, read-only permission messaging, “Every 2 hours,” last success, current status, and useful error state.
- [ ] Implement per-location and bulk saving states, repeat prevention, authoritative refresh after success, and backend-message error notifications.
- [ ] Add the route/navigation without changing Posts or Integrations behavior.
- [ ] Run client tests, lint, and build; if component DOM tests are impractical with current dependencies, keep state logic in tested pure utilities and report that limitation rather than adding an unrelated test framework.

### Task 7: Cross-feature regression, canonical PRD, and deployment evidence

**Files:**
- Modify: `apps/api/package.json`
- Update externally: canonical Google Drive PRD `1lupXsJRs96TBHCbjPoaw0EPDAul-ih8ocAr_gXvXWmQ`
- Modify this plan's checkboxes only as execution evidence; do not create a competing repository PRD.

- [ ] Run focused backend tests for config, settings, scheduler, worker, runner, lease, and transaction behavior.
- [ ] Run existing Phase 1 recovery, Phase 2 manual sync, tombstone, deletion, publish lifecycle, indexes, locations, and relevant route tests.
- [ ] Run the full backend suite with `npm test -w @parametrics/api`.
- [ ] Run syntax checks for every new/modified backend module using `node --check`.
- [ ] Run `npm test -w client`, `npm run lint -w client`, and `npm run build -w client`.
- [ ] Run opt-in real MongoDB/Redis integration tests when transaction-capable disposable services are configured; state exact skips otherwise and do not claim distributed verification.
- [ ] Run `git diff --check`, `git status --short`, and `git diff --stat`; confirm no commit, push, merge, deployment, production flag enablement, or live Google request occurred.
- [ ] Read the canonical Google Drive PRD, update it in place with Phase 3 architecture, settings/API scope, 120-minute policy, feature flags, queue/job identity, transaction-backed fencing, failures/retries, deployment, monitoring, staged rollout, emergency disable, rollback, evidence, and limitations; read back the changed section.
- [ ] Provide exact local commands for API, worker, scheduler, client, environment variables, Redis/Mongo checks, queue inspection, expired-lease recovery, disposable-location verification, and staged production rollout.
- [ ] Report starting/ending SHA, branch, changed files, test counts/results, index requirements, unresolved risks, and confirm that live-provider/production verification remains pending.

## Final self-review checklist

- Every original Phase 3 requirement maps to a task, including disabled-by-default behavior, 120-minute scheduling, multiple accounts, settings permissions, manual reset of next due time, tombstones, lifecycle protection, graceful shutdown, PRD, and rollout.
- All settings writes preserve unrelated `post_sync` fields.
- All provider writes occur only after full pagination and inside a fenced transaction.
- Queue deduplication is backed by expiring database claims and runtime leases.
- The worker revalidates the feature flag and location setting before any Google call.
- Manual synchronization remains available while automatic synchronization is disabled.
- Evidence distinguishes mocks from real MongoDB/Redis and real Google calls.
