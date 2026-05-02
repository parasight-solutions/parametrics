# Workspace Members

ParaMetrics remains a Google Business Profile first operations app. Workspace/member work in Phase 1 must preserve current GBP behavior while adding a safe foundation for future shared organization access.

## Current Vocabulary

`organization_members` is the canonical membership collection for workspace access work.

Supported membership statuses:

- `active`
- `invited`
- `disabled`

Supported membership roles:

- `owner`
- `admin`
- `manager`
- `member`
- `viewer`

The S2-08 owner seed migration remains compatible with this vocabulary because it creates `role: "owner"` and `status: "active"` memberships.

## S2-09 Helper Scope

S2-09 is complete. It added backend organization access helpers only.

The helper service can:

- normalize membership roles and statuses
- load an active membership for an explicit `{ organizationId, userId }`
- check whether a user has any active membership in an organization
- check whether a membership role is in an allowed role set
- throw compact access errors with `status`, `statusCode`, `code`, and safe messages

The helpers require explicit `organizationId` and `userId`. They do not infer organization scope from session state, active frontend location state, `locations`, or legacy `location_org_map`.

## Non-Goals

S2-09 does not:

- change existing route authorization behavior
- replace current user-owned guards
- wire membership checks into org, location, posts, reviews, recurrence, reports, or dashboard routes
- add RBAC middleware
- change JWT/auth behavior
- add workspace/member APIs
- add invite flows
- add frontend workspace/member UI
- add billing or entitlements
- add Phase 2 providers or multi-channel metrics
- change Google location binding behavior
- make `location_org_map` canonical
- auto-create memberships

## Future Handoff

S2-10 can begin route-level membership authorization gradually. Future route tasks should treat client-sent `organization_id`, `client_id`, and `location_id` as requested scope only, load the active organization membership server-side, and then verify role plus client/location scope before changing existing GBP or report behavior.

Membership helpers should remain adapter-friendly for tests: callers can use the default MongoDB collection at runtime, while tests should inject fake collections or database adapters.

## S2-10 Route Authorization Scope

S2-10 is complete. It started route-level membership authorization only for low-blast-radius organization and report paths.

Dashboard snapshot report generation now requires:

- explicit `organization_id`
- active `organization_members` membership for the authenticated `req.user.user_id`
- one of these organization roles for location-scoped reports: `owner`, `admin`, or assigned `manager`
- `owner` or `admin` for non-location organization-level report requests

Report generation continues to enforce the existing owned-location and canonical `organization_id` / `client_id` / `location_id` scope checks when `location_id` is provided. Location-scoped reports now authorize against the loaded location's canonical organization/client/location scope, not only the client-sent organization id. Generated PDF/XLSX files remain response-only base64 for the MVP route, and `report_runs` continues to persist metadata only.

Organization routes now start using membership-aware checks where the blast radius is low:

- org listing can include organizations where the user has active membership
- legacy owner-created org visibility remains available during the transition
- existing org mutation and location bind paths fail closed unless the user has active `owner` or `admin` membership
- new org creation still does not require pre-existing membership

New org creation still writes the current `user_id` and `owner_user_id` fields. Creating owner memberships for newly created orgs remains a follow-up unless handled by a later dedicated task.

S2-10 does not change GBP posts, reviews, locations, recurrence, dashboard metrics, Google integration routes, provider auth, JWT/auth middleware, frontend UI, invite/member-management APIs, billing, entitlements, Phase 2 providers, or `location_org_map` canonicality.

## S2-10.1 Location-Bound GBP Authorization Scope

S2-10.1 is in progress. It extends membership-aware checks to current GBP location-bound operations after the existing owned-location and canonical scope checks.

The protected runtime pattern is:

1. Authenticate the app user through the existing JWT middleware.
2. Load the Google location through the existing user-owned location guard.
3. Require canonical `locations.organization_id`, `locations.client_id`, and `locations.id`.
4. Require active `organization_members` access for the canonical organization and the canonical client/location assignment.
5. Continue the existing GBP operation.

S2-10.1 does not trust client-sent organization/client/location scope. Client-sent IDs are request hints only; authorization uses the loaded location document's canonical `organization_id`, `client_id`, and `id`. Legacy `location_org_map` and `locations.org_id` are not authorization sources.

Role behavior for protected location-bound routes:

- `owner` and `admin`: full current access for bound locations; assignment arrays are ignored.
- `manager`: allowed for operational location-bound actions only when `assigned_location_ids` contains the location id or `assigned_client_ids` contains the client id.
- `viewer`: allowed for read-only location-scoped reads that now use the helper path, including dashboard performance metrics, review reads, post list reads when a location is specified, recurrence rule/post reads, and media reads that resolve through a canonical local location id. Viewer is denied for mutations.
- `member`: denied for protected location-bound operations.
- `invited`, `disabled`, and missing membership: denied because only active memberships are accepted.

Assignment arrays:

- `assigned_location_ids`: explicit local `locations.id` assignments.
- `assigned_client_ids`: explicit canonical client assignments.
- Empty or missing assignment arrays deny `manager` and `viewer` scoped location access.
- Owner/admin memberships do not need assignment arrays.

Current limitations:

- Existing user-owned location checks still run first, so S2-10.1 preserves current single-user owner success behavior but does not yet enable shared cross-user access to another user's imported locations.
- Unbound imported Google locations are not auto-bound and fail closed for scoped operations.
- `GET /api/v1/locations` still lists the authenticated user's imported Google locations for current binding/selection flows; the destructive location delete path requires owner/admin membership after canonical scope resolution.
- `GET /api/v1/posts` without a `locationId` remains the existing user-owned aggregate view. The location-scoped list path is membership-aware.
- Google OAuth, provider connection, account listing, location import, and reconcile behavior are unchanged.
- Workspace/member management APIs, invite flows, billing/entitlements, frontend workspace/member UI, and Phase 2 providers remain follow-ups.
