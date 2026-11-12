# Google Post Public URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose Google's canonical public post URL for future and historical published posts, then let the new UI open it.

**Architecture:** Store the `searchUrl` returned by Google's LocalPost resource as `provider_post_url`. A dependency-injected backfill service resolves historical URLs with paginated location-level lists and exact-name get fallbacks; a dry-run-by-default script supplies real database and Google dependencies.

**Tech Stack:** Node.js, Express, MongoDB, Google Business Profile v4 API, React, Vitest, Node test runner

**Spec:** `docs/superpowers/specs/2026-11-12-google-post-public-url-design.md`

## Global Constraints

- Preserve `provider_post_name` as the API resource identifier.
- Never construct a public URL from the resource name.
- Backfill writes require `--apply` and only fill missing URLs.
- Do not change existing shared UI component internals.
- Preserve unrelated working-tree changes and do not create commits.

## Review Focus

- Google returns no `searchUrl`: leave the record unchanged and count it unavailable.
- Google list pagination: follow every `nextPageToken` before falling back to individual gets.
- Multiple tenants or integrations: resolve credentials and locations from each post's existing scope.
- Repeated `--apply`: already-filled records are excluded and no duplicate mutation occurs.
- Unsafe or absent URL in the UI: disable navigation rather than opening a guessed value.

---

### Task 1: Future URL persistence and response

**Files:**
- Modify: `apps/api/src/routes/posts.js`
- Modify: `apps/api/src/services/googlePosts.js`
- Modify: `apps/api/src/services/postList.test.js`

**Interfaces:**
- Consumes: Google LocalPost `{ name, searchUrl }`.
- Produces: persisted and serialized `provider_post_url: string | null`.

- [ ] Add a failing post serialization/persistence helper test asserting `searchUrl` becomes `provider_post_url` while `name` remains `provider_post_name`.
- [ ] Run `node --test src/services/postList.test.js` and confirm the new assertion fails for the missing helper.
- [ ] Add the minimal helper and use it in both publishing implementations and the posts-list response.
- [ ] Re-run the focused API tests and confirm they pass.

### Task 2: Historical URL backfill

**Files:**
- Create: `apps/api/src/services/googlePostUrlBackfill.js`
- Create: `apps/api/src/services/googlePostUrlBackfill.test.js`
- Create: `apps/api/src/scripts/backfill.google-post-urls.js`
- Modify: `apps/api/src/integrations/google.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `backfillGooglePostUrls({ posts, locations, integrations, ensureToken, listPosts, getPost, apply }) -> summary`.
- Produces: `getLocalPost(access, postName)` Google integration method.

- [ ] Write failing tests for dry-run, paginated list matching, exact-name fallback, missing `searchUrl`, idempotent candidate selection, and compact failure counts.
- [ ] Run the focused Node test and verify failures are caused by the absent service.
- [ ] Implement the dependency-injected service and Google `getLocalPost` adapter.
- [ ] Add a startup-env-aware CLI that defaults to dry-run, accepts `--apply`, prints only the compact summary, and always closes MongoDB.
- [ ] Add the test to the API test script and run focused tests until green.

### Task 3: New UI public-link action

**Files:**
- Modify: `apps/client/src/pages/private/Posts.jsx`
- Create: `apps/client/src/utils/providerPostUrl.js`
- Create: `apps/client/src/utils/providerPostUrl.test.js`

**Interfaces:**
- Consumes: `provider_post_url` from the posts response.
- Produces: `openProviderPost(url, openWindow)` that accepts only an HTTPS URL and opens with `_blank,noopener,noreferrer`.

- [ ] Write a failing utility test covering valid HTTPS navigation and missing/unsafe URLs.
- [ ] Run the focused client test and verify it fails because the utility is absent.
- [ ] Implement the utility and connect the provider reference action without changing `ActionButton`.
- [ ] Re-run focused and full client tests, lint the changed client files, and build the client.

### Task 4: Cross-application verification

**Files:**
- Verify all files above and update documentation only if behavior differs from the approved spec.

- [ ] Run focused backfill and post-list API tests.
- [ ] Run the complete API suite and report any pre-existing platform failures separately.
- [ ] Run complete client tests, lint, and production build.
- [ ] Run `git diff --check` and review the final diff for tenancy, token, URL, and unrelated-change leakage.
