# Automatic Google Business Profile Post Synchronization Design

## Intent

Phase 3 adds durable, server-side Google Business Profile post synchronization that runs without a browser. It reuses the Phase 2 reconciliation engine, keeps manual synchronization available, and gives authorized users explicit per-location control through a focused client settings module.

Automatic synchronization is opt-in at two levels: the deployment-wide `POST_AUTO_SYNC_ENABLED` master switch and `locations.post_sync.auto_enabled` for each location. Missing location settings are treated as disabled. The normal interval is every 120 minutes and remains configurable by backend environment variables.

## Goals

- Periodically import and reconcile Google posts for enabled, eligible locations.
- Share one reconciliation implementation and one location-level coordination mechanism between manual and automatic runs.
- Prevent overlapping, stale, or incorrectly scoped synchronization writes.
- Preserve post publishing, deletion, tombstones, Phase 1 recovery, and Phase 2 manual synchronization.
- Provide an authenticated settings UI and APIs for individual and all-locations updates.
- Keep scheduling durable, bounded, observable, and disabled by default.

## Non-goals

- Automatic post publishing or Google post deletion.
- A second synchronization engine or synchronization history database.
- A browser timer, new frontend dashboard, or deletion confirmation dialog.
- Changing the global master switch through the application UI or API.
- Persisting an independent “all locations” preference.

## Selected approach

### Considered approaches

1. **Dedicated Post Auto-Sync settings module (selected).** Add `/settings/post-auto-sync` under a Settings sidebar group, backed by scoped settings APIs and per-location persistence. This keeps operational settings separate from connection management and post listing.
2. **Integrations-page controls.** This reduces navigation work but couples recurring synchronization policy to Google connection administration and makes the page harder to maintain.
3. **Posts-page controls.** This is close to manual synchronization but overloads a listing page and does not satisfy the requirement for a settings module.

The selected approach uses owner, admin, and appropriately assigned manager memberships as writable roles. Viewers with assigned access receive the same safe status data but read-only controls and an explicit permission message.

## Data model

The existing location document remains the durable source of scheduling and operational state. Updates use dotted fields and never replace the entire `post_sync` object.

```text
post_sync.auto_enabled
post_sync.operation_id
post_sync.operation_fence
post_sync.operation_expires_at
post_sync.operation_kind
post_sync.last_success_at
post_sync.last_*_count
post_sync.last_auto_attempt_at
post_sync.last_auto_success_at
post_sync.last_auto_failure_at
post_sync.last_auto_failure_code
post_sync.next_auto_sync_at
post_sync.auto_state
```

`auto_enabled` defaults to `false` when absent. Enabling a location schedules its first run promptly with deterministic location-based staggering over a short window (a few minutes, fixed during planning), rather than waiting 120 minutes. Subsequent successful runs are due 120 minutes after completion, plus small deterministic jitter. Disabling clears queued/running eligibility but preserves historical metadata. Old queued jobs are harmless because workers reload and revalidate the setting and global switch before any Google call.

No new data migration is required. A locations index supporting the scheduler scan will cover provider, status, `post_sync.auto_enabled`, and `post_sync.next_auto_sync_at` as appropriate to the final query.

## Configuration

```dotenv
POST_AUTO_SYNC_ENABLED=false
POST_AUTO_SYNC_INTERVAL_MINUTES=120
POST_AUTO_SYNC_CONCURRENCY=1
POST_AUTO_SYNC_MAX_ATTEMPTS=3
```

Configuration is parsed once through a focused module with an injectable environment for tests. The interval has documented safe minimum and maximum bounds. Invalid booleans or numbers fail startup clearly rather than silently enabling work. The global flag prevents both new enqueueing and queued jobs from calling Google.

## Shared synchronization runner and lease

`runManualPostSync()` becomes a thin adapter over a shared runner. The shared runner accepts the operation kind (`manual` or `automatic`), authenticated/scoped location resolution strategy, clock, operation ID, and reconciliation dependencies.

The location lease is acquired atomically with:

- a unique operation ID;
- a monotonically increasing fencing value;
- an expiry timestamp;
- the operation kind.

A heartbeat renews only the matching operation ID and fence. Renewal failure aborts the operation. Provider fetch and validation happen before writes. The reconciliation engine then applies its mutation plan inside a MongoDB transaction that first asserts the matching, unexpired operation ID and fence on the location. Post reads needed for conflict/tombstone protection and all reconciliation writes occur through the same transaction session. A concurrent lease takeover changes the location document and conflicts with or invalidates the transaction; the stale operation cannot commit. Every completion, failure-metadata update, lease release, and scheduling update is also conditional on the matching operation ID and fence, so an expired worker cannot complete or release a newer operation.

