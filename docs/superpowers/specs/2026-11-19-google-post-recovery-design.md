# Phase 1 Google Business Profile Post Recovery Design

## Intent

Recover historical Google Business Profile Local Posts whose ParaMetrics MongoDB records were deleted before Google-first deletion existed. The one-time command imports missing provider posts for one explicitly selected location so they appear in the existing Posts listing and can be manually retained or deleted through the normal Google-first deletion endpoint.

## Goals

- Fetch every available Google Local Post page for one selected MongoDB location.
- Validate the complete provider dataset before any write.
- Match existing records by exact `provider_post_name` within the selected user/location/provider scope.
- Import only genuinely missing posts as published, correctly scoped MongoDB records.
- Make dry-run the default and require explicit `--apply` for inserts.
- Make repeated and concurrent recovery runs idempotent without adding an index or migration.
- Preserve compatibility with listing, detail, ownership, and Google-first deletion behavior.
- Keep the core service reusable for a later authenticated API or worker without implementing either now.

## Non-goals and anti-goals

- No automatic or manual Google deletion inside recovery.
- No modification or deletion of existing MongoDB posts.
- No Google publishing, retry queueing, scheduling, or AI history.
- No frontend changes, recovery screen, Sync button, confirmation dialog, or new API.
- No Phase 2 API and no Phase 3 scheduled worker.
- No new unique index, migration, or claim of universal provider-reference uniqueness.
- No import when ownership, organization, client, location, integration, or Google access is ambiguous.

## Selected approach

Use exact provider-name discovery for existing records and deterministic MongoDB `_id` values for missing recovery imports.

The service first queries existing posts by exact `provider_post_name` plus selected `user_id` and `location_id`. It also detects provider-name matches outside the expected scope and multiple matching local records. Such conflicts are reported and skipped rather than modified or guessed.

For a missing provider post, the service derives a stable `_id` from a versioned hash of the selected location identity and canonical Google resource name. Apply mode uses `updateOne({ _id }, { $setOnInsert: document }, { upsert: true })`. MongoDB’s built-in `_id` uniqueness makes concurrent recovery attempts converge on one imported document without adding an index. The application-level `id` is derived deterministically from the same recovery identity in valid UUID form, so concurrent callers also produce the same route-facing identifier.

This guarantee applies to Phase 1 recovery imports only. It does not prevent legacy records or unrelated insertion paths from creating duplicate `provider_post_name` values; exact-name conflict discovery remains required on every run.

Alternatives rejected:

- A partial unique provider-reference index would give a wider guarantee but could fail against unknown legacy duplicates and requires a separate audit/migration.
- A process lock plus read/insert is not safe across concurrent processes or crashes.

## Selected location and authorization scope

The CLI accepts only `--location-id`. It loads that exact Google location from MongoDB and derives all provider and tenancy values from the stored document; it never accepts raw account names, location names, user ids, integration ids, or OAuth tokens as scope overrides.

Before contacting Google or planning imports, validation requires:

- `location.id`, `location.user_id`, `organization_id`, `client_id`, and `integration_id`;
- canonical `provider_account_name` (`accounts/*`) and `provider_location_name` (`locations/*`);
- a usable Google integration loaded by `location.user_id` plus `location.integration_id`;
- an active organization membership for the owning user with a role allowed to operate on that location;
- refreshed OAuth access through `ensureAccessToken`;
- confirmation through existing Google account/location helpers that the bound integration can access the selected provider account and location.

If shared-organization ownership cannot satisfy the existing post route’s `user_id` ownership model, recovery stops with a diagnostic instead of assigning a different user or bypassing access checks.

## Complete provider fetch

The reusable service calls `listLocalPosts(access, accountName, locationName, { pageSize, pageToken })` until `nextPageToken` is absent. It keeps a set of tokens and aborts on repetition. It enforces a high explicit page/post bound and reports an unusually large result rather than looping indefinitely.

All pages are accumulated before MongoDB matching or mutation. A failure on any page aborts the operation with zero imports. Each provider record is then validated against the exact expected prefix:

`accounts/{accountId}/locations/{locationId}/localPosts/{postId}`

Records with missing, malformed, duplicate-within-provider-results, or mismatched names are reported as invalid/skipped. Valid records proceed to local reconciliation.

