# Google Business Profile Post Deletion Design

## Intent

Deleting a ParaMetrics post must also delete an associated published Google Business Profile post. The operation must preserve tenancy checks, avoid publishing/deletion races, and remain recoverable when Google succeeds but MongoDB cleanup fails.

## Goals

- Use the post's validated Google resource name and location-bound integration.
- Claim deletion atomically on the existing post document with `status: "deleting"`.
- Make publishing and all worker state updates conditional so stale workers cannot overwrite deletion state.
- Delete remotely before deleting the local record when a remote post may exist.
- Retain enough progress and error information for deterministic retries and diagnosis.
- Keep frontend changes limited to per-post loading, repeat-click prevention, publishing-state disabling, correct notifications, and list refresh.

## Non-goals

- No deletion/outbox collection or Redis locking.
- No automatic retry loop or scheduler for deletion.
- No frontend confirmation dialog.
- No changes to post creation, editing, image upload, CTA behavior, or unrelated provider flows.

## Selected approach

Use atomic compare-and-set transitions on the existing `posts` document. This is smaller than a new outbox model and survives process crashes better than a Redis-only lock because deletion progress remains with the record.

Alternatives rejected:

- A dedicated deletion/outbox collection offers a richer operation history but adds unnecessary persistence and operational scope.
- Redis/BullMQ locks do not by themselves recover the Google-success/Mongo-failure boundary and are not the source of truth.

## Post lifecycle and concurrency

Deletion claims eligible records with an atomic update whose filter includes the complete user, organization, client, and location scope plus the current status. The update sets `status: "deleting"`, records the prior status in `deletion_previous_status`, initializes deletion timestamps/attempt metadata, and preserves any existing `provider_deleted_at`.

- `scheduled` and safely queued/retrying posts: claim deletion, remove the pending BullMQ job, then delete locally without a Google call.
- `publishing`: reject with HTTP 409; the frontend disables this action as well.
- `published`: claim deletion, validate the exact provider reference, delete through Google, record `provider_deleted_at`, then delete locally.
- `failed` without a provider reference: delete locally after claiming.
- `failed` with a valid provider reference: perform the Google-first path.
- `deleting`: a duplicate request resumes the recorded operation when it owns valid deletion state. If another request is actively performing the provider step, a short compare-and-set lease/operation token makes the duplicate deterministic and prevents duplicate provider calls.

The worker claims only publishable states (`queued` or `retrying`) by atomically changing them to `publishing` and recording a unique attempt token. If the claim fails, it exits without calling Google. Its subsequent `published`, `retrying`, and `failed` writes require both `status: "publishing"` and the same attempt token. A stale attempt therefore cannot overwrite `deleting` or a newer attempt.

## Provider validation and integration selection

`deleteLocalPost(access, postName)` in `integrations/google.js` validates the complete `accounts/*/locations/*/localPosts/*` resource, uses the established v4 base and OAuth token resolver, sends an empty-body HTTP DELETE, accepts an empty success response, and preserves Google status/body details on failures.

Before calling it, the deletion service verifies that `provider_post_name` exactly matches the account and location stored on the scoped location/post. It resolves the integration bound to that location, verifies consistency with the post binding, and obtains/refreshed its token through `ensureAccessToken`. It never falls back blindly to the currently active integration.

Only a genuine Google 404 for the already validated exact resource counts as already absent. Authentication, permission, rate-limit, and server failures remain errors.

## Partial failures and retry behavior

If Google deletion fails, the post remains `deleting` with compact provider error details and a retryable deletion state. A later explicit DELETE request may reacquire the operation and retry; there is no blind background retry.

After Google success or verified 404, the service atomically records `provider_deleted_at` before attempting local deletion. If local deletion fails, the retained record proves the provider step completed. A later DELETE skips Google and retries only local cleanup.

Malformed, missing, or mismatched provider references on records that imply a remote post produce a reconciliation-required conflict and preserve the record.

## API and frontend contract

Successful deletion returns `{ ok: true }` only after MongoDB confirms one record was removed. Publishing conflicts return 409. Provider and reconciliation failures return stable error codes and meaningful messages suitable for the client notification.

The client tracks deletion by post id, disables only that row while its request is active, disables deletion for `publishing`, calls `msgError` with the backend message on failure, and refreshes the listing after success. It adds no confirmation UI.

## Testing and verification

Tests will cover exact Google DELETE URL/method/token handling, empty success and 404 behavior, provider/integration validation, status-specific deletion, authorization/scope preservation, remote and local partial failures, duplicate/resumed requests, and stale worker attempts. Frontend tests will cover success/error notification behavior and per-row action state where practical with the existing test setup.

Verification will run focused new tests, the full API suite, client tests, client lint, and client production build. Live deletion from an actual Google Business Profile remains a separately reported manual verification gap unless credentials and an approved disposable post are available.

## Rollback

Revert the scoped Google integration helper, post deletion lifecycle/service, worker conditional transitions, route wiring, frontend row-state changes, and their tests. No migration or dependency rollback is required because the lifecycle fields are additive and stored only on posts involved in deletion/publishing attempts.
