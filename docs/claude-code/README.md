# Claude Code Adapter

This folder is a thin adapter for Claude Code. ParaMetrics already documents its GPT-verified execution workflow under `docs/codex/`. Those documents remain the current source of truth until they are intentionally renamed to a tool-neutral folder in a later task. Claude Code follows the same workflow.

## What This Folder Is

- A pointer to the existing `docs/codex/*` governance documents.
- A short adapter description for Claude Code only.
- A reminder that Claude Code must not commit or push.

## What This Folder Is Not

- Not a full governance rulebook.
- Not a replacement for `docs/codex/README.md`, the task template, the verification checklist, the local proof pack, or sprint guardrails.
- Not a place for duplicated commit/push policy, current-state vs target-state policy, runtime separation policy, or sprint scoping policy. Update the original `docs/codex/*` docs instead.

## Workflow Pointer

Claude Code follows the same loop as the GPT-verified workflow:

1. Read `docs/codex/README.md`, `docs/codex/task-template.md`, `docs/codex/verification-checklist.md`, `docs/codex/local-proof-pack.md`, the current sprint guardrails, and the relevant proof/architecture/backlog docs.
2. Implement only the requested scope.
3. Run focused checks listed in the task or the verification checklist.
4. Produce a proof doc under `docs/proof/` when the task requires one.
5. Report back using the report-back format described in the root `CLAUDE.md` adapter file.
6. Do not commit or push. Wait for GPT verification and human approval.

## Tool-Neutral Folder Rename

If the project chooses to rename `docs/codex/` to a tool-neutral folder later, this adapter folder can be removed or updated at that time. Until that rename happens, Claude Code reads from `docs/codex/*` like the existing workflow does.
