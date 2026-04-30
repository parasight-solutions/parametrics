# Codex Task Template

Use this template for ParaMetrics implementation tasks. Keep it concrete and scoped to the current sprint boundary.

## Task ID

`S1-XX` or another stable identifier.

## Goal

State the outcome in one or two sentences. Example: "Prevent stale dashboard state from rendering after the authenticated user changes."

## Phase/Priority

Name the sprint, phase, and priority. Example: "Sprint 1 / Phase 0 stabilization only / high priority."

## Current State

Describe what exists today in ParaMetrics. Include the relevant stack area:

- `apps/web`: React/Vite frontend.
- `apps/api`: Express/Mongo/Redis/BullMQ backend.
- API, worker, and scheduler separation is a target direction, not always fully implemented.

## Problem

Describe the observed bug or missing behavior. Include proof when known, such as "backend ownership guards return 404, so the issue is stale frontend state rather than backend leakage."

## Scope

List the directories and behavior Codex may change. Be explicit:

- Allowed code paths.
- Allowed docs paths.
- Whether tests may be added.
- Whether dependency metadata may be updated.

## Out Of Scope

List forbidden work. For Sprint 1 / Phase 0, common exclusions are:

- No Phase 2 integrations.
- No fake tenant support.
- No backend ownership loosening.
- No auto-binding imported Google locations to org/client.
- No broad architecture rewrites.
- No commits or pushes unless explicitly requested after verification.

## Files To Inspect First

List exact files or search targets. Example:

- `apps/web/src/session.js`
- `apps/web/src/apiClient.js`
- `apps/web/src/components/ActiveLocationPicker.jsx`
- Any `localStorage` or `sessionStorage` usage.

## Required Behavior

Write deterministic requirements. Prefer observable behavior over implementation preference.

Example:

- Auth identity switch clears app-owned UI/cache state.
- Same-user refresh preserves valid selected location.
- Provider reauth does not logout app auth.
- App auth 401 clears app session and redirects to login.

## Acceptance Criteria

List what must be true before the task can pass. Include browser behavior, API behavior, storage behavior, and any regression expectations.

## Tests To Add/Run

Describe expected test coverage and commands. Example:

- Add unit tests for `session.js`.
- Add API-client tests for location-bound 404 behavior.
- Run `cd apps/web && npm test -- --run`.
- Run `cd apps/web && npm run build`.

If no test framework exists, state whether Codex should add the smallest safe setup or explain why not.

## Commands To Run

List exact commands from the intended working directory.

Example:

```bash
cd apps/web && npm test -- --run
cd apps/web && npm run build
git status --short
git diff -- apps/web docs/codex
```

## Reporting Format

Codex should report:

- Files changed.
- Tests added.
- Commands run.
- Exact pass/fail output summary.
- Storage keys or APIs discovered, when relevant.
- Files intentionally not touched.
- Manual browser/API verification gaps.
- Risks and follow-ups.

## Risks/Follow-Ups

List known uncertainty that should not block the current task, such as:

- Manual browser account-switch verification still needed.
- Dependency audit findings unrelated to the task.
- Existing unrelated working-tree changes that must not be committed with this task.
