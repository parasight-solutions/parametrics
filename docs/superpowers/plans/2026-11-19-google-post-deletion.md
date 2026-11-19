# Google Business Profile Post Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ParaMetrics post deletion remove validated remote Google Business Profile posts while preventing worker races and supporting safe recovery from partial failures.

**Architecture:** Add a focused post-deletion service that atomically claims the existing post document, validates provider/integration scope, records provider progress, and performs Google-first cleanup. Add a focused publish-lifecycle service so workers claim publishable posts and all later updates require the same attempt token. Keep the route and React page as thin adapters.

**Tech Stack:** Node.js ESM, Express, MongoDB, BullMQ, native `fetch`, React 19, Axios, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-google-post-deletion-design.md`

## Global Constraints

- Work only on `fix/google-post-deletion`, which started at `918aadfba53f5c77225c7b511a520fc706ffa72a`.
- Do not commit, push, merge, deploy, install dependencies, or modify `main`.
- Preserve authentication, organization membership, location ownership, and client scope checks.
- Use only the existing `posts` document for deletion and publishing coordination; add no collection or Redis lock.
- Add no frontend confirmation dialog.
- Do not change Create Post, image upload, CTA, editing, or unrelated provider behavior.
- Treat only a genuine Google 404 for an already validated exact resource as remote absence.
- Never expose OAuth tokens or raw sensitive provider data in responses, logs, tests, or proof documents.

## Review Focus

- A stale worker that claimed an older attempt must not write `published`, `failed`, or `retrying` after deletion or a newer attempt; Task 2 tests every conditional transition with a mismatched token.
- A `deleting` record with an expired operation lease must be resumable, while an unexpired lease must return deterministic conflict; Task 3 tests both boundaries.
- A post/location account, location, or integration mismatch must stop before any Google request; Task 3 tests each mismatch.
- Google success followed by MongoDB failure must leave `provider_deleted_at` and permit a retry that skips Google; Task 3 tests the two-request sequence.
- Two requests that overlap around local cleanup must never report provider success while retaining an untracked remote post; Task 3 tests duplicate claims and idempotent cleanup outcomes.

---

### Task 1: Google Local Post DELETE Boundary

**Files:**
- Modify: `apps/api/src/integrations/google.js`
- Create: `apps/api/src/integrations/google.test.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `deleteLocalPost(access: string | { access_token: string }, postName: string): Promise<object>`.
- Throws `invalid_local_post_name` before fetching for malformed names.
- Preserves `error.status` and `error.body` from Google failures.

- [ ] **Step 1: Write failing integration-boundary tests**

Add tests proving the production change “wrong method/name/token handling or inability to accept an empty response” fails:

