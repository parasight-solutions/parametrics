# Phase 2 Manual Google Business Profile Post Synchronization Design

## Intent

Add a user-triggered **Sync Posts** flow for the active ParaMetrics location. A successful sync fetches the complete Google Local Posts listing, imports remote-only posts, narrowly refreshes provider-owned fields on eligible published records, records non-destructive provider absence, persists the last successful result, and refreshes the existing MongoDB-backed Posts list.

Phase 2 also adds persistent deletion tombstones so a stale Google listing cannot resurrect a post intentionally deleted through ParaMetrics.

## Goals

- Reuse the Phase 1 fetch, provider-name validation, deterministic identity, and import mapping code.
- Add an authenticated, authorized, rate-limited `POST /api/v1/posts/sync` endpoint.
- Keep Phase 1 recovery insert-only while making it tombstone-aware.
- Update only a strict allowlist of Google-owned fields on eligible published posts.
- Preserve every ParaMetrics lifecycle, tenancy, publishing, scheduling, and deletion field.
- Mark confirmed provider absence without deleting or republishing local records.
- Prevent duplicate imports, concurrent sync corruption, and sync/deletion resurrection races.
- Expose last successful sync metadata and wire the existing new-frontend Sync Post button.

## Non-goals and anti-goals

- No background or scheduled synchronization; that is Phase 3.
- No direct Google fetch on normal Posts page load.
- No post CRUD rewrite, new frontend page, modal, or deletion confirmation dialog.
- No editing of imported published posts.
- No automatic republishing or deletion of provider-missing posts.
- No outbox, event system, Redis lock, sync-history collection, or tombstone expiry.
- No OAuth credentials, post content, or raw provider bodies in tombstones, logs, or API responses.

## Existing state and constraints

The starting branch is `fix/google-post-deletion` at `2c65f4ced0765ab4c55f1ef01848af9e055736bf`. `apps/client/src/pages/private/Posts.jsx` has an uncommitted user change containing the existing unconnected Sync Post button; implementation must preserve and wire that work.

Phase 1 already supplies complete bounded pagination, provider resource validation, deterministic recovery `_id` and application `id`, conservative import mapping, access validation, exact-name conflict detection, and `$setOnInsert` imports. The Phase 1 CLI must retain dry-run-first, insert-only semantics.

The existing deletion lifecycle atomically claims a post as `deleting`, records `provider_deleted_at` after Google success or verified 404, and retries local cleanup without repeating Google deletion. Publishing updates are already conditional on attempt identity and lifecycle status.

## Approaches considered

### Selected: persistent tombstones with two-sided recheck and cleanup

Use a small `post_deletion_tombstones` collection plus deterministic provider-resource identity. Sync checks tombstones before and after a deterministic import. Deletion writes the tombstone before local cleanup and also removes any matching deterministic recovery import. This converges safely whichever operation wins the race and works without transaction support.

### Rejected: cross-collection MongoDB transaction

A transaction could atomically combine tombstone and post changes but would impose replica-set transaction requirements and broaden operational assumptions beyond the current architecture.

### Rejected: provider-resource lock or outbox

A dedicated lock/lease or outbox would work but adds state transitions, expiry, crash recovery, and infrastructure disproportionate to Phase 2.

Accepting the stale-listing resurrection risk was rejected because it would undermine synchronization correctness.

## Tombstone model and indexes

Collection: `post_deletion_tombstones`.

Each document contains only:

- deterministic `_id` and `provider_resource_key` derived from a versioned hash of provider plus exact `provider_post_name`;
- `provider: "google"`;
- exact `provider_post_name`;
- `provider_account_name` and `provider_location_name`;
- `organization_id`, `client_id`, `location_id`, and `integration_id` for conflict-safe scope checks;
- `deleted_at`, provider outcome (`deleted` or `absent`), and minimal deletion audit identifiers such as the application post id and deleting user id;
- `created_at` and `updated_at`.

It stores no post summary, media, CTA, scheduling data, tokens, integration secrets, or raw provider response.

Startup index creation follows `ensureIndexes.js` conventions:

- unique `{ provider_resource_key: 1 }`, named `uniq_post_deletion_tombstones_provider_resource_key`;
- scoped lookup `{ provider: 1, provider_account_name: 1, provider_location_name: 1, provider_post_name: 1 }`, named `idx_post_deletion_tombstones_provider_resource`.

There is no TTL index and normal sync never updates or deletes tombstones.

## Google-first deletion integration

The existing claim, Google-first ordering, retry lease, and provider progress recording remain intact.

For a published/provider-backed post:

