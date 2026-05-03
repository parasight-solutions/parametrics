# S2-14 Member-Management API Contract Proof

Date: 2026-05-03

## Scope

S2-14 designed the future member-management API contract and fixture strategy before implementation.

This was documentation/design work only. No backend routes, backend services, tests, frontend files, auth/JWT behavior, provider auth behavior, report/location behavior, RBAC middleware, billing/entitlements, Phase 2 providers, Google location binding behavior, destructive scripts, or dependencies were changed.

## Docs Inspected

- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-1-phase-0-proof-pack.md`
- `docs/proof/sprint-2-workspace-member-foundation-proof-pack.md`
- `docs/proof/s2-08-organization-members-migration-dry-run.md`
- `docs/proof/s2-08-1-organization-members-migration-apply.md`
- `docs/proof/s2-10-2-gbp-membership-smoke.md`
- `docs/proof/s2-11-1-new-org-owner-membership-smoke.md`
- `docs/proof/s2-12-1-read-only-member-listing-smoke.md`
- `docs/runtime/processes.md`
- `docs/architecture/location-org-mapping.md`
- `docs/architecture/report-service.md`
- `docs/architecture/workspace-member-model.md`
- `docs/architecture/workspace-members.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`

## Files Changed

- `docs/architecture/member-management-api-contract.md`
- `docs/architecture/workspace-members.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/s2-14-member-management-api-contract.md`

## Contract Summary

The contract documents these future endpoints:

- `POST /api/v1/orgs/:orgId/members`
- `PATCH /api/v1/orgs/:orgId/members/:memberId`
- `POST /api/v1/orgs/:orgId/members/:memberId/disable`
- future/not Sprint 2: `POST /api/v1/orgs/:orgId/invitations`

The design chooses direct member management by existing `user_id` as the next implementable path. Email invitation delivery is deferred until invite tokens, expiry, acceptance, resend, cancellation, delivery, and safe email display rules are designed.

## Role And Safety Summary

- Owner can manage all member roles, except no operation may remove, disable, or downgrade the final active owner.
- Admin can manage manager/member/viewer only.
- Manager, viewer, member, invited, disabled, and missing memberships cannot manage organization members.
- Future implementation must use `organization_members`, not JWT role or `location_org_map`, for workspace authorization.
- Future implementation must validate assignment ids against canonical clients/locations in the requested organization.
- Future responses must omit Mongo `_id`, emails unless a later invite display policy allows them, tokens, secrets, OAuth/provider payloads, password fields, and raw user records.

## Fixture Strategy Summary

The contract recommends controlled local fixtures with obvious prefixes such as `s2-15-fixture-`, `s2-15-member-`, and `s2-15-user-`.

Fixture work should be dry-run-first, non-destructive by default, avoid Beetle working data, print summarized ids/counts only, and cover owner/admin/manager/viewer/member/invited/disabled allow/deny cases before member-management routes are implemented.

## Checks Run

```bash
git diff --check
git status --short
git diff --name-only -- apps/api apps/web package.json package-lock.json
```

Results:

- `git diff --check`: passed with no output.
- `git status --short`: docs-only changes in allowed files.
- `git diff --name-only -- apps/api apps/web package.json package-lock.json`: passed with no output.

No code tests were run because S2-14 is documentation/design only and no runtime code changed.

## Explicit Non-Goals

S2-14 did not add:

- backend routes
- member creation APIs
- invite APIs
- role update APIs
- remove/disable APIs
- frontend workspace/member UI
- auth/JWT changes
- provider auth changes
- report/location behavior changes
- RBAC middleware
- billing/entitlements
- Phase 2 providers or multi-channel metrics
- Google location binding changes
- `location_org_map` canonical behavior

## Result

Pass pending GPT verification.
