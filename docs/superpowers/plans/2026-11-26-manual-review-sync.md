# Manual Review Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every manual review sync a complete reconciliation and expose the last successful sync timestamp plus numeric review ratings.

**Architecture:** The HTTP route queues an explicit full-mode BullMQ job and resolves duplicates from actual job state. A new injectable review-sync service owns full Google pagination, scoped MongoDB upserts, real counters, and success-only timestamp advancement. The listing service normalizes provider ratings at the response boundary.

**Tech Stack:** Node.js, Express, BullMQ, MongoDB, React, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-manual-review-sync-design.md`

## Global Constraints

- Do not modify `apps/client`.
- Do not add automatic review sync, a scheduler, migration, or backfill.
- Preserve tenant authorization, pagination, filters, replies, standardized envelopes, and BullMQ retries.
- Leave changes uncommitted and unpushed.

## Review Focus

- Legacy jobs containing `since` still fetch all pages.
- A partial Google/database failure never advances `last_synced_at`.
- Active duplicate jobs are not requeued, while completed/failed jobs do not block later requests.
- Insert-only local IDs remain stable on repeated reconciliation.
- Invalid stored star ratings cannot leak provider enums or invalid numbers through the API.

---

### Task 1: Response contract normalization

**Files:**
- Modify: `apps/api/src/services/reviewList.js`
- Modify: `apps/api/src/services/reviewList.test.js`
- Modify: `apps/api/src/routes/reviews.js`
- Modify: `apps/api/src/routes/reviews.test.js`
- Modify: `apps/web/src/pages/Reviews.jsx`
- Modify: `apps/web/src/pages/Reviews.test.jsx`

- [ ] Write failing tests for numeric ratings and `lastSyncedAt` ISO/null behavior.
- [ ] Normalize rating values in the aggregation response without changing MongoDB records.
- [ ] Add `lastSyncedAt` from authorized sync state and simplify the legacy rating consumer.
- [ ] Run focused API and web tests.

### Task 2: Full reconciliation service

**Files:**
- Create: `apps/api/src/services/reviewSync.js`
- Create: `apps/api/src/services/reviewSync.test.js`
- Modify: `apps/api/src/workers/reviewSync.worker.js`
- Modify: `apps/api/package.json`

- [ ] Write failing worker-service tests for all pages, legacy `since`, counters, stable IDs, tenant scope, retries/errors, and timestamp preservation.
- [ ] Implement the injectable full-reconciliation processor and thin BullMQ adapter.
- [ ] Register tests and run the focused/full API suite.

### Task 3: Manual queue lifecycle

**Files:**
- Modify: `apps/api/src/routes/reviews.js`
- Modify: `apps/api/src/routes/reviews.test.js`

- [ ] Write failing HTTP-level tests for full payloads, force compatibility, active duplicates, retained completed/failed jobs, stale state, and repeated clicks.
- [ ] Implement actual BullMQ job-state duplicate handling and queue `mode: "full", since: null`.
- [ ] Run focused/full API tests.

### Task 4: Verification and documentation

**Files:**
- Modify: `docs/proof/reviews-list-filter-pagination.md`
- Modify: canonical ParaMetrics Google Drive PRD

- [ ] Run API/web tests, web lint/build, and `git diff --check`.
- [ ] Confirm `apps/client` has no diff and branch/HEAD remain unchanged.
- [ ] Record actual evidence, limitations, rollback, and update/read back the canonical PRD.