1. Atomically claim `deleting` as today.
2. Cancel pending publish work as today.
3. If `provider_deleted_at` is absent, validate scope, call Google DELETE, accept success or verified 404, and conditionally persist `provider_deleted_at` and outcome on the claimed post.
4. Idempotently upsert the tombstone using `$setOnInsert` plus narrowly allowed audit timestamp refresh where appropriate.
5. If the tombstone write fails, release the operation lease but retain `status: deleting`, `provider_deleted_at`, and the provider outcome. Return a safe retryable error. A retry skips Google, retries the tombstone, and continues cleanup.
6. After tombstone persistence, delete the claimed post conditionally by its deletion operation id.
7. Also remove only a deterministic `google_imported` recovery document with the same exact provider resource and full scope. This is race cleanup, not a broad provider-name deletion.

Google failure before confirmed deletion creates no tombstone. Local-only scheduled/queued/retrying deletions create no provider tombstone because no remote provider resource was intentionally removed.

## Sync/deletion race protocol

For a missing remote post eligible for deterministic import:

1. Read the exact scoped tombstone before import. If present, return `tombstone_skipped`.
2. Perform the existing deterministic `$setOnInsert` upsert.
3. Read the tombstone again before treating the import as successful.
4. If a matching tombstone appeared, conditionally delete only the deterministic imported document where `_id`, exact provider name, scope, `origin: google_imported`, and `status: published` still match. Report `tombstone_skipped`, not inserted.

The deletion side writes the tombstone before cleanup and removes any matching deterministic import. Therefore:

- if deletion wins before import, the precheck blocks it;
- if deletion wins during import, the sync postcheck removes it;
- if sync finalizes immediately before deletion, deletion cleanup removes it.

No normal sync path can remove or overwrite a tombstone.

## Location-scoped sync lease

Only one manual post sync may operate per location. The endpoint atomically claims a bounded lease inside the existing location document using fields under `post_sync.operation_id` and `post_sync.operation_expires_at`. A live lease returns `409 post_sync_in_progress`; an expired lease is recoverable.

The lease prevents two syncs from racing provider updates and metadata. It does not replace deterministic import identity or tombstones. The operation releases its lease on success or failure using the matching operation id. Lease fields cannot overwrite canonical location binding fields.

## Complete fetch and planning

The service validates integration/account/location access and fetches every bounded Google page before any post or tombstone mutation. Repeated tokens, page/post limits, OAuth failures, or provider failures abort with zero reconciliation writes and do not mark posts missing.

After complete validation, the service loads:

- all local provider-backed posts for the selected full scope;
- all exact provider-name matches and deterministic identities needed for conflict detection;
- all relevant tombstones.

Duplicate Google names, malformed names, duplicate legacy local references, cross-scope matches, and deterministic identity collisions are reported and skipped.

## Reconciliation rules

### Missing locally

If no exact/conflicting local record exists and no tombstone exists, import using the existing Phase 1 document mapping and deterministic identity. Do not enqueue publishing work.

### Existing eligible published record

Update only when values actually differ, with a conditional filter requiring:

- exact `_id` or application id and full user/organization/client/location/integration/provider scope;
- exact `provider_post_name`;
- `status: published`;
- no active deletion state.

The update allowlist is:

- `summary` when Google supplies it;
- `image_url` when media is explicitly present, including explicit empty media removal;
- `call_to_action_type` and `call_to_action_url` when CTA is explicitly present, including explicit removal;
- sanitized `provider_post_url` when supplied;
- `topic_type` and `language_code` when supplied;
- `provider_created_at` and `provider_updated_at` when supplied;
- `synced_at` and `provider_sync_status: present`.

Missing optional properties do not erase valid local values. The service never replaces a full document and never updates ownership, integration, lifecycle status, scheduling, job, deletion, recurrence, AI, creation, or publish-attempt fields.

If the conditional update no longer matches because the post became `publishing`, `deleting`, or changed scope, report a conflict rather than retrying a broader update.

### Local non-published lifecycle

`scheduled`, `queued`, `retrying`, `publishing`, `failed`, and `deleting` records are never updated by sync. If one has an exact provider reference returned by Google, report a lifecycle conflict.

### Missing on Google

Only after a complete successful listing, local scoped published/provider-backed records absent from the returned canonical names are candidates for absence marking. Synchronization conditionally sets:

- `provider_sync_status: missing`;
- `provider_missing_since` only if not already set;
- `synced_at` and `updated_at`.

The post remains `status: published`; it is not deleted or republished. Tombstoned resources are not imported. Ambiguous duplicate/conflict records are reported as unverified/conflicts rather than marked missing.

When a later complete sync sees the provider post again, eligible published records return to `provider_sync_status: present` and clear `provider_missing_since`.

## Partial database failures

The provider fetch and reconciliation plan are complete before writes, but MongoDB reconciliation spans multiple documents and is not globally transactional. Every write is narrow, conditional, and idempotent. If any insert/update/missing/tombstone-race cleanup fails:

- the operation returns a non-success response with safe failure metadata;
- the location's last-success metadata is not advanced;
- the sync lease is released safely;
- already completed idempotent writes remain valid and the next manual sync converges them.

The API must never claim a complete successful sync after partial application.

## Sync metadata

