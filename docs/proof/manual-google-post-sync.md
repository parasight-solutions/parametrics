# Manual Google Post Synchronization — Phase 2 Proof Pack

## Scope

- Starting and ending Git SHA: `2c65f4ced0765ab4c55f1ef01848af9e055736bf` (changes intentionally uncommitted)
- Branch: `feat/manual-google-post-sync`
- Provider calls in automated tests: mocked
- Live Google sync: not executed

## API contract

```http
POST /api/v1/posts/sync
Content-Type: application/json

{ "locationId": "<PARAMETRICS_LOCATION_ID>" }
```

The authenticated backend derives user, organization, client, integration, provider account, and provider location scope from stored records. A successful response contains `success`, `locationId`, summary counts (`fetched`, `inserted`, `updated`, `unchanged`, `missingOnGoogle`, `tombstoneSkipped`, `skipped`, `conflicts`), and `lastSyncedAt`.

## Reconciliation rules

- Complete Google pagination and access validation occur before post reconciliation writes.
- Remote-only posts use deterministic recovery `_id` and application id with `$setOnInsert`; no publish job is created.
- Existing published posts receive only meaningful Google-owned summary, media, CTA, provider URL, topic/language, provider timestamps, and sync reconciliation fields.
- Ownership, integration, lifecycle, scheduling, publishing attempts, recurrence, AI, and deletion state are never overwritten.
- Protected lifecycle matches are conflicts.
- A complete listing may mark an absent published provider post `provider_sync_status: missing`; the local record remains published and is never automatically deleted or republished.
- Location last-success metadata advances only after complete reconciliation. A bounded operation-id lease rejects concurrent syncs and prevents stale completion.

## Deletion tombstones and races

`post_deletion_tombstones` stores a minimal exact Google resource/scope/audit record with a unique provider-resource key and no TTL. Google-first deletion records provider progress, persists the tombstone, then removes the post. Tombstone failure leaves the post recoverable in `deleting`; retry does not repeat Google deletion.

Both Phase 1 recovery and Phase 2 sync check tombstones before and after deterministic import. Deletion also removes only an exact deterministic `google_imported` match. These orderings converge without cross-collection transactions and prevent stale-listing resurrection.

## Frontend

The existing Sync Post button was retained and wired as Sync Posts. It is disabled without an active location, displays loading, blocks repeats, reports safe success/error messages, refreshes the existing filtered MongoDB list, displays last successful time, and ignores a stale response after active-location switching. No confirmation dialog was added.

## Verification evidence

- API: `323` tests passed, `0` failed.
- Client: `24` tests passed across `7` files, `0` failed.
- Client lint: exit `0`, zero errors; one pre-existing React Hook Form compiler warning in `PostFormPage.jsx`.
- Client production build: exit `0`; Vite transformed `4202` modules. Existing large-chunk warning remains.
- Node syntax checks and `git diff --check`: recorded in final handoff.

## Live test procedure

1. Start API, worker, and scheduler using the repository root commands.
2. Sign in and select one Google-bound location.
3. Create or edit a post directly in Google Business Profile.
4. Click Sync Posts once and confirm the summary notification and refreshed MongoDB listing.
5. Verify last-sync time appears for the selected location.
6. Delete a published post through ParaMetrics, confirm Google absence, then run Sync Posts and verify it is counted as tombstone-skipped and not resurrected.
7. Do not perform destructive tests against production data without separate approval.

## Known limitations

- Deterministic identity and tombstones protect managed recovery/sync/deletion paths but do not universally enforce provider-name uniqueness for arbitrary legacy insertion paths.
- Reconciliation writes are individually atomic and idempotent, not one global MongoDB transaction. A partial database failure returns failure, preserves prior last-success metadata, and converges on retry.
- Provider missing means absent from one complete successful listing; it does not prove who deleted the post.
- Phase 3 automatic synchronization remains deferred.

## Rollback

Remove the manual sync endpoint/service/UI wiring, tombstone service/index integration, and new tests/docs. Do not automatically delete tombstones or imported posts; data rollback needs a separately reviewed provider-aware procedure.
