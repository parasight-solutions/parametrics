# Reviews List Filtering and Pagination Design

## Intent

Upgrade the existing Google Business Profile Reviews listing so MongoDB, not the browser, performs filtering, search, counting, sorting, and pagination. The legacy frontend will consume the authoritative server result while preserving review synchronization and provider-first reply behavior.

## Scope

- Backend changes are limited to `apps/api` review-list services, route integration, tests, and the minimum useful review index adjustment.
- Frontend changes are limited to the existing legacy Reviews page and its tests under `apps/web`.
- Documentation may be updated locally and in the canonical ParaMetrics Google Drive PRD.
- `apps/client`, Phase 3, Google OAuth, post behavior, automatic synchronization, and the reply API contract remain unchanged.
- All work remains uncommitted and unpushed.

## API contract

`GET /api/v1/reviews` continues to require an authorized `locationId` (with the existing `location_id` alias). It accepts `status=all|replied|unreplied`, `keyword`, `page`, and `perPage` (with `per_page` alias). Defaults are `all`, empty keyword, page 1, and 10 per page; `perPage` is capped at 100. Invalid types, unsupported statuses, malformed positive integers, and keywords over 200 characters return the standardized HTTP 400 envelope.

The success payload contains `reviews`, `pagination`, location-wide `counts`, and the existing `sync` metadata. Matching totals reflect status plus keyword; counts ignore both and cover the entire authorized location. Out-of-range pages return an empty list without changing the requested page or totals.

## MongoDB classification and query

No schema field or backfill is introduced. A review is replied only when `reviewReply.comment` is a BSON string whose trimmed value contains at least one Unicode code point. Missing, null, non-string, empty, and whitespace-only values are unreplied.

After `requireOwnedOrganizationLocationAccess()` succeeds, the service builds the complete scope with `buildLocationScopeFilter()` including user, organization, client, location, and provider. That scope is the first `$match` in one aggregation. A `$facet` then derives:

- filtered and deterministically sorted page rows;
- the status-and-keyword matching count;
- location-wide total, replied, and unreplied counts.

Keyword search is a case-insensitive literal regex, with metacharacters escaped, across reviewer display name/name, review comment, and business reply. Status and keyword combine with AND semantics. Rows sort by `updateTime`, `createTime`, then `_id`, all descending, and `_id` is projected out.

## Performance and indexing

The leading authorized-location match allows the existing location indexes to bound the aggregation before `$facet`, reply classification, and substring search. The deterministic listing index will include the `_id` tiebreaker. Reply classification via `$expr` and unanchored case-insensitive substring regexes are not directly indexable; this is an explicit migration-free trade-off. A persisted reply flag or search-normalization system is deferred until production volume demonstrates a need.

## Legacy frontend

The legacy page replaces client-side filtering with server query parameters. The deterministic default status is `all`; `auto` is removed because authoritative counts and explicit URL state are clearer. Page, per-page, status, and keyword are stored in the URL. Search is debounced, clearing/search/status/location/page-size changes reset the page appropriately, and Back/Forward navigation restores the list state.

Each request is guarded with an abort controller and request generation so stale location/filter/page responses cannot overwrite current state. The page renders location-wide counts separately from the matching total/range. Reply success reloads the active filters and corrects an invalid page when a replied review leaves the current result set. Sync retains queued semantics and existing metadata without aggressive polling.

## Testing and rollback

Backend unit tests cover normalization, reply classification, literal search, facets, pagination, counts, stable sorting, and empty/out-of-range results. HTTP tests cover authorization/scope, invalid input, response shape, reply classification changes, failed reply preservation, and sync metadata. Mounted legacy tests cover filtering, debounce, URL state, pagination, location races, errors, reply refresh, and queued sync behavior.

Rollback restores the prior Reviews route/page/index and removes the new service/tests. There is no data rollback because no schema or stored records change.
