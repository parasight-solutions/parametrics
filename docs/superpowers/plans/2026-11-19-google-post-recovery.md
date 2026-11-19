# Phase 1 Google Business Profile Post Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dry-run-first, one-location CLI that imports missing Google Local Posts into MongoDB as published records without duplicating, modifying, publishing, or deleting anything else.

**Architecture:** A reusable service validates the supplied location/integration, confirms provider access, fetches and validates every Google page, reconciles exact provider names and deterministic recovery identities, and applies only `$setOnInsert` upserts. A thin CLI resolves the location and integration from MongoDB, invokes the service, prints a safe structured summary, and defaults to dry-run.

**Tech Stack:** Node.js ESM, MongoDB, native crypto, existing Google Business Profile integration helpers, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-google-post-recovery-design.md`

## Global Constraints

- Base branch is `fix/google-post-deletion` at starting SHA `0e51f832dcfaf476011a3ee6eada30bdd666052a`.
- Do not commit, push, merge, deploy, or execute a real recovery apply.
- Preserve all Google-first deletion behavior and existing frontend behavior.
- No new index, migration, dependency, API route, frontend feature, queue, worker, or scheduler.
- The command accepts only `--location-id` as scope input; never accept user, organization, client, integration, provider account/location, or OAuth values from CLI arguments.
- Fetch and validate all Google Local Post pages before any MongoDB mutation.
- Dry-run is the default; writes require explicit `--apply`.
- Never update or delete existing MongoDB posts, call Google DELETE/POST, or enqueue jobs.
- Deterministic `_id` idempotency applies only to recovery imports and is not a universal provider-reference uniqueness guarantee.
- Never print tokens, integration secrets, raw user documents, or raw provider error bodies.

## Review Focus

- A provider page failure after earlier pages must produce zero MongoDB writes; Task 2 tests a second-page rejection and mutation count zero.
- A provider-name match outside the selected tenancy scope must be a conflict, not a missing record; Task 2 tests user, organization, client, location, and integration mismatches.
- Two concurrent apply calls starting from the same empty snapshot must converge on one imported `_id` and application `id`; Task 2 tests overlapping upserts on a shared collection double.
- A deterministic `_id` collision with different provider identity must be reported and skipped; Task 2 tests the collision document remains unchanged.
- An integration that exists but cannot list the bound account/location must stop before post listing or writes; Task 3 tests both account and location access failures.

---

### Task 1: Provider Normalization and Deterministic Recovery Identity

**Files:**
- Create: `apps/api/src/services/postSync.js`
- Create: `apps/api/src/services/postSync.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `validateGooglePostName(name, location): { valid: boolean, code: string | null }`.
- Produces `buildGoogleRecoveryIdentity({ locationId, providerPostName }): { mongoId: string, postId: string }`.
- Produces `buildImportedPost({ googlePost, location, identity, now }): object`.
- Reuses `providerFieldsFromGooglePost` for sanitized public post URLs.

- [ ] **Step 1: Write failing normalization and identity tests**

Tests prove malformed, missing, wrong-account, and wrong-location names are rejected; the exact expected resource is accepted; the same location/name always yields the same versioned `mongoId` and UUID-form `postId`; different names or locations yield different identities; and a representative Google post maps to a published, correctly scoped document without AI, recurrence, scheduling, queue, or publish-attempt fields.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test apps/api/src/services/postSync.test.js`

Expected: FAIL because `postSync.js` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Use SHA-256 over a versioned canonical string containing `location.id` and the exact provider resource. Encode `_id` as a namespaced lowercase hex string. Convert fixed hash bytes into an RFC 4122 UUID-shaped application `id` with stable version/variant bits. Map supported provider fields conservatively and use local import time for local timestamps.

- [ ] **Step 4: Register and rerun the focused test**

Add `postSync.test.js` to the API test script.

Expected: all Task 1 tests pass.

### Task 2: Complete Fetch, Reconciliation, and Idempotent Apply Service

**Files:**
- Modify: `apps/api/src/services/postSync.js`
- Modify: `apps/api/src/services/postSync.test.js`

**Interfaces:**
- Consumes Task 1 helpers.
- Produces `fetchAllGoogleLocalPosts({ access, location, pageSize?, maxPages?, maxPosts? }, { listLocalPosts }): Promise<{ posts, pages, unusuallyLarge }>`.
- Produces `recoverGooglePosts({ location, integration, apply?, now? }, dependencies): Promise<RecoveryResult>`.
- Dependencies include `{ posts, ensureAccessToken, listAccounts, listLocations, listLocalPosts }`; there are deliberately no queue, publish, update-existing, or delete dependencies.

- [ ] **Step 1: Write failing complete-fetch tests**

Cover one page, multiple pages with exact page-token forwarding, empty results, repeated token rejection, maximum page/post bounds, and a later-page provider failure. Assert that failure occurs before any MongoDB read/write in the orchestration test.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: FAIL because pagination orchestration is absent.

- [ ] **Step 3: Implement complete bounded pagination**

Accumulate every page before returning, track seen request/response tokens, reject repetition, and reject over-limit datasets with stable compact error codes.

- [ ] **Step 4: Write failing reconciliation and dry-run tests**

Cover exact in-scope existing match, duplicate exact matches, out-of-scope/conflicting matches, invalid provider records, duplicate names within the Google result, deterministic `_id` collision, missing record eligibility, and dry-run zero mutations. Assert existing scheduled, queued, failed, and published records are byte-for-byte unchanged.

- [ ] **Step 5: Implement read-only planning**

After full provider fetch/validation, query posts in one bounded lookup using both exact provider names and deterministic `_id` values. Classify every provider result as existing, eligible, invalid, or conflict. Do not modify documents while planning.

- [ ] **Step 6: Write failing apply/idempotency/concurrency tests**

Cover one missing import, repeated apply with zero new insertions, two concurrent recoveries converging on one record, `$setOnInsert`-only updates, stable application `id`, imported published/list-compatible fields, no job/publish/delete effects, and recovery output counts/record outcomes.

- [ ] **Step 7: Implement apply mode**

For eligible records only, call `updateOne({ _id: identity.mongoId }, { $setOnInsert: document }, { upsert: true })`. Count `upsertedCount === 1` as inserted and a concurrent match as already existing. Never issue `$set`, replacement writes, delete operations, or queue calls.

- [ ] **Step 8: Run the full focused service suite and verify GREEN**

Run: `node --test apps/api/src/services/postSync.test.js`

Expected: all service tests pass.

### Task 3: Location-scoped Dry-run-first CLI

**Files:**
- Create: `apps/api/src/services/postRecoveryCli.js`
- Create: `apps/api/src/services/postRecoveryCli.test.js`
- Create: `apps/api/src/scripts/recover.google-posts.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `parsePostRecoveryArgs(argv): { locationId: string, apply: boolean }`.
- Produces `runPostRecoveryCli(options, dependencies): Promise<RecoveryResult>` for a testable CLI orchestration boundary.
- Script dependencies resolve `locations`, `posts`, `organization_members`, the exact integration, Google helpers, and `closeDb` from existing modules.

