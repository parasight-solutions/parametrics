# S2-19 API `npm test` Script Proof Pack

Date: 2026-05-11

## 1. Scope And Decision

S2-19 is a follow-up to the Sprint 2 / Phase 1 closeout (S2-18). It consolidates the already-verified focused backend test matrix from S2-18 behind a formal `apps/api` `npm test` script so the same set of tests can be run with a single deterministic command without changing test behavior.

S2-19 is a package script + docs/proof task only. It does not change backend or frontend source code, routes, services, auth/JWT/provider behavior, GBP/report/location runtime behavior, RBAC middleware, billing/entitlements, Phase 2 providers, Google location binding behavior, worker/scheduler behavior, or dependencies. No API/worker/scheduler services were started.

Claude Code is the execution tool. Claude Code did not commit or push.

### GPT Decision

Pending.

## 2. Files Inspected

- `CLAUDE.md`
- `docs/claude-code/README.md`
- `docs/codex/README.md`
- `docs/codex/task-template.md`
- `docs/codex/verification-checklist.md`
- `docs/codex/local-proof-pack.md`
- `docs/codex/sprint-2-phase-1-guardrails.md`
- `docs/proof/sprint-2-closeout-proof-pack.md`
- `docs/runtime/processes.md`
- `docs/backlog/sprint-2-workspace-member-foundation.md`
- `apps/api/package.json`
- The 14 test files referenced by the new script (all exist under `apps/api/src/`).

## 3. Files Changed

- `apps/api/package.json` — added the new `test` script.
- `docs/proof/s2-19-api-test-script.md` — this proof doc (new).
- `docs/codex/sprint-2-phase-1-guardrails.md` — recorded S2-19 completion; Phase 2 remains blocked.
- `docs/backlog/sprint-2-workspace-member-foundation.md` — recorded the S2-19 follow-up row.
- `docs/proof/sprint-2-closeout-proof-pack.md` — added a small note that the S2-19 follow-up is complete.

No backend source files changed. No frontend source files changed. No routes, services, or middleware changed. No dependencies were installed or upgraded.

## 4. Exact Script Added

The script lives in `apps/api/package.json` as the `test` script:

```text
node --test src/services/organizationMemberFixtures.test.js src/services/organizationMembers.test.js src/services/organizationAccess.test.js src/routes/orgs.test.js src/routes/reports.test.js src/services/organizationMembersSeedMigration.test.js src/services/reportStore.test.js src/services/reportXlsx.test.js src/services/reportPdf.test.js src/services/reportService.test.js src/lib/corsConfig.test.js src/middleware/rateLimit.test.js src/services/locationBinding.test.js src/services/auditLog.test.js
```

It runs exactly the same focused matrix that S2-18 recorded as the verified backend test set. The 14 files in the same order are:

1. `src/services/organizationMemberFixtures.test.js`
2. `src/services/organizationMembers.test.js`
3. `src/services/organizationAccess.test.js`
4. `src/routes/orgs.test.js`
5. `src/routes/reports.test.js`
6. `src/services/organizationMembersSeedMigration.test.js`
7. `src/services/reportStore.test.js`
8. `src/services/reportXlsx.test.js`
9. `src/services/reportPdf.test.js`
10. `src/services/reportService.test.js`
11. `src/lib/corsConfig.test.js`
12. `src/middleware/rateLimit.test.js`
13. `src/services/locationBinding.test.js`
14. `src/services/auditLog.test.js`

No new dependency was added. `npm-run-all` was not used. Existing scripts (`start`, `start:workers`, `start:scheduler`, `dev:api`, `dev:workers`, `dev:scheduler`, `dev`, `migrate`, `seed`, `migrate:tenancy:s1-02`, `migrate:organization-members:s2-08`, `seed:organization-members:s2-15`, `seed:mongo`) were not renamed or removed.

## 5. Commands Run

```bash
cd apps/api && npm test
cd apps/api && npm run
cd apps/web && npm test -- --run
cd apps/web && npm run build
git diff --name-only -- apps/api/src apps/web/src package-lock.json apps/web/package.json
git diff --check
git status --short
git diff -- apps/api/package.json
```

No API server, worker, or scheduler was started. No destructive scripts ran. No migrations or seed scripts ran.

## 6. `cd apps/api && npm test` Result

Summary of the TAP tail:

```text
1..114
# tests 114
# suites 0
# pass 114
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms ~2054 (varies per run)
```

The new `npm test` script passes all 114 focused backend tests with `node --test`. The matrix and totals match the S2-18 closeout proof pack.

## 7. `cd apps/api && npm run` Output Summary

`npm run` now lists the following lifecycle and runnable scripts (script bodies elided here for brevity; same bodies as in the diff):

- `start`
- `test`  ← new
- `start:workers`
- `start:scheduler`
- `dev:api`
- `dev:workers`
- `dev:scheduler`
- `dev`
- `migrate`
- `seed`
- `migrate:tenancy:s1-02`
- `migrate:organization-members:s2-08`
- `seed:organization-members:s2-15`
- `seed:mongo`

The only new entry is `test`. No existing entries were renamed or removed.

## 8. Web Test/Build Result

```bash
cd apps/web && npm test -- --run
```

```text
Test Files  4 passed (4)
     Tests  21 passed (21)
```

```bash
cd apps/web && npm run build
```

```text
286 modules transformed.
✓ built in ~10s
```

The pre-existing Browserslist data-age warning is unchanged and was not addressed in S2-19.

## 9. Backend/Frontend Source Diff Confirmation

```bash
git diff --name-only -- apps/api/src apps/web/src package-lock.json apps/web/package.json
```

No output. There is no source diff under `apps/api/src` or `apps/web/src`, no `package-lock.json` diff, and no `apps/web/package.json` diff.

```bash
git diff --check
```

No output. No whitespace conflicts.

```bash
git status --short
```

Working-tree files for this task:

- `M apps/api/package.json`
- `M docs/codex/sprint-2-phase-1-guardrails.md`
- `M docs/backlog/sprint-2-workspace-member-foundation.md`
- `M docs/proof/sprint-2-closeout-proof-pack.md`
- `?? docs/proof/s2-19-api-test-script.md`

The `apps/api/package.json` diff adds only the new `test` script line; no existing scripts were edited.

## 10. Package-Lock Confirmation

`package-lock.json` was not modified. No dependencies were installed or upgraded. `npm test` ran from the existing installed `node_modules`. `node --test` is a Node.js built-in test runner and required no new dependency.

## 11. Remaining Risks

- `node --test` runs the listed files in argv order serially. If any future test file relies on shared global mutable state across files, the script's deterministic order documents the assumption but does not isolate state. Existing tests in this matrix are written as self-contained `node:test` suites and already pass.
- The script lists each test file explicitly rather than using a glob. Adding a new backend test file in the future will not run automatically; the script will need to be updated as part of that task.
- The script does not yet run worker or scheduler runtime tests because those layers do not have focused `node --test` coverage in scope. Phase 2 follow-ups that add worker or scheduler test files should add them to this script in their own task.
- Pre-existing Browserslist warning on the frontend build is unchanged.

## 12. Ready For GPT Verification

Yes. Working tree contains only the S2-19 package script change plus this proof doc and the guardrails/backlog/closeout doc updates. No backend or frontend source diff, no lockfile diff, no destructive command was run, no API/worker/scheduler service was started, and the focused matrix still passes through the new `npm test` script.

No commit and no push were performed.

## GPT Verification

GPT decision: Pass.

The S2-19 API test script was verified after the new npm test script passed the focused backend matrix, web tests, web build, no-source-diff checks, no-lockfile-diff checks, and diff checks.
