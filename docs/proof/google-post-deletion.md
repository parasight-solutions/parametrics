# Google Business Profile Post Deletion Proof

## Summary

The post deletion path now removes a validated remote Google Business Profile local post before removing its ParaMetrics record. Publishing and deletion use atomic lifecycle claims on the existing post document, so a worker cannot start after deletion is claimed and stale worker updates cannot overwrite a later state.

## Git state

- Branch: `fix/google-post-deletion`
- Starting SHA: `918aadfba53f5c77225c7b511a520fc706ffa72a`
- Ending SHA: `918aadfba53f5c77225c7b511a520fc706ffa72a`
- Ending SHA is unchanged because the task explicitly requires all changes to remain uncommitted and unpushed.

## Root cause and fix

The previous `DELETE /api/v1/posts/:id` implementation cancelled a BullMQ job and removed the MongoDB record without calling Google. It also had no atomic coordination with an active publishing worker.

The fix adds:

- `deleteLocalPost(access, postName)` using Google Business Profile v4 `DELETE` with a validated full resource name, bearer token, no request body, empty-success support, preserved provider status/body on the integration boundary, and a 60-second request timeout;
- an atomic `deleting` claim with a 120-second operation lease and persisted deletion progress;
- exact account/location/integration validation before provider access;
- Google-first deletion for published or remotely referenced posts;
- `provider_deleted_at` recovery when provider deletion succeeds before local cleanup fails;
- atomic publishing claims and attempt-token-guarded `published`, `retrying`, and `failed` updates;
- per-post frontend loading, duplicate-click prevention, publishing-state disabling, correct `msgError` handling, and list refresh on success.

## API behavior by status

- `scheduled`, `queued`, `retrying`: atomically become `deleting`, pending publish job is removed, then the record is deleted locally without Google DELETE.
- `publishing`: HTTP 409 `post_publishing`; no deletion is attempted.
- `published`: exact provider reference and location-bound integration are validated; Google DELETE or validated 404 must complete before local deletion.
- `failed` without a provider reference: local deletion only.
- `failed` with a provider reference: Google-first deletion.
- `deleting`: a live lease returns HTTP 409 `post_deletion_in_progress`; an expired or released lease can be reclaimed and resumed.
- Other statuses, including `draft`: HTTP 409 `post_delete_status_conflict` because their separate workers are not coordinated by this deletion contract.

## Provider and partial-failure handling

- Google 204/empty success is accepted.
- A genuine 404 is accepted only after the exact provider resource has passed account/location validation.
- Google 401/403 becomes actionable `google_post_delete_auth_failed` and retains the local record.
- Google 429 becomes `google_post_delete_rate_limited` and retains the local record.
- Google 5xx becomes `google_post_delete_unavailable` and retains the local record.
- Other provider errors, including 400, are not treated as absence.
- Provider failures release the operation lease while preserving `status: deleting` and compact diagnostic metadata for an explicit retry.
- After provider success, `provider_deleted_at` is written before MongoDB deletion. A later request skips Google and retries local cleanup if MongoDB deletion failed.

## Race protections

- Deletion and publishing both use MongoDB compare-and-set filters.
- A worker can claim only `queued` or `retrying` posts.
- Worker success/failure updates require `status: publishing` and the same `publish_attempt_id`.
- A deletion request cannot claim `publishing`.
- A deletion claim changes the status before BullMQ cancellation, preventing a waiting worker from claiming the post even if job removal races.
- Operation leases prevent overlapping deletion requests; a provider timeout is shorter than the production lease so a live request cannot outlast its claim under normal process operation.
- After a process crash, lease expiry permits recovery; an already completed provider deletion is safely observed as 404.

## Files changed

- `apps/api/package.json`
- `apps/api/src/integrations/google.js`
- `apps/api/src/integrations/google.test.js`
- `apps/api/src/routes/posts.js`
- `apps/api/src/services/postDeletion.js`
- `apps/api/src/services/postDeletion.test.js`
- `apps/api/src/services/postPublishLifecycle.js`
- `apps/api/src/services/postPublishLifecycle.test.js`
- `apps/api/src/workers/postPublish.worker.js`
- `apps/client/src/constant.js`
- `apps/client/src/pages/private/Posts.jsx`
- `apps/client/src/pages/private/postDeleteUi.js`
- `apps/client/src/pages/private/postDeleteUi.test.js`
- `docs/superpowers/specs/2026-11-19-google-post-deletion-design.md`
- `docs/superpowers/plans/2026-11-19-google-post-deletion.md`
- `docs/proof/google-post-deletion.md`

The canonical Google Drive document “ParaMetrics — Unified Product Requirements Document” was updated in place with the deletion contract and verified by readback.

## Automated verification

- `node --test src/integrations/google.test.js src/services/postDeletion.test.js src/services/postPublishLifecycle.test.js`: focused backend boundary/lifecycle suite passed.
- `npm test -w @parametrics/api`: 294 tests passed, 0 failed.
- `npm test -w client`: 22 tests passed across 6 files, 0 failed. Node emitted the existing experimental localStorage warning.
- `npm run lint -w client`: 0 errors, 1 existing React Compiler warning in `PostFormPage.jsx` for React Hook Form `watch()`.
- `npm run build -w client`: succeeded; Vite emitted the existing large-chunk warning.
- `node --check` for the post route, publish worker, and deletion service: passed.
- `git diff --check`: passed.

All Google HTTP calls in automated tests were mocked. These results prove request shape, state transitions, recovery behavior, authorization scope within the service, and frontend helper behavior; they do not prove a live provider deletion.

## Remaining manual verification

The task is not fully provider-verified until an approved disposable published post is deleted through ParaMetrics and confirmed absent from Google Business Profile. No live Google deletion was attempted because no disposable post/credential authorization was provided for destructive external verification.

The frontend notification wiring was build-, lint-, and helper-tested. A browser interaction smoke test was not run in this task.

## Deployment and configuration

- No migration is required; deletion/publishing lifecycle fields are additive and appear only on involved post documents.
- No dependency or lockfile change is required.
- API and worker processes must be deployed from the same revision so both sides use the atomic lifecycle contract.
- Existing Google OAuth scopes must allow Local Posts deletion; otherwise the API returns an actionable provider authorization error and retains the record.

## Rollback

Revert the scoped API integration helper, post deletion/publish lifecycle services, route and worker wiring, frontend row-state changes, and their tests/docs. No schema migration or dependency rollback is needed. If API and worker deploys are versioned separately, roll both back together to avoid mixed lifecycle semantics.

## Commit and push gate

No commit, push, merge, or deployment was performed. The working tree is intentionally left for human review.