- exact URL `https://mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts/789`;
- method `DELETE`, bearer token, and no request body;
- HTTP 204/empty response resolves to `{}`;
- malformed or partial names reject before `fetch`;
- a Google 404 retains status and parsed error body.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test apps/api/src/integrations/google.test.js`

Expected: FAIL because `deleteLocalPost` is not exported.

- [ ] **Step 3: Implement `deleteLocalPost` using the existing token resolver and `callGoogleJson`**

Validate `^accounts/[^/]+/locations/[^/]+/localPosts/[^/]+$`, call the existing v4 base with `{ method: "DELETE" }`, and do not set a body.

- [ ] **Step 4: Register the focused test and verify GREEN**

Add the new file to the API `test` script, then run the focused command again.

Expected: all Task 1 tests pass.

### Task 2: Atomic Publish Lifecycle

**Files:**
- Create: `apps/api/src/services/postPublishLifecycle.js`
- Create: `apps/api/src/services/postPublishLifecycle.test.js`
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/src/workers/postPublish.worker.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `claimPostForPublishing(posts, { postId, userId, attemptId, now }): Promise<post | null>`; only `queued`/`retrying` may become `publishing`.
- Produces `markPostPublished(posts, { scope, attemptId, providerFields, now }): Promise<boolean>`.
- Produces `markPostPublishFailure(posts, { scope, attemptId, status, providerError, detail, metadata, now }): Promise<boolean>`.
- `publishPostNow(postId, { userId, attemptId })` uses the atomic claim and never issues Google POST when it returns null.

- [ ] **Step 1: Write failing lifecycle tests**

Use an in-memory Mongo-like collection double that applies the actual filters and updates. Cover:

- queued/retrying claims succeed and record `publish_attempt_id`;
- scheduled/publishing/published/deleting/failed claims fail;
- published write requires `status: "publishing"` plus matching attempt id;
- retrying and failed writes require the same conditions;
- stale attempt ids and a deletion state leave the document unchanged.

- [ ] **Step 2: Run the focused lifecycle test and verify RED**

Run: `node --test apps/api/src/services/postPublishLifecycle.test.js`

Expected: FAIL because the lifecycle module does not exist.

- [ ] **Step 3: Implement the lifecycle helpers and wire `publishPostNow`**

Make the MongoDB filter—not an earlier read—the authority for every transition. Return a distinct `post_publish_not_claimed` error when the publish claim fails so the worker treats a deletion conflict as non-retryable without changing post state.

- [ ] **Step 4: Update the worker to create and propagate a unique attempt id**

Derive it from job id and attempt number plus a UUID-safe suffix. Remove the unconditional `markPublishing`. Route every success/failure update through Task 2 helpers; if a conditional update returns false, log only summarized ids/outcome and leave the post unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test apps/api/src/services/postPublishLifecycle.test.js apps/api/src/services/postPublishFailure.test.js apps/api/src/services/googlePostPayload.test.js`

Expected: all tests pass.

### Task 3: Recoverable Google-first Post Deletion

**Files:**
- Create: `apps/api/src/services/postDeletion.js`
- Create: `apps/api/src/services/postDeletion.test.js`
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `deleteLocalPost`, `getGoogleIntegrationById`, `ensureAccessToken`, Task 2 publish-state contract, existing queue job removal, and scoped location/post documents.
- Produces `deletePostWithProvider(params, dependencies): Promise<{ ok: true, remote: "deleted" | "absent" | "not_required" | "already_deleted" }>`.
- `params` includes `{ post, location, userId, now }`; dependencies inject posts collection, job removal, integration/token lookup, and Google delete for deterministic tests.
- Uses fields `deletion_previous_status`, `deletion_operation_id`, `deletion_operation_expires_at`, `deletion_started_at`, `deletion_last_attempt_at`, `deletion_error`, and `provider_deleted_at`.

- [ ] **Step 1: Write failing provider-reference and status tests**

Cover literal outcomes for:

