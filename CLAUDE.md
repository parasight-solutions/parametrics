# Claude Code Governance Adapter

This file is a thin adapter for Claude Code. It is not a replacement for the existing project workflow docs. ParaMetrics already has GPT-verified execution workflow documentation under `docs/codex/`. Claude Code follows the same workflow.

## Read Before Editing

Before any change, read:

- `docs/codex/README.md` — current GPT-verified execution workflow.
- `docs/codex/task-template.md` — task contract shape.
- `docs/codex/verification-checklist.md` — pre-commit verification checklist.
- `docs/codex/local-proof-pack.md` — proof pack shape.
- `docs/codex/sprint-2-phase-1-guardrails.md` — current sprint guardrails.
- Sprint-relevant proof pack(s) under `docs/proof/` and architecture docs under `docs/architecture/`.

## Workflow Rules

- Claude Code edits files only.
- Claude Code must not run `git commit` or `git push`.
- GPT verifies the proof pack and decides whether commit is allowed.
- The human runs the actual commit/push commands after approval.

## Scope Rules

- No broad rewrites. Stay inside the scope listed in the task prompt.
- No Phase 2 integrations unless the task explicitly approves them.
- Keep API, worker, and scheduler runtime roles separate (see `docs/runtime/processes.md`).
- ParaMetrics is currently a Google Business Profile first operations app. Do not change GBP/report/location/auth behavior unless the task explicitly says so.
- Keep current state vs target state separate. Do not pretend target-state features exist.
- Do not change auth/JWT/provider behavior outside an explicit task.
- Do not auto-bind imported Google locations, do not change `location_org_map` canonicality, and do not loosen ownership guards.

## Secrets And Output Hygiene

Never print JWTs, OAuth tokens, refresh tokens, ID tokens, raw Google auth codes, authorization headers, encrypted secrets, passwords, emails, raw user records, or full request bodies. Print summarized ids, counts, and outcome flags only. This rule applies to proof docs, terminal output captured in proofs, and any inline communication.

## Report-Back Format

When done with a task, report:

- Docs read.
- Files inspected.
- Files changed.
- Commands run with summarized output.
- Tests/checks run and pass/fail summary.
- Risks and remaining gaps.
- Whether the working tree is ready for GPT verification (yes/no).
- Explicitly: no commit or push was performed.

GPT verifies the proof pack before any `git commit` or `git push` happens.
