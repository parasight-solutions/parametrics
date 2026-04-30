# Location-Org Mapping

ParaMetrics is currently a Google Business Profile first operations app. Sprint 1 / Phase 0 uses the target ownership chain as a guardrail:

```text
organization/workspace -> client -> location -> posts/reviews/recurrence/review_sync_state
```

This document defines the current location binding model. It is intentionally conservative: it makes the canonical path explicit while preserving legacy compatibility until a later cleanup task.

## Current State

Google locations are imported into the `locations` collection with provider metadata such as `provider`, `provider_account_name`, `provider_location_name`, and `integration_id`.

Imported Google locations are not automatically attached to an organization or client. They become usable for scoped post, review, and recurrence behavior only after an explicit bind.

Some older code and data still refer to `locations.org_id` or `location_org_map`. Those fields remain readable for compatibility, but they are not the canonical model direction.

## Canonical Source Of Truth

The canonical location binding source of truth is on the location document:

- `locations.organization_id`
- `locations.client_id`

Any new location-scoped records should copy these fields from the bound location, along with `user_id` and `location_id`.

## Legacy Compatibility

The following remain legacy compatibility only:

- `locations.org_id`
- `location_org_map`

These may be read as a fallback for older data during Phase 0, and bind routes may continue to dual-write them. New code should not treat them as the primary source of truth.

## Explicit Bind Write Behavior

Explicit bind routes currently:

- Verify the authenticated user owns the location.
- Verify the target organization belongs to the authenticated user.
- Create or reuse the organization's default client.
- Write canonical fields to `locations.organization_id` and `locations.client_id`.
- Dual-write `locations.org_id` for older code.
- Dual-write `location_org_map.org_id` and `location_org_map.organization_id` for older code.

Bind responses expose both canonical and legacy shapes so new callers can read the canonical fields while old callers can continue using existing fields.

## Read Behavior

Read paths should prefer canonical location fields:

1. Read `locations.organization_id` and `locations.client_id`.
2. Use `locations.org_id` or `location_org_map` only as a legacy fallback where compatibility is still required.
3. Do not require `location_org_map` when the location already has canonical organization and client fields.

Ownership guards for posts, reviews, recurrence rules, and review sync state fail closed when canonical location scope is missing. This is intentional and prevents unscoped imported locations from being used as if they were bound.

## Import Behavior

Google location import must not bind locations to an organization or client automatically.

Import may update provider metadata and Google integration references on `locations`, but it must leave `organization_id`, `client_id`, and `org_id` untouched unless the user performs an explicit bind action.

## S1-10 Migration Audit

The tenancy migration script is the current audit entrypoint:

```bash
npm run -w @parametrics/api migrate:tenancy:s1-02
```

Dry-run is the default. It must not write data.

Apply mode requires an explicit flag and should only be run after proof review:

```bash
npm run -w @parametrics/api migrate:tenancy:s1-02 -- --apply
```

The dry-run/apply output distinguishes:

- `backfillable`: records with verified source data that can be updated safely.
- `applied`: records actually changed in `--apply` mode.
- `orphans` / `orphanUnboundSkipped`: records that cannot be backfilled because a location, organization, client, or verified binding is missing.

Safe backfill rules:

- Organizations may receive missing `owner_user_id`, `slug`, `status`, and a default client.
- `location_org_map.organization_id` may be mirrored from `location_org_map.org_id` for legacy compatibility.
- Locations may receive canonical `organization_id` and `client_id` only from a verified location or legacy explicit binding that resolves to a real organization and safe client.
- Posts, reviews, review sync state, and recurrence rules may receive canonical scope only from their referenced location.

The migration must not auto-bind imported Google locations, bind by active user, bind by active organization guesses, or delete stale data.

## Future Cleanup

Later cleanup should handle removal planning, including:

- Backfilling canonical fields for verified legacy bindings.
- Auditing rows that have `location_org_map` entries but missing canonical fields.
- Auditing rows that have `locations.org_id` but missing `organization_id` or `client_id`.
- Deciding when legacy map reads can be removed.
- Deciding when `location_org_map` and `locations.org_id` can stop being written.

No destructive migration or collection removal is part of S1-10.

## Forbidden Behavior

Do not auto-bind imported Google locations.

Do not use `location_org_map` as the canonical source of truth.

Do not loosen ownership guards to make unbound locations appear usable.

Do not add Phase 2 entities, channels, providers, or tenant switching UI as part of mapping cleanup.
