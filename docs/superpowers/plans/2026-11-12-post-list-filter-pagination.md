# Post List Filtering and Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side post keyword/status filtering and page-based pagination while preserving the existing posts response and old UI behavior.

**Architecture:** Extract query normalization and Mongo filter construction into a focused service, then use it from the posts GET route for count/skip/limit. Update only the old UI to request and navigate server pages; leave the new UI unchanged.

**Tech Stack:** Node.js, Express, MongoDB, React, Vitest/Node test runner

**Spec:** `docs/superpowers/specs/2026-11-12-post-list-filter-pagination-design.md`

## Global Constraints

- Keep `apps/client` unchanged.
- Default `page` to `1` and `perPage` to `10`; cap `perPage` at `100`.
- Preserve the top-level `posts` response property.
- Apply filters before pagination and keep newest-first sorting.

## Review Focus

- Regex metacharacters in `keyword` must be treated literally.
- `status=all` and blank filters must not narrow results.
- Invalid page values must return a safe 400 rather than reaching Mongo skip/limit.
- A page beyond `totalPages` must return an empty list with accurate metadata.
- Old UI status/search changes must reset the requested page to one.

---

### Task 1: Backend query contract

**Files:**
- Create: `apps/api/src/services/postList.js`
- Create: `apps/api/src/services/postList.test.js`
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `normalizePostListQuery(query)` and `buildPostListFilter({ baseFilter, keyword, status, matchingLocationIds })`.
- Produces: `GET /api/v1/posts` response `{ posts, pagination: { page, perPage, total, totalPages } }`.

- [ ] Write failing tests for defaults, bounds, literal keyword escaping, `all`, status, and matching location IDs.
- [ ] Run the focused tests and confirm failure because the service does not exist.
- [ ] Implement the service and integrate count, skip, and limit into the route.
- [ ] Run focused backend tests and confirm they pass.

### Task 2: Existing web consumer

**Files:**
- Create: `apps/web/src/lib/postListQuery.js`
- Create: `apps/web/src/lib/postListQuery.test.js`
- Modify: `apps/web/src/pages/Posts.jsx`

**Interfaces:**
- Consumes: backend `keyword`, `status`, `page`, and `perPage` query parameters and pagination response.
- Produces: `buildPostListQuery(params)` for deterministic old-UI requests.

- [ ] Write failing tests for filter omission, encoding, and pagination defaults.
- [ ] Run the focused test and confirm failure because the helper does not exist.
- [ ] Implement the helper, replace local filtering, debounce keyword requests, and render previous/next page controls.
- [ ] Run web tests and production build.

### Task 3: Regression verification

**Files:**
- Verify only; no intended production changes.

- [ ] Confirm `apps/client` has no diff from this task.
- [ ] Run the API suite and report any pre-existing platform failures separately.
- [ ] Run old-web tests, lint the changed files, and build the old web app.
