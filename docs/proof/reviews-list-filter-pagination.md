# Reviews List Filtering and Pagination Proof

Date: 27 November 2026

## Scope

- Backend: `apps/api`
- Legacy frontend: `apps/web`
- Excluded and unchanged: `apps/client` and `feat/automatic-google-post-sync`
- No schema migration, persisted reply-status field, or database backfill

## API behavior

`GET /api/v1/reviews` authorizes the requested Google location before accessing the reviews collection. Its first aggregation stage is the canonical user, organization, client, location, and provider scope. It accepts:

- `status`: `all` (default), `replied`, or `unreplied`
- `keyword`: trimmed literal text, maximum 200 characters
- `page`: positive integer, default 1
- `perPage` or `per_page`: positive integer, default 10, capped at 100

The standardized success data contains `reviews`, `pagination`, location-wide `counts`, `lastSyncedAt`, and `sync`. `lastSyncedAt` is the location's last successful review synchronization timestamp as an ISO string, or `null`. Requested pages beyond the matching result remain requested and return an empty row array.

## Classification and aggregation

Reply status is computed inside MongoDB. The expression checks `$type` before `$trim`, converts non-string values to an empty string, supplies the ECMAScript whitespace character set (including ideographic space), and uses `$strLenCP` to classify only non-blank string comments as replied. Missing, null, non-string, empty, and whitespace-only comments are unreplied.

The pipeline applies keyword and status matching in MongoDB and uses one `$facet` to produce:

- deterministically sorted and paginated rows;
- the matching total;
- location-wide total, replied, and unreplied counts.

Keyword input is escaped before constructing case-insensitive regular expressions across reviewer display name/name, review comment, and reply comment.

## Performance and index considerations

Rows sort by `updateTime`, `createTime`, and `_id`, all descending. The existing `{ user_id, location_id, provider, updateTime, createTime }` listing index is extended with `_id: -1` to match the deterministic order without adding speculative indexes. The leading tenant/location match is index-supported; because the sort runs inside a `$facet` branch, production `explain()` evidence is required before claiming MongoDB avoids a blocking branch sort.

The migration-free design deliberately computes reply classification and four-field regex matching after the tenant/location `$match`. These stages cannot generally be satisfied by the compound sort index, so their cost grows with reviews in one authorized location, not with the full collection. Before adding a materialized status, text index, or search service, evaluate production `explain("executionStats")`, per-location cardinality, and p95 latency. Anchored search is not assumed because the product requires substring matching.

The sync worker now stores `organization_id` and `client_id` on future review upserts so newly synchronized rows remain visible to the canonical scoped query. Existing reply and manual synchronization endpoints retain their provider behavior.

## Manual synchronization correction

Every manual sync job now carries `mode: "full"` and `since: null`, irrespective of `force`. The extracted reconciliation service deliberately ignores legacy queued-job cursors, follows every Google result page, and never uses a timestamp early stop. An unsupported Google `orderBy` is retried without ordering while still traversing the complete listing.

MongoDB `bulkWrite` results now populate fetched, processed, inserted, matched, modified, unchanged, and pages-fetched counters. Queued, running, and failed transitions do not set or unset `last_synced_at`; only complete successful reconciliation advances it. Active BullMQ jobs deterministically suppress duplicate manual requests, while retained completed/failed jobs are removed before a subsequent manual sync is enqueued.

Review ratings are normalized only at the response boundary: Google enums and valid numeric values become integers 1–5, invalid values become `null`, and persisted values are unchanged. The legacy frontend now consumes the numeric contract. The excluded new client remains unchanged; its current enum-only `ReviewCard` mapping does not render numeric values and requires a separately authorized compatibility update.

## Provider errors and availability reconciliation

Google review-reply failures are classified at the Reviews route boundary without weakening the centralized sanitizer. Review-specific Google `404 NOT_FOUND`, rate limiting, permission denial, provider 5xx, and network timeouts return safe application errors. Failed provider calls do not update the stored reply. Logs contain only review/location identifiers, provider status/code/reason, and an available correlation ID.

Each complete manual snapshot now records active review observations, initializes first-seen metadata lazily, reconciles provider-owned comments, ratings, reviewer fields, and replies, and clears a reply when Google omits it. A local reply timestamp prevents a snapshot that started earlier from overwriting a newer successful local reply.

Only a complete snapshot may mark absent reviews `missing`. Duplicate provider IDs, missing provider IDs, invalid or inconsistent `totalReviewCount`, repeated page tokens, page failures, and MongoDB failures cannot apply absence reconciliation. Missing records retain their content, reply history, rating, and local ID. The per-review run marker prevents a retried run from incrementing misses twice; a review can become operationally `unavailable` only after another successful miss at least 30 minutes after the first. Reappearing reviews return to `active`. No record is classified as definitively deleted.

## Legacy UI behavior

