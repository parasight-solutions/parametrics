# Reviews List Filtering and Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-safe server-side filtering, literal search, authoritative counts, deterministic pagination, and legacy UI consumption to the existing Reviews module.

**Architecture:** A focused `reviewList` service validates query input and builds a location-first MongoDB `$facet` aggregation with migration-free reply classification. The existing route supplies the authorized scope and sync metadata. The legacy Reviews page stores list state in the URL and guards debounced/aborted requests against stale results.

**Tech Stack:** Node.js 20, Express, MongoDB aggregation, React 19, React Router, native Fetch, Node test runner, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-25-reviews-list-filter-pagination-design.md`

## Global Constraints

- Modify only `apps/api`, `apps/web`, necessary task/proof documentation, and the canonical Google Drive PRD.
- Do not modify `apps/client` or `feat/automatic-google-post-sync`.
- Do not add a persisted reply-status field, schema migration, or database backfill.
- Preserve the existing review reply and synchronization API contracts and provider behavior.
- Keep standardized API response envelopes and tenant authorization unchanged.
- Leave changes uncommitted and unpushed.

## Review Focus

- A non-string `reviewReply.comment` must be classified as unreplied without making `$trim` fail; Task 1 pins this.
- Regex metacharacters and Unicode keyword input must remain literal and location-scoped; Task 1 pins this.
- A requested page beyond `totalPages` must stay requested and return no rows, not another page; Tasks 1 and 2 pin this.
- A slow Location A/search request must never replace a newer Location B/filter result; Task 3 pins this.
- Reply success on the last item of an unreplied page must preserve filters and recover to a valid page; Task 3 pins this.

---

### Task 1: Review-list query and aggregation service

**Files:**
- Create: `apps/api/src/services/reviewList.js`
- Create: `apps/api/src/services/reviewList.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `normalizeReviewListQuery(query)` returning `{ status, keyword, page, perPage }`
- Produces: `buildReviewReplyExpression()` and `buildReviewListPipeline({ baseFilter, query })`
- Produces: `readReviewListFacet(result, query)` returning `{ reviews, pagination, counts }`
- Produces constants `REVIEW_LIST_DEFAULT_PER_PAGE = 10` and `REVIEW_LIST_MAX_PER_PAGE = 100`

- [ ] **Step 1: Write failing service tests**

Cover exact defaults/aliases, cap 100, invalid arrays/types/integers/status, over-200 keyword rejection, regex escaping, missing/null/non-string/empty/whitespace/valid reply classification, AND-combined status and keyword pipeline, location-first `$match`, deterministic sort with `_id`, skip/limit, `_id` removal, empty facet, and out-of-range metadata.

- [ ] **Step 2: Run the focused service test and verify RED**

Run: `node --test apps/api/src/services/reviewList.test.js`

Expected: FAIL because `reviewList.js` does not exist.

- [ ] **Step 3: Implement the pure review-list service**

Validate scalar query values without coercing arrays/objects. Build a type-safe `$expr` using `$type`, `$cond`, `$trim`, and `$strLenCP`. Escape keyword regex input. Build one location-first `$facet` pipeline for page rows, matching count, and location-wide counts; parse absent facet buckets as zero.

- [ ] **Step 4: Register and run the service test**

Add the test file to the API workspace test script, then run `npm test -w @parametrics/api -- --test-name-pattern="review list"` if supported; otherwise run the focused Node command followed by `npm test -w @parametrics/api`.

Expected: all service tests and the API suite pass.

### Task 2: Authorized Reviews endpoint and index integration