- scheduled, queued, and retrying records: claim, cancel job, local delete, no Google call;
- publishing: HTTP 409 conflict and no state change;
- failed without provider reference: local delete only;
- published or failed-with-reference: exact validated Google resource;
- missing/malformed published reference: reconciliation-required conflict;
- account, location, post binding, or integration mismatch: conflict before token/Google access;
- unauthorized/scope-mismatched inputs remain rejected by the existing route guards (route-level test or extracted handler test with real guard contract).

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test apps/api/src/services/postDeletion.test.js`

Expected: FAIL because the deletion service does not exist.

- [ ] **Step 3: Implement atomic deletion claiming and validation**

Use full tenancy scope and eligible status in the initial compare-and-set. For existing `deleting` state, acquire only when no live operation lease exists. Preserve the original status and provider progress across retries. Validate the exact expected prefix from the location before resolving its bound integration.

- [ ] **Step 4: Add failing remote-error and recovery tests**

Cover:

- 204 success records `provider_deleted_at` before local deletion;
- validated Google 404 records absence and permits cleanup;
- 401/403/429/5xx preserve the local record, store compact actionable error state, release the operation lease, and permit a later DELETE retry;
- unexpected 400 is not treated as absence;
- local delete failure after provider success preserves `provider_deleted_at`, releases the lease, and a later request skips Google and completes;
- an unexpired duplicate request returns deterministic 409 without another Google call;
- an expired lease can be reclaimed;
- overlapping cleanup requests produce at most one provider call and an idempotent successful/absent local outcome.

- [ ] **Step 5: Run the expanded tests and verify RED**

Run the same focused command.

Expected: new recovery assertions fail until provider progress/error paths exist.

- [ ] **Step 6: Implement Google-first deletion, progress persistence, and resume behavior**

Record provider completion conditionally with the operation id, release the lease on provider/local failures, and only return success after `deleteOne.deletedCount === 1` or a scoped recheck confirms an overlapping request already removed the claimed record.

- [ ] **Step 7: Replace the route’s direct queue/Mongo deletion with the service**

Keep authentication and existing organization/location access checks in place. Map stable service errors through `toApiError`, include safe audit metadata, and never return raw Google bodies or tokens.

- [ ] **Step 8: Run focused backend tests and verify GREEN**

Run: `node --test apps/api/src/integrations/google.test.js apps/api/src/services/postPublishLifecycle.test.js apps/api/src/services/postDeletion.test.js`

Expected: all focused tests pass.

### Task 4: Per-post Frontend Deletion State and Errors

**Files:**
- Create: `apps/client/src/pages/private/postDeleteUi.js`
- Create: `apps/client/src/pages/private/postDeleteUi.test.js`
- Modify: `apps/client/src/pages/private/Posts.jsx`

**Interfaces:**
- Produces `getPostDeleteErrorMessage(error): string` from the backend Axios error shape with a safe fallback.
- Produces `isPostDeleteDisabled({ status, postId, deletingPostId }): boolean`.

- [ ] **Step 1: Write failing frontend behavior tests**

Cover meaningful backend message extraction, fallback text, publishing disabled, only the active row disabled during deletion, and unrelated rows remaining enabled.

- [ ] **Step 2: Run the focused client test and verify RED**

Run: `npm test -w client -- src/pages/private/postDeleteUi.test.js`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement helpers and wire `Posts.jsx`**

Track `deletingPostId`, ignore repeated calls for that id, use `callApi` without adding confirmation UI, refresh after success, call `msgSuccess` only on success, and call `msgError(getPostDeleteErrorMessage(error))` on failure. Pass row-specific loading/disabled props supported by the existing `ActionButton`; do not modify shared UI unless the existing API cannot express the state.

- [ ] **Step 4: Run focused client tests and verify GREEN**

Run the same focused command.

Expected: all helper tests pass.

### Task 5: Documentation and Full Verification

**Files:**
- Modify the relevant existing Google Drive project document only if a connected canonical document is discoverable and writable.
- Create: `docs/proof/google-post-deletion.md`
- Modify only if required by actual behavior: `docs/runtime/post-image-uploads.md` or another existing local canonical post-runtime document.

**Interfaces:**
- Consumes verified behavior and command output from Tasks 1–4.
- Produces a proof pack that clearly separates mocked evidence from live Google verification.

- [ ] **Step 1: Run the complete automated verification**

Run:

```powershell
npm test -w @parametrics/api
npm test -w client
npm run lint -w client
npm run build -w client
git diff --check
```

Expected: API and client tests pass; lint has no errors; build succeeds; diff check is clean. Record warnings exactly.

- [ ] **Step 2: Review scope and secrets**

Run `git status --short`, `git diff --stat`, and scoped diffs for all task files. Confirm no token, raw authorization header, environment value, build artifact, unrelated module, confirmation dialog, or dependency change is present.

- [ ] **Step 3: Update canonical documentation if available**

If a connected Google Drive document is clearly the existing ParaMetrics project source of truth, document status transitions, error handling, concurrency, partial-failure recovery, and verification. If none is available, state that gap; do not create a duplicate documentation system.

- [ ] **Step 4: Write the local proof pack**

Record starting/ending SHA, branch, files changed, root cause/fix, status matrix, Google request/error contract, race protections, exact commands/results, unrelated failures, deployment implications, rollback, and the explicit live-verification gap.

- [ ] **Step 5: Leave the branch uncommitted and unpushed**

Verify `git branch --show-current` is `fix/google-post-deletion` and report the working tree for human review. Do not commit, push, merge, or deploy.
