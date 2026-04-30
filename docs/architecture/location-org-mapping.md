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

## S1-10 Migration And Cleanup

S1-10 or a later cleanup task should handle data migration and removal planning, including:

- Backfilling canonical fields for verified legacy bindings.
- Auditing rows that have `location_org_map` entries but missing canonical fields.
- Auditing rows that have `locations.org_id` but missing `organization_id` or `client_id`.
- Deciding when legacy map reads can be removed.
- Deciding when `location_org_map` and `locations.org_id` can stop being written.

No destructive migration or collection removal is part of S1-09.

## Forbidden Behavior

Do not auto-bind imported Google locations.

Do not use `location_org_map` as the canonical source of truth.

Do not loosen ownership guards to make unbound locations appear usable.

Do not add Phase 2 entities, channels, providers, or tenant switching UI as part of mapping cleanup.