The legacy page consumes server rows, counts, pagination, and sync metadata. `status`, `keyword`, `page`, and `perPage` are URL state. Search is debounced by 350 ms. In-flight reads use both `AbortController` and a request generation check so stale location or filter results cannot replace newer state. Reply success refreshes the active query and returns to the last valid page when reclassification empties the current page. Manual sync remains queued and refreshes metadata once without polling.

## Canonical Google review identity and duplicate cleanup

Root cause: `provider_review_name` contains the connected Google account ID (`accounts/{accountId}/locations/{locationId}/reviews/{reviewId}`). The same Google Business Profile location can be authorized through another account, so the full resource name is mutable and previously produced a second MongoDB review.

Synchronization now validates the complete Google resource name against the authorized location and keys writes and absence reconciliation by `{ user_id, location_id, provider: "google", provider_review_id }`. Account-path changes update the existing document, retain its application `id`, refresh provider and integration metadata, and return the record to `active`. Malformed or mismatched provider names make the snapshot incomplete and cannot trigger absence reconciliation. A partial unique index protects canonical records while remaining compatible with untouched legacy rows that do not yet have `provider_review_id`.

The cleanup CLI is dry-run by default. It groups only within the same ParaMetrics user and location, chooses a keeper using authorized location validity, the current account/integration, active observation, and reliable provider recency, and skips ties or conflicting scope. Apply mode requires `--backup-confirmed`, idempotently archives each duplicate in `review_duplicate_archive`, verifies the archive, remaps known review audit references, and only then removes the duplicate. The archive has no TTL.

### Rollout sequence

1. Deploy compatible code and the partial canonical unique index while review-sync workers are paused.
2. Back up the scoped `reviews`, `review_duplicate_archive`, and review-targeted `audit_logs` records.
3. Run the scoped dry-run and review every keeper, duplicate, invalid, conflicting, and ambiguous result.
4. Run apply with the backup acknowledgement. The script canonicalizes valid singleton and keeper records only after duplicate archival/removal.
5. Verify canonical identity counts and the `uniq_reviews_canonical_provider_identity` index.
6. Resume workers and run two full manual synchronizations, including one after switching the authorized Google account when available.

Dry-run example:

```bash
npm run reviews:dedupe -w @parametrics/api -- --user-id=<USER_ID> --location-id=<LOCATION_ID>
```

Apply only after pausing review sync and taking a backup:

```bash
npm run reviews:dedupe -w @parametrics/api -- --user-id=<USER_ID> --location-id=<LOCATION_ID> --apply --backup-confirmed
```

The supplied confirmed example is detected by canonical review ID `AbFvOqlTugMgtzqCb68ltu0I2iwVu3Sr4Hbpfact-viSj5vyqfo4LMYrm3Zmv-VqYMJPEB3j9Xz5Og`, even though its two resource names use Google account IDs `105611384841512279530` and `103094208499803762981`. No live/shared database inventory or cleanup was executed during implementation.

### Archive rollback

Keep workers paused. Restore an archived document from `review_duplicate_archive.document` only after removing or correcting the keeper's canonical field so the unique index is not violated. Restore any remapped `audit_logs.target_id` values from the archive metadata, verify counts, and resume workers only after a dry-run reports no unintended conflict. Application rollback must restore the sync code and index definitions together; retain the archive until rollback verification is complete.

Remaining risk: the partial unique index protects records that carry a valid canonical ID, but legacy rows remain outside it until cleanup. Malformed provider names and ambiguous keeper groups intentionally require manual resolution. The CLI checks the only known durable local review-ID reference (`audit_logs.target_id`); any new referencing collection added later must be registered before cleanup.

## Verification evidence

- `npm test -w @parametrics/api`: 397 passed, 0 failed
- `npm test -w @parametrics/web -- --run`: 128 passed, 0 failed across 12 files
- `npm run lint -w @parametrics/web`: passed
- `npm run build -w @parametrics/web`: passed, 293 modules transformed
- `npm test -w client`: 38 passed, 0 failed across 7 files (read-only verification)
- `npm run lint -w client`: passed with one pre-existing React Hook Form warning and no errors
- `npm run build -w client`: passed, 4204 modules transformed (read-only verification)
- `node --check` on the review route, reconciliation service, and BullMQ worker: passed
- Focused canonical identity, cleanup, reconciliation, index, and reply tests: 46 passed
- Focused legacy Reviews tests: 11 passed

No authenticated browser automation was performed. No production deployment was performed.

## Rollback

Restore the prior Reviews GET implementation, review index definition, review sync document construction, and legacy Reviews page together, then rebuild the backend and legacy frontend artifacts. No data rollback is required.

The canonical ParaMetrics Google Drive PRD was updated and read back at `https://docs.google.com/document/d/1lupXsJRs96TBHCbjPoaw0EPDAul-ih8ocAr_gXvXWmQ`.