## Reconciliation and conflict rules

For the complete set of valid provider names, the service reads relevant MongoDB posts before applying any insert.

- One exact match in expected user/location scope: already tracked; skip.
- No exact match anywhere relevant: eligible for import.
- Multiple exact matches: conflict; skip.
- A match exists but its user, organization, client, location, account, location name, or integration conflicts with the selected location: conflict; skip.
- A deterministic recovery `_id` already exists with the same provider identity: already imported; skip.
- A deterministic `_id` exists with different identity/scope: conflict; skip.

Dry-run returns the complete plan and performs no write. Apply mode performs only `$setOnInsert` upserts for eligible records. It never updates an existing document, even if provider metadata has changed.

## Imported document contract

Imported documents contain the existing listing/deletion fields:

- deterministic MongoDB `_id` and deterministic UUID-compatible application `id`;
- `user_id`, `organization_id`, `client_id`, `location_id`, and `integration_id` copied from the validated selected location;
- exact `provider_account_name`, `provider_location_name`, and `provider_post_name`;
- sanitized HTTPS `provider_post_url` from `searchUrl` when available;
- provider `summary`, supported first media source URL, `topic_type`, `language_code`, and supported CTA fields when present;
- `status: "published"`, `origin: "google_imported"`, `provider_error: null`, and `scheduled_at: null`;
- provider timestamps in distinct provider-specific fields when supplied;
- `synced_at`, `imported_at`, `created_at`, and `updated_at` set to the local import time.

The importer does not fabricate original local creation time, AI status/history, queue metadata, recurrence data, or publish-attempt state. It does not enqueue any job.

The resulting record satisfies the existing Posts list projection and exact tenancy checks. Its published status and exact provider/integration references satisfy the Google-first deletion validator.

## CLI contract

The package command is:

```bash
npm run posts:recover --workspace @parametrics/api -- --location-id=<LOCATION_ID>
```

This is dry-run mode. `--dry-run` is accepted explicitly but is not required.

Apply requires:

```bash
npm run posts:recover --workspace @parametrics/api -- --location-id=<LOCATION_ID> --apply
```

The parser rejects missing/duplicate location arguments, unknown flags, and simultaneous `--apply`/`--dry-run`. Output contains only safe location/provider identifiers, counts, imported application ids/provider references, conflicts, and compact failure codes. It never prints tokens, integration secrets, raw user documents, or request bodies.

The script closes MongoDB on success or failure and exits nonzero for validation, listing, or apply failures. It is never run in apply mode automatically.

## Result shape

The service returns a structured result with mode, selected location summary, pagination counts, provider totals, already-existing count, eligible count, inserted count, skipped-invalid count, conflict count, failed count, unusually-large indicator, and safe per-record outcomes. Dry-run reports planned application ids and provider references with `inserted: 0`.

## Testing and verification

Focused tests use mocked Google pages and Mongo-like collection doubles to prove:

- complete pagination, empty results, repeated-token abort, bounds, and no writes after partial fetch failure;
- exact-name/scoped matching, invalid references, local duplicates/conflicts, and no existing-document changes;
- deterministic `_id` and application `id`, dry-run safety, apply imports, idempotent reruns, and concurrent upsert convergence;
- correct user/organization/client/location/integration mapping and published status;
- no queue, publish, remote delete, or local delete calls;
- missing/unusable integration and inaccessible locations stop before import;
- imported document compatibility with the deletion service’s required scope and provider reference.

Verification runs the focused service/CLI tests, full API suite, Node syntax checks, and diff hygiene. A dry-run against the real selected location is not executed automatically; the human runs it after reviewing the command and code. Live recovery is not claimed until that command succeeds against the intended location.

## Documentation

After implementation and automated verification, update the existing canonical Google Drive PRD with the approved recovery design, actual implementation status, commands, evidence, and deferred Phase 2/3 work. Local repository documentation remains implementation/proof material, not a competing project source of truth.

## Rollback

Remove the recovery service, CLI script, test registration, package command, and scoped documentation. Imported records created by a human-run apply are intentionally not removed automatically; rollback of data requires a separately reviewed, provider-aware plan because those records may represent genuine Google posts.