This transaction requirement is intentional: a pre-write lease check on `locations` cannot by itself fence writes to `posts`. Deployment must use a MongoDB replica set or sharded cluster with transaction support. Startup and verification documentation will check that capability before automatic synchronization is enabled. The global flag remains disabled when the capability has not been verified; manual synchronization migration to the shared runner will be tested against the supported deployment topology.

Provider pagination remains fetch-first: all pages must validate before reconciliation writes begin. Tombstone checks continue before import and immediately before the insert/upsert that could race with deletion. Existing published-record updates remain atomic and limited to provider-owned fields and eligible lifecycle states.

To close the stale-listing deletion race across collections, tombstone persistence and an increment of a location-level tombstone coordination epoch occur in one MongoDB transaction. The reconciliation transaction both reads the epoch/tombstones and performs a fenced write to the same location document before applying post mutations. Concurrent deletion therefore causes a transaction write conflict rather than allowing a stale import to commit. If deletion starts after reconciliation commits, the existing exact deterministic recovery-import cleanup removes the imported document. Tombstone transaction failure retains the post in its existing recoverable `deleting` state, and retry resumes without repeating a confirmed Google deletion.

Manual and automatic runs share this lease. A lease conflict from an automatic job is operational contention, not a provider failure; it is retried or rescheduled with bounded backoff. Manual API response codes and payload compatibility remain unchanged.

## Automatic scheduling

The existing scheduler process continues polling once per minute. A focused scheduling service uses an injected clock to find only due locations satisfying all of these conditions:

- global feature flag enabled;
- `provider: "google"`;
- active location with complete user, organization, client, account, location, and integration fields;
- `post_sync.auto_enabled: true`;
- `post_sync.next_auto_sync_at` missing or due;
- bound integration is active and not awaiting reauthorization;
- owning user and relevant organization membership/scope remain valid.

The scheduler atomically creates a short-lived enqueue claim in location metadata before enqueueing. If enqueue fails, it conditionally clears the claim; if the scheduler crashes, claim expiry makes the location eligible again. It adds a deterministic location-and-due-window BullMQ job whose payload contains only `locationId`, the enqueue claim ID, and safe timing metadata—never credentials. A new due window produces a new job ID, so retained completed or failed jobs cannot block future runs. Queue identity suppresses duplicate scheduler processes, while the expiring database claim and shared runtime lease provide correctness.

Finished and failed jobs are retained only according to bounded queue policies and cannot permanently reserve future runs. Success normally sets the next due time to 120 minutes after completion plus deterministic jitter. A successful manual sync also advances the next automatic due time. Transient failures use bounded exponential backoff with jitter; authentication failures set a longer blocked state and next eligible time so minute scans do not repeatedly call Google.

## Worker

A dedicated `post-sync` BullMQ worker is registered through the existing workers entry point and follows existing Redis, logging, startup, and shutdown conventions. For every job it:

1. Rechecks the global feature flag.
2. Reloads the location.
3. Revalidates `auto_enabled`, status, tenant scope, membership, provider identifiers, integration binding, and reauthorization state.
4. Resolves the exact integration bound to that location.
5. Runs the shared synchronization runner and heartbeat.
6. Records conditional success or sanitized failure metadata.

The worker skips disabled, deleted, disconnected, or unauthorized locations without making Google requests. Retry classification distinguishes authentication failures, rate limits (including `Retry-After` where available), transient provider/network failures, database/Redis failures, contention, and lost ownership. Attempts are finite.

Scheduler and worker entry points install graceful shutdown handlers. Shutdown stops new scheduler scans, closes the post-sync queue/worker, stops accepting new jobs, and allows the current operation a bounded drain period while its heartbeat remains active. If the drain deadline expires, the heartbeat stops and the lease is left to expire; the process never clears a lease it can no longer prove it owns.

## Settings APIs

The APIs are authenticated and mounted under a focused backend route such as `/api/v1/post-sync-settings`.

### Read settings

`GET /post-sync-settings?organizationId=<id>&integrationId=<optional-id>`

The backend uses the authenticated user and active membership to resolve readable locations by organization/client/location assignment; it does not require the location document to be owned by the requester. It validates supplied organization/account selectors against server-side membership and the integrations actually bound to accessible locations. Account choices are location-derived, not requester-owned-integration-derived, so shared administrators and managers can manage locations owned by another organization member without falling back to their own Google account. The location's owning user and exact bound integration are used later by the worker to resolve credentials. The response contains sanitized organization/account choices, location identity, display name, `autoEnabled`, `canManage`, interval label/minutes, last success, auto state, sanitized failure code, and next eligible timestamp. It never returns operation IDs, fences, credentials, or sensitive provider payloads.

### Update one location

`PATCH /post-sync-settings/locations/:locationId`

Body: `{ "enabled": true | false }`.

