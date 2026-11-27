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

## Verification evidence

- `npm test -w @parametrics/api`: 383 passed, 0 failed
- `npm test -w @parametrics/web -- --run`: 128 passed, 0 failed across 12 files
- `npm run lint -w @parametrics/web`: passed
- `npm run build -w @parametrics/web`: passed, 293 modules transformed
- `npm test -w client`: 38 passed, 0 failed across 7 files (read-only verification)
- `npm run lint -w client`: passed with one pre-existing React Hook Form warning and no errors
- `npm run build -w client`: passed, 4204 modules transformed (read-only verification)
- `node --check` on the review route, reconciliation service, and BullMQ worker: passed
- Focused backend Reviews, Google client, and reconciliation tests: 43 passed
- Focused legacy Reviews tests: 11 passed

No authenticated browser automation was performed. No production deployment was performed.

## Rollback

Restore the prior Reviews GET implementation, review index definition, review sync document construction, and legacy Reviews page together, then rebuild the backend and legacy frontend artifacts. No data rollback is required.

The canonical ParaMetrics Google Drive PRD was updated and read back at `https://docs.google.com/document/d/1lupXsJRs96TBHCbjPoaw0EPDAul-ih8ocAr_gXvXWmQ`.
