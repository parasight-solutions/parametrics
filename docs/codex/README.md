# ParaMetrics Codex Workflow

This folder defines the local Codex-first workflow for ParaMetrics. It is meant to keep implementation fast while preventing Sprint 1 stabilization work from drifting into future SaaS architecture or unverified commits.

## Roles

Codex edits code. Codex reads the repository, makes scoped changes, adds tests where practical, runs local checks, and reports exact command output summaries.

GPT defines and verifies. GPT writes or reviews the task contract, checks whether the implementation satisfies the stated scope, and decides whether the task can move toward commit.

The human runs Codex and terminal workflows, pastes outputs when needed, reviews browser behavior, and controls commits and pushes. The human is the release gate.

## Commit And Push Discipline

Do not commit before GPT verification. A Codex run should leave changes in the working tree, report the proof pack, and wait for verification.

Do not push before GPT explicitly passes the work and the human approves the push. This matters because ParaMetrics currently has unrelated backend work in progress, and accidental commits can mix stabilization fixes with larger tenancy changes.

Before any commit, isolate the intended changed files with `git status --short` and a scoped `git diff`. Backend files must not be included in frontend-only tasks.

## Sprint 1 / Phase 0 Boundary

Sprint 1 / Phase 0 is stabilization. The current product is a Google Business Profile first operations app. It has a React/Vite frontend in `apps/web` and an Express/Mongo/Redis/BullMQ backend in `apps/api`.

The target product is a multi-tenant, multi-channel SaaS with separated API, worker, and scheduler responsibilities. That target state guides naming and guardrails, but it is not permission to implement Phase 2 features during Phase 0.

Phase 0 work should preserve current behavior unless a change is required for correctness, data isolation, auth safety, or deterministic operation.

## Current Vs Target State Discipline

Current state describes what the app actually does today. Target state describes where ParaMetrics is going. Codex tasks must state which state is being modified.

Do not pretend target-state infrastructure already exists. Do not fake tenant support, do not loosen ownership guards, and do not infer org/client bindings for imported Google locations unless the task explicitly permits it.

When a task touches state or auth, prefer a small deterministic fix with tests over a broad rewrite. The app can evolve toward the target architecture after cut-line stabilization items are done.

## Why Phase 2 Is Blocked

Phase 2 integrations and SaaS expansion are blocked until cut-line Sprint 1 items are verified because the app must first have trustworthy auth, ownership, tenancy fields, and stale-state behavior.

Adding new channels or tenant abstractions before the stabilization line is verified increases the chance of data leakage, confusing UI state, and migrations that cannot be safely rolled back.

## Expected Codex Loop

1. Inspect the requested files and current working tree.
2. Identify existing local changes and avoid reverting user work.
3. Implement only the requested scope.
4. Add focused tests when a framework exists or can be added safely.
5. Run relevant checks from the correct package directory.
6. Report files changed, commands run, pass/fail summary, risks, and manual verification gaps.
7. Stop before commit or push unless explicitly instructed after verification.
