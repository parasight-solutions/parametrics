# Verification Checklist

Use this checklist before committing any ParaMetrics task.

## 1. Git Status Isolation

Run:

```bash
git status --short
```

Confirm every changed file belongs to the task. If unrelated files exist, keep them out of the commit. For frontend-only tasks, do not include `apps/api` changes.

## 2. Changed-Files Review

List the exact files changed for the task. Confirm the list matches the allowed scope from the task prompt.

For this repository, common scopes are:

- Frontend code/tests: `apps/web`.
- Backend code/tests: `apps/api`.
- Local governance docs: `docs/codex`.

Workspace metadata such as the root `package-lock.json` may change when adding workspace dependencies. Treat that as dependency metadata and verify it is caused only by the requested package change.

## 3. Diff Review

Run a scoped diff:

```bash
git diff -- apps/web docs/codex package-lock.json
```

Review for:

- No backend ownership/auth logic changes unless the task explicitly allowed them.
- No Phase 2 feature work.
- No fake tenant support.
- No imported Google location auto-binding.
- No broad rewrites or unrelated formatting churn.
- No secrets, tokens, or local-only values.

## 4. Package, Build, And Test Output

Run package checks from the owning app directory.

For `apps/web` React/Vite work:

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
```

Capture pass/fail summaries. Warnings should be recorded exactly enough for GPT to decide whether they are related to the task.

For `apps/api` Express/Mongo/Redis/BullMQ work, run the relevant backend tests and any migration checks requested by the task. Do not run destructive database commands unless the task and environment explicitly permit it.

## 5. Manual Browser Checks

When UI/auth behavior changes, verify in a browser before commit when practical.

For stale frontend state work, check:

- Login as User A.
- Select a location and load dashboard metrics.
- Logout.
- Login as User B through the same app auth flow, including Google callback if applicable.
- Confirm User A location and metrics are not shown.
- Confirm User B sees choose-location or a valid User B location only.
- Confirm a stale location 404 clears the selection without logging out app auth.
- Confirm Google provider reauth banners do not clear ParaMetrics app auth.

## 6. Rollback Check

Identify the smallest rollback path:

- Which files would be reverted if the fix misbehaves?
- Did the task add a dependency or lockfile entry?
- Are generated build artifacts excluded from the intended commit?

Do not run destructive rollback commands unless explicitly requested.

## 7. Commit Gate

Commit only after:

- GPT passes the implementation.
- The human confirms the intended file list.
- Tests/build outputs are available.
- Manual verification gaps are documented.

The commit should include only task files. Do not include prior unrelated backend or frontend edits.

## 8. Push Gate

Push only after:

- The commit hash is known.
- GPT or the human explicitly approves push.
- The target branch is confirmed.
- No accidental extra commits are included.

## 9. Completion Proof Requirements

The final proof pack should include:

- Codex summary.
- `git status --short`.
- Scoped `git diff` or changed-file summary.
- Test/build command outputs.
- Browser/API verification notes.
- Known risks.
- GPT pass/fail decision.
- Commit hash after commit.
- Push proof after push.