The backend loads the location by its server-side organization/location scope, then validates organization, client, assigned-location scope, membership role, integration binding, and provider. It does not use the requester-owned-location helper. It performs one atomic dotted update and preserves all other `post_sync` fields.

### Bulk update selected scope

`PATCH /post-sync-settings`

Body: `{ "organizationId": "...", "integrationId": "..." | null, "enabled": true | false }`.

The backend resolves the complete target set itself. It validates that every target is both visible and manageable before writing anything. If any target fails permission or scope validation, the request fails with no writes. Once validated, one scoped `updateMany` changes only `post_sync.auto_enabled`, due metadata, and `updated_at`. The filter includes the exact validated location IDs and tenant/account scope. The operation compares `matchedCount` with the validated target count; `modifiedCount` may be smaller when a location already has the requested value. A match-count mismatch reports a conflict rather than silent partial success.

The “All Locations” UI state is derived: checked only when every displayed manageable location is enabled, indeterminate when mixed, and disabled when no manageable location exists. It is never persisted independently.

## Frontend module

Add a Settings sidebar group and `/settings/post-auto-sync` page using existing `PageHeader`, UI components, `useApi`, notification context, and Axios service patterns. The page owns only view state and the selected organization/account scope; server responses remain authoritative.

The module includes:

- organization and connected Google-account selectors sourced from authenticated APIs;
- “Enable Auto-Sync for All Locations” bulk control;
- one location row per authorized Google location;
- an “Every 2 hours” interval display;
- last successful sync, current state, and useful sanitized error state;
- per-control and bulk loading/saving states;
- success/error notifications and inline permission messaging;
- disabled toggles for read-only locations.

On scope change, the page clears prior location settings, loads the new scope, and uses a request generation/scope comparison so a stale response cannot replace the selected scope. Controls are disabled while their corresponding mutation is pending. After success, the page refreshes or applies the server-returned authoritative settings.

No global organization context is introduced solely for this page. Existing account activation and location context behavior remain unchanged.

## Failure and recovery behavior

- **401/403 or reauthorization required:** record a sanitized authentication code, suppress short-interval retries, and wait for reconnection/next eligible time.
- **429:** honor a parseable `Retry-After`, otherwise use bounded exponential backoff with jitter.
- **5xx/network:** retry within configured maximum attempts.
- **Incomplete pagination:** perform no reconciliation writes.
- **Lease contention:** reschedule without recording provider failure.
- **Lease loss:** stop before further writes and record ownership loss only if still permitted by fencing.
- **Worker crash:** lease expiry permits a later operation; stale completion is rejected by operation ID and fence.
- **Disabled master switch or location:** queued jobs skip before Google access.

## Testing and verification

Focused unit and integration-style tests cover configuration defaults and validation, 120-minute due calculations, deterministic staggering, eligibility, multi-account binding, individual and bulk permissions, atomic/no-partial bulk behavior, metadata preservation, organization/account switching, duplicate schedulers/jobs, future runs after completion/failure, disabled queued jobs, bounded retry classifications, renewable leases and fencing, manual/automatic exclusion, crash recovery, lifecycle protections, tombstone races, pagination safety, and existing Phase 1/2/deletion compatibility.

Frontend tests cover settings loading, scope changes and stale responses, derived bulk state, individual/bulk mutations, read-only permissions, loading states, and useful API errors. Verification includes focused tests, the full backend suite, client tests, lint, production build, syntax checks, and `git diff --check`. Real MongoDB/Redis or live Google verification will be reported separately and never inferred from mocks.

After implementation and verification, update the existing canonical ParaMetrics Google Drive PRD in place with the Phase 3 architecture, 120-minute interval, settings/API behavior, lease and transaction decision, deployment and monitoring procedure, evidence, rollback steps, and known limitations. Repository notes remain implementation aids rather than a competing product specification.

## Deployment and rollback

Deploy API, scheduler, and worker code with `POST_AUTO_SYNC_ENABLED=false`; create the scheduler-supporting MongoDB index through existing startup index management; restart API, scheduler, and worker processes; verify manual sync; opt in one approved location through the settings UI; enable the master switch; and observe one full background cycle before expansion.

Emergency disable sets `POST_AUTO_SYNC_ENABLED=false` and restarts scheduler/workers. Queued jobs then skip provider calls. Rollback disables the flag first, rolls back processes, and leaves additive location metadata/indexes intact. Expired leases recover naturally; a manually cleared lease must be scoped to an expired operation and handled with documented administrative commands.

## Known limitations

- Scheduling is approximate because the scheduler scans once per minute and applies deterministic jitter.
- MongoDB single-document fencing protects location operation ownership; it is not a general distributed transaction across Google, MongoDB, and Redis.
- Automatic authentication recovery depends on the existing Google reconnection flow.
- The initial UI manages explicit per-location opt-in but does not expose the deployment-wide master switch.
