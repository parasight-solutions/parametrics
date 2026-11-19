# Google Post Recovery — Phase 1 Proof Pack

## Scope

Branch: `fix/google-post-deletion`

Starting HEAD: `0e51f832dcfaf476011a3ee6eada30bdd666052a`

This change adds a backend-only, location-scoped recovery service and CLI for importing Google Business Profile Local Posts that have no corresponding MongoDB post. It adds no API, frontend, worker, scheduler, database index, or migration.

## Architecture and safety

- The CLI accepts only `--location-id` and derives all tenancy, integration, and provider scope from MongoDB.
- It verifies active owner/admin/assigned-manager organization access and the exact active Google integration.
- It confirms the integration can see the bound Google account and location.
- Every provider page is fetched before any MongoDB read or write. Repeated page tokens and bounded page/record limits abort safely.
- Existing records are located by exact `provider_post_name` and deterministic recovery `_id`. Scope mismatches, duplicates, and identity collisions are conflicts and are never modified.
- Dry-run is the default. Apply uses only `updateOne({ _id }, { $setOnInsert: document }, { upsert: true })`.
- Imported records are published, list/detail compatible, and satisfy the existing Google-first deletion contract.

Deterministic `_id` values make this recovery insertion path idempotent across reruns and concurrent executions. They do not universally enforce provider-reference uniqueness across legacy records or other insertion paths; no unique index was added.

## Human-run commands

Dry-run (no writes):

```powershell
npm run posts:recover --workspace @parametrics/api -- --location-id=<LOCATION_ID>
```

Apply only after reviewing the dry-run:

```powershell
npm run posts:recover --workspace @parametrics/api -- --location-id=<LOCATION_ID> --apply
```

Neither command was executed during implementation.

## Representative safe output

The command prints `mode`, selected location/provider identifiers, page/provider totals, existing/eligible/inserted/invalid/conflict/failed counts, the unusually-large indicator, and safe per-record application ids/provider references. It does not print OAuth tokens, integration secrets, raw users, or provider request bodies.

## Automated evidence

Focused tests cover strict arguments, authorization and integration validation, access visibility, complete pagination, partial-page failure with zero database activity, exact reconciliation, invalid and duplicate provider names, dry-run zero writes, `$setOnInsert` apply, idempotent reruns, concurrent convergence, stable identifiers, and compatibility with Google-first deletion.

Final verification commands:

```powershell
npm test -w @parametrics/api
node --check apps/api/src/services/postSync.js
node --check apps/api/src/services/postRecoveryCli.js
node --check apps/api/src/scripts/recover.google-posts.js
git diff --check
```

## Rollback

Remove the recovery service, CLI service/script, package scripts/test registration, and recovery documentation. Do not automatically remove records created by a later human-run apply; any data rollback requires a separately reviewed provider-aware plan.

## Deferred work

Phase 2 authenticated recovery API/UI and Phase 3 scheduled reconciliation are intentionally not implemented.
