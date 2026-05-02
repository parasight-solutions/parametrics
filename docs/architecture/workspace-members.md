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

S2-10 starts route-level membership authorization only for low-blast-radius organization and report paths.

Dashboard snapshot report generation now requires:

- explicit `organization_id`
- active `organization_members` membership for the authenticated `req.user.user_id`
- one of these organization roles: `owner`, `admin`, or `manager`

Report generation continues to enforce the existing owned-location and canonical `organization_id` / `client_id` / `location_id` scope checks when `location_id` is provided. Generated PDF/XLSX files remain response-only base64 for the MVP route, and `report_runs` continues to persist metadata only.

Organization routes now start using membership-aware checks where the blast radius is low:

- org listing can include organizations where the user has active membership
- legacy owner-created org visibility remains available during the transition
- existing org mutation and location bind paths fail closed unless the user has active `owner` or `admin` membership
- new org creation still does not require pre-existing membership

New org creation still writes the current `user_id` and `owner_user_id` fields. Creating owner memberships for newly created orgs remains a follow-up unless handled by a later dedicated task.

S2-10 does not change GBP posts, reviews, locations, recurrence, dashboard metrics, Google integration routes, provider auth, JWT/auth middleware, frontend UI, invite/member-management APIs, billing, entitlements, Phase 2 providers, or `location_org_map` canonicality.
