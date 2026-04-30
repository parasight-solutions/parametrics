# Local Proof Pack

Every ParaMetrics task should end with a local proof pack. The proof pack gives GPT and the human enough information to pass, fail, or request changes without guessing.

## 1. Codex Summary

Include a short summary of what changed and why. Mention the task ID and whether the work was frontend-only, backend-only, docs-only, or mixed.

For this task style, say explicitly when backend files were intentionally not touched.

## 2. Git Status

Run:

```bash
git status --short
```

Paste or summarize the relevant output. Call out unrelated pre-existing changes so they are not accidentally committed.

## 3. Scoped Diff

Run a scoped diff for task files.

Examples:

```bash
git diff -- apps/web docs/codex package-lock.json
git diff -- apps/api
```

The diff must prove the implementation stayed inside scope. For frontend-only tasks, backend diffs should be absent from the task proof.

## 4. Test And Build Outputs

Run the task-required checks and record exact pass/fail summaries.

For `apps/web` React/Vite work:

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
```

For `apps/api` Express/Mongo/Redis/BullMQ work, run the requested backend tests and any safe migration checks. Include Redis/BullMQ worker or scheduler checks only when the task touches those areas.

Record warnings, skipped tests, and known unrelated audit output.

## 5. Browser/API Verification Notes

When the behavior is user-visible, include manual verification notes.

For auth/location/dashboard state work, expected notes include:

- Which users/accounts were tested.
- Whether selected location cleared on user switch.
- Whether dashboard metrics remained hidden until a valid location was selected.
- Whether stale location 404 cleared the active location.
- Whether provider reauth avoided app logout.

If manual browser checks were not run, say so directly and explain the remaining gap.

## 6. Known Risks

List real residual risks, not generic caveats.

Examples:

- Google callback JWT claims were not manually verified in-browser.
- Dependency install updated the root workspace lockfile.
- Browser manual verification remains pending.
- Existing unrelated backend changes are present and must stay out of this commit.

## 7. GPT Pass/Fail Decision

GPT should mark one of:

- Pass: ready for human commit review.
- Conditional pass: ready after named manual checks.
- Fail: requires code changes.

Include the reason.

## 8. Commit Hash After Commit

After approval and commit, record:

```bash
git rev-parse HEAD
```

Also record the exact committed files if there were unrelated working-tree changes.

## 9. Push Proof After Push

After approval and push, record:

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

If a pull request is opened, include the PR URL and CI/check status when available.