- [ ] **Step 1: Write failing CLI argument tests**

Cover default dry-run, explicit `--dry-run`, explicit `--apply`, missing/blank/duplicate location id, unknown flags, conflicting mode flags, and attempted raw scope/token flags.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `node --test apps/api/src/services/postRecoveryCli.test.js`

Expected: FAIL because the CLI service does not exist.

- [ ] **Step 3: Implement strict parsing and safe output shaping**

Accept `--location-id=value` exactly once and one optional mode. Output only the selected location summary, provider identifiers, aggregate counts, safe outcome ids/references, and compact codes.

- [ ] **Step 4: Write failing location/integration/access tests**

Cover missing location; non-Google location; missing user/org/client/integration/provider fields; missing/disabled integration; inactive/missing organization membership or disallowed role; account not visible to integration; location not visible within account; token refresh failure; and the valid path. Assert every invalid path performs zero post writes and never calls post listing when access validation has not completed.

- [ ] **Step 5: Implement CLI orchestration**

Load the location by `{ id: locationId, provider: "google" }`, validate complete scope, require the owning user’s active membership with an operation-capable role and assignment, load the exact integration with `getGoogleIntegrationById`, and delegate access/list/import behavior to `recoverGooglePosts`. Always close MongoDB in the executable wrapper.

- [ ] **Step 6: Register scripts and tests**

Add the CLI test to the API test command and add:

```json
"posts:recover": "node src/scripts/recover.google-posts.js"
```

- [ ] **Step 7: Run focused CLI and service tests**

Run: `node --test apps/api/src/services/postSync.test.js apps/api/src/services/postRecoveryCli.test.js`

Expected: all tests pass.

### Task 4: Deletion Compatibility, Documentation, and Verification

**Files:**
- Modify: `apps/api/src/services/postSync.test.js`
- Create: `docs/proof/google-post-recovery.md`
- Update externally after implementation: canonical Google Drive PRD `1lupXsJRs96TBHCbjPoaw0EPDAul-ih8ocAr_gXvXWmQ`

**Interfaces:**
- Consumes the imported document contract and existing `deletePostWithProvider` scope/reference requirements.
- Produces final automated evidence and human-run commands; performs no live recovery.

- [ ] **Step 1: Add failing compatibility tests**

Feed an imported document into the existing deletion service with a matching location and mocked Google DELETE. Assert it passes scope/provider/integration validation, uses the exact provider resource, and completes Google-first local deletion. Also assert the imported document matches fields exposed by the existing Posts listing/detail serializers.

- [ ] **Step 2: Make only the smallest compatibility correction if the test exposes a defect**

Prefer correcting imported document mapping. Do not change normal deletion unless the test proves an unavoidable compatibility defect; document any such change explicitly.

- [ ] **Step 3: Run complete automated verification**

Run:

```powershell
npm test -w @parametrics/api
node --check apps/api/src/services/postSync.js
node --check apps/api/src/services/postRecoveryCli.js
node --check apps/api/src/scripts/recover.google-posts.js
git diff --check
```

Expected: all API tests pass, syntax checks pass, and diff hygiene is clean.

- [ ] **Step 4: Demonstrate CLI safety without connecting to the real database**

Run parser/orchestration tests that show no-flag mode is dry-run and `--apply` is required for mutations. Do not execute the CLI against the configured database or Google account.

- [ ] **Step 5: Update the canonical PRD**

Document why recovery is required, exact-name identity, deterministic recovery-only `_id` scope, inserted record contract, commands, automated evidence, live dry-run gap, and deferred Phase 2/3 work. Read back the changed section.

- [ ] **Step 6: Write the local proof pack**

Record branch and SHAs, files and purpose, architecture, exact commands, representative safe output, tests/results, limitations, no-index decision, verification checklist, rollback, and confirmation that no real recovery, commit, push, merge, or deploy occurred.

- [ ] **Step 7: Leave changes uncommitted and unpushed**

Verify branch, HEAD, status, and scoped diff. Do not run the real dry-run or apply command; hand both commands to the user.
