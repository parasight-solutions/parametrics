# Manual Review Synchronization and Review Response Design

## Intent

Manual review synchronization must be a complete reconciliation for one authorized Google Business Profile location. The Reviews listing must expose the last successful completion timestamp and numeric star ratings without migrating stored review documents.

## Approved approach

- Queue every manual request as `mode: "full"` with `since: null`; `force` remains accepted but does not alter completeness or duplicate protection.
- Treat legacy review-sync jobs as full reconciliation even when their payload contains `since`.
- Keep BullMQ and move the job processor into an injectable service so pagination, writes, counters, and state transitions have worker-level tests.
- Fetch every Google page. Reconcile with scoped upserts that preserve insert-only `id` and `created_at`.
- Aggregate real `bulkWrite` counters: fetched, processed, inserted, matched, modified, unchanged, and pages fetched.
- Use the stable per-user/location BullMQ job ID. Active jobs are duplicates; completed/failed retained jobs are removable and must not block a later manual sync.
- Never overwrite `last_synced_at` while queued, running, or failed. Set it only after all pages and writes succeed.
- Return `lastSyncedAt` from the authorized sync-state record, serialized as an ISO string or `null`.
- Normalize `starRating` only in Reviews API output: valid provider enums/numeric values become integers 1–5; invalid/missing values become `null`. Stored provider values remain unchanged.

## Scope and constraints

Modify `apps/api`, `apps/web`, proof documentation, and the canonical Google Drive PRD. Do not modify `apps/client`, implement automatic sync, introduce a scheduler/backfill/persisted reply status, or change unrelated APIs. Leave all changes uncommitted and unpushed.

## Verification

Worker/service tests cover complete pagination, legacy payloads, idempotent upserts, counters, errors, and timestamp preservation. Route tests cover full-mode queue payloads, duplicate lifecycle, `lastSyncedAt`, authorization, filters/pagination, and numeric ratings. Legacy UI tests cover numeric rating consumption. Full API/web tests, web lint/build, and `git diff --check` must pass.