On full success only, update the selected location document conditionally on the sync operation id:

```js
post_sync: {
  last_success_at,
  last_fetched_count,
  last_inserted_count,
  last_updated_count,
  last_unchanged_count,
  last_missing_count,
  last_tombstone_skipped_count,
  last_conflict_count
}
```

Lease fields are removed in the same successful update. Failure removes only the matching lease fields and preserves prior successful metadata.

The sync endpoint response returns current successful metadata. Normal location/list APIs may expose this safe `post_sync` summary so the frontend can display the last sync without calling Google.

## API contract

Endpoint, registered before `/:id`:

```http
POST /api/v1/posts/sync
Content-Type: application/json

{ "locationId": "parametrics-location-id" }
```

Middleware: authenticated cookie session plus existing `syncRateLimit`.

Authorization uses `requireOwnedOrganizationLocationAccess` with operation roles (`owner`, `admin`, `manager`) and the selected location's stored organization/client/location assignment. The backend loads the bound Google integration; frontend-supplied provider or tenancy identifiers are ignored/rejected.

Success (`200`):

```json
{
  "success": true,
  "locationId": "parametrics-location-id",
  "summary": {
    "fetched": 15,
    "inserted": 3,
    "updated": 4,
    "unchanged": 6,
    "missingOnGoogle": 1,
    "tombstoneSkipped": 1,
    "skipped": 0,
    "conflicts": 0
  },
  "lastSyncedAt": "2026-11-19T12:00:00.000Z"
}
```

Errors use existing API error conventions with compact codes for bad input, unauthorized scope, integration/reauth failure, inaccessible provider account/location, rate limit, `post_sync_in_progress`, provider failure, conflict, and partial apply failure. No tokens or raw provider bodies are returned.

## Frontend behavior

Wire the existing Sync Post button in `apps/client/src/pages/private/Posts.jsx`; preserve its current placement and surrounding uncommitted work.

- Add `postsEndpoints.syncPosts({ locationId })` in `posts.service.js` using existing Axios/cookie conventions.
- Disable the button with no active location or while syncing; show its existing icon in a loading/spinning state and prevent repeat submission with state/ref protection.
- Capture the location id at request start. If active location changes before completion, ignore that request's notification, metadata, and list refresh for the newly selected location.
- On success for the same location, show concise inserted/updated/missing counts and refresh the current MongoDB list without resetting filters.
- On failure for the same location, show a meaningful backend-derived error.
- Display the last successful sync timestamp for the active location using safe backend metadata. Do not render raw Google objects.
- Preserve existing published edit restrictions and deletion UI. Add no confirmation dialog.

## Phase 1 compatibility

The recovery CLI remains dry-run-first and insert-only. Its planning receives the tombstone collection and classifies a tombstoned provider resource as skipped. It never updates existing posts, missing states, location sync metadata, or tombstones.

## Testing

Backend tests cover authorization, invalid scope/integration/access, complete pagination, zero writes after provider failure, imports, narrow updates, unchanged records, repeated/concurrent sync, lease conflicts, legacy duplicates, lifecycle exclusions, missing-provider handling, provider error mapping, success metadata timing, partial writes, tombstone indexes, deletion success/404, tombstone failure/retry, stale listing, concurrent deletion/sync in all orderings, Phase 1 insert-only/tombstone behavior, and existing Google-first deletion.

Frontend tests cover endpoint payload, disabled/loading behavior, repeat prevention, success/error notification, list refresh without filter reset, last-sync display, and ignoring stale completion after active-location switching.

Verification includes focused backend and frontend tests, full API suite, client suite, client lint, client production build, Node syntax checks, and `git diff --check`. Provider calls remain mocked; no live synchronization is claimed or run without explicit approval.

## Documentation and delivery

Update the canonical ParaMetrics Google Drive PRD after implementation with the Phase 2 behavior, tombstone decision, evidence, limitations, and Phase 3 dependencies. Do not create Notion documentation.

Work occurs on a dedicated Phase 2 feature branch from the verified HEAD while preserving the uncommitted Posts page. Leave all work uncommitted and unpushed unless separately requested.

## Known limitations

- Deterministic import identity and tombstone uniqueness protect these managed paths but do not universally enforce provider-name uniqueness across arbitrary legacy/manual insertion paths.
- Reconciliation is idempotent but not globally transactional; partial MongoDB failure returns failure and relies on a subsequent sync to converge completed writes.
- Provider absence is based on a complete successful Google listing and remains a non-destructive reconciliation state, not proof of who deleted the remote post.
- Tombstones do not expire automatically; any future restoration workflow requires an explicit authenticated design.

## Rollback

Remove the sync route/service extensions, frontend wiring/tests, location sync metadata handling, tombstone service/index, and documentation. Revert deletion integration only after ensuring existing tombstones remain harmless. Do not automatically delete tombstones or imported posts during code rollback; data rollback requires a separately reviewed provider-aware procedure.