**Files:**
- Modify: `apps/api/src/routes/reviews.js`
- Create: `apps/api/src/routes/reviews.test.js`
- Modify: `apps/api/src/startup/ensureIndexes.js`
- Modify: `apps/api/src/startup/ensureIndexes.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: Task 1 query/pipeline/facet helpers
- Produces: existing `GET /api/v1/reviews` success data `{ reviews, pagination, counts, sync }`

- [ ] **Step 1: Write failing HTTP and index tests**

Cover default and combined queries, 400 validation envelopes, authorized scope as the aggregation's first match, unauthorized/cross-org/cross-client denial, correct page/count/sync response, `_id` omission, out-of-range page, deterministic index tiebreaker, successful reply reclassification, failed provider reply leaving classification unchanged, and existing sync endpoint compatibility.

- [ ] **Step 2: Run focused route/index tests and verify RED**

Run: `node --test apps/api/src/routes/reviews.test.js apps/api/src/startup/ensureIndexes.test.js`

Expected: FAIL because the route still uses `find().limit(200)` and the index lacks `_id`.

- [ ] **Step 3: Integrate the service into the existing route**

Authorize first, construct `buildLocationScopeFilter(loc, { provider: "google" })`, aggregate once, retain sync lookup, and return message `Reviews fetched successfully`. Do not issue provider requests from GET. Preserve provider-first reply writes and existing role checks.

- [ ] **Step 4: Adjust the one listing index**

Extend the existing user/location/provider/updateTime/createTime index with `_id: -1`; retain tenancy indexes and avoid speculative search/reply indexes.

- [ ] **Step 5: Run focused and complete API tests**

Run: `node --test apps/api/src/services/reviewList.test.js apps/api/src/routes/reviews.test.js apps/api/src/startup/ensureIndexes.test.js`

Run: `npm test -w @parametrics/api`

Expected: all focused tests and the entire backend suite pass, including existing reply/sync regressions.

### Task 3: Legacy Reviews page server-state integration

**Files:**
- Modify: `apps/web/src/pages/Reviews.jsx`
- Create: `apps/web/src/pages/Reviews.test.jsx`

**Interfaces:**
- Consumes: Task 2 response data `{ reviews, pagination, counts, sync }`
- Produces: URL state `status`, `keyword`, `page`, `perPage` and mounted legacy interactions

- [ ] **Step 1: Write failing mounted page tests**

Cover explicit All/Replied/Unreplied selection, authoritative counts, 350 ms search debounce, clear search, combined filters, URL initialization and Back/Forward, previous/next, page sizes 10/20/50/100, reset-to-page-1 rules, loading/error/empty states, stale location/search response protection, reply success refresh and invalid-page recovery, reply failure retention, sync queued messaging/metadata, and standardized `result.data` parsing.

- [ ] **Step 2: Run the mounted test and verify RED**

Run: `npm test -w @parametrics/web -- --run src/pages/Reviews.test.jsx`

Expected: FAIL because the page still filters one 200-row client array and has no server pagination.

- [ ] **Step 3: Replace client filtering with URL-driven server state**

Use `URLSearchParams`, explicit `all` default, debounced keyword, generation plus AbortController, authoritative counts/pagination, disabled page controls, displayed range, page-size selector, and safe error messaging. Keep the current visual structure, reply editor, sync controls, and location picker.

- [ ] **Step 4: Preserve reply and sync workflows**

After reply, reload active server filters and step back to the last valid page when necessary. Treat sync success as queued, refresh metadata once, and do not introduce polling.

- [ ] **Step 5: Run focused and complete legacy tests**

Run: `npm test -w @parametrics/web -- --run src/pages/Reviews.test.jsx`

Run: `npm test -w @parametrics/web -- --run`

Expected: mounted Reviews tests and the complete legacy suite pass.

### Task 4: Verification, proof, and canonical documentation

**Files:**
- Create: `docs/proof/reviews-list-filter-pagination.md`
- Modify: canonical ParaMetrics Google Drive PRD

**Interfaces:**
- Consumes: Tasks 1–3 behavior and evidence
- Produces: review-ready uncommitted feature branch and exact rollback/limitations record

- [ ] **Step 1: Run all required verification**

Run: `npm test -w @parametrics/api`

Run: `npm test -w @parametrics/web -- --run`

Run: `npm run lint -w @parametrics/web`

Run: `npm run build -w @parametrics/web`

Run: `git diff --check`

Expected: all commands pass.

- [ ] **Step 2: Audit scope and invariants**

Confirm `apps/client` has no changes, current branch is `feat/reviews-list-filter-pagination`, HEAD remains the starting SHA because work is uncommitted, and `feat/automatic-google-post-sync` remains unchanged.

- [ ] **Step 3: Document performance and proof**

Record normalization, pipeline shape, classification semantics, index change, reply/search limitations, exact test counts, browser status, rollback, and the absence of migrations/backfills.

- [ ] **Step 4: Update and read back the canonical Google Drive PRD**

Document the Reviews contract, legacy UI behavior, index/performance trade-off, verification, limitations, and rollback without claiming unperformed browser automation.
