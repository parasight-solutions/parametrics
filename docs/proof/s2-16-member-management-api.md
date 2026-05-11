# S2-16 Member-Management API Proof

Date: 2026-05-03

## Scope

S2-16 implements direct member-management API routes for existing `user_id` based organization memberships.

Implemented endpoints:

- `POST /api/v1/orgs/:orgId/members`
- `PATCH /api/v1/orgs/:orgId/members/:memberId`
- `POST /api/v1/orgs/:orgId/members/:memberId/disable`

This task does not add email invitation delivery, invitation acceptance/token routes, frontend workspace/member UI, auth/JWT middleware changes, provider auth changes, report/location/GBP behavior changes, RBAC middleware, billing/entitlements, Phase 2 providers, Google location binding changes, destructive cleanup, or `location_org_map` canonical behavior.

## Docs Inspected

- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/sprint-2-workspace-member-foundation-proof-pack.md`
- `docs/proof/s2-14-member-management-api-contract.md`
- `docs/proof/s2-15-organization-member-fixtures-dry-run.md`
- `docs/proof/s2-15-2-organization-member-fixtures-apply.md`
- `docs/runtime/processes.md`
- `docs/architecture/workspace-members.md`
- `docs/architecture/member-management-api-contract.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`

## Implementation Summary

Member-management logic lives in `apps/api/src/services/organizationMembers.js`. The org route stays thin and calls service helpers from `apps/api/src/routes/orgs.js`.

Shared behavior:

- all endpoints require app authentication through the existing middleware
- authorization resolves active membership from `organization_members`
- JWT role is not trusted for workspace authorization
- `location_org_map` is not used
- responses reuse sanitized membership shape and omit `_id`, email, tokens, secrets, passwords, OAuth/provider payloads, and raw user records

Create behavior:

- direct create by `user_id`
- `role` defaults to `viewer`
- `status` defaults to `active`
- direct create allows `active` and `disabled` only
- existing `{ organization_id, user_id }` membership is preserved and returned with `created: false`

Patch/disable behavior:

- patch supports `role`, `status`, `assigned_client_ids`, and `assigned_location_ids`
- identical patch is a no-op with `updated: false`
- disable changes status only and never deletes the document
- already disabled target is a no-op with `disabled: false`

## Caller Role Behavior

- `owner`: can create/update/disable all supported member roles, subject to last-owner protection
- `admin`: can create/update/disable `manager`, `member`, and `viewer` only
- `manager`, `viewer`, `member`: denied with role-required errors
- `invited`, `disabled`, and missing memberships: denied because only active memberships are accepted

## Last-Owner Protection

Before patching or disabling an active owner in a way that would make the target no longer an active owner, the service counts active owners in the organization.

If the target is the final active owner, the operation fails with `last_owner_required`.

## Assignment Validation

For `manager` and `viewer` memberships:

- `assigned_client_ids` must match canonical `clients.id` rows with `clients.organization_id === orgId`
- `assigned_location_ids` must match canonical `locations.id` rows with `locations.organization_id === orgId`
- empty arrays are allowed and mean no scoped GBP access

For `owner`, `admin`, and `member` memberships:

- assignment arrays are persisted empty
- non-empty assignment arrays are rejected

No assignment validation uses `location_org_map`, and no imported Google locations are auto-bound.

## Audit Behavior

The route writes best-effort audit events through the existing audit service:

- `organization.member.create`
- `organization.member.update`
- `organization.member.disable`

Audit metadata is compact and includes target ids, roles/statuses, assignment counts, requester role, outcome flags, and optional short disable reason. Raw request bodies, tokens, secrets, OAuth data, emails, passwords, and raw user records are not included.

## Commands Run

Initial focused checks passed:

```bash
node --check apps/api/src/services/organizationMembers.js
node --check apps/api/src/routes/orgs.js
node --check apps/api/src/services/organizationMembers.test.js
node --check apps/api/src/routes/orgs.test.js
node --test apps/api/src/services/organizationMembers.test.js apps/api/src/routes/orgs.test.js
```

Changed test result:

```text
1..2
# tests 2
# pass 2
# fail 0
```

Existing backend matrix passed:

```bash
cd apps/api && node --test src/services/organizationMemberFixtures.test.js src/services/organizationMembers.test.js src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

Result:

```text
1..14
# tests 14
# pass 14
# fail 0
```

Package and diff checks:

- `cd apps/api && npm run`: passed and listed existing scripts.
- `cd apps/api && npm test`: failed with the expected missing `test` script.
- `git diff --check`: passed.
- `git diff --name-only -- apps/web`: no frontend diff.

## Remaining Risks

- No live API smoke was run in this task; coverage is focused backend service/route helper tests.
- Fixture users remain synthetic ids only, so live allow/deny smoke still needs safe fixture auth/token handling.
- Member-management writes are not wrapped in cross-document Mongo transactions.

## GPT Decision

Pass

The direct member-management API implementation was verified after route/service tests, existing backend matrix, audit/sanitization review, no-frontend-diff check, and diff checks.
