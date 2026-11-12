# Post List Filtering and Pagination Design

## Intent

Move post search and status filtering from the old frontend into the posts API and add page-based pagination so both frontends can consume a bounded post list.

## Contract

`GET /api/v1/posts` accepts existing `locationId` plus optional `keyword`, `status`, `page`, and `perPage`. `page` defaults to `1`; `perPage` defaults to `10` and is capped at `100`. `status=all` means no status filter. The response keeps `posts` and adds `pagination: { page, perPage, total, totalPages }`.

Keyword matching is case-insensitive across post summary, location ID/title, provider post reference, status, and provider error. Status is an exact normalized match. Filtering occurs before counting, sorting, skipping, and limiting.

## Compatibility

The new UI remains untouched. Its existing `keyword`, `status`, `locationId`, and `showAll` request shape continues to work; unknown `showAll` is ignored while absence of `locationId` means all accessible locations. The old UI sends filters and pagination to the API, resets to page one when filters change, and renders page navigation. Existing mutation routes and the `posts` response property remain unchanged.

## Approaches

- Selected: page/per-page pagination with a Mongo count plus paged query. It matches the requested UI model and provides an exact total.
- Rejected: cursor pagination, because the current and planned pagination controls require numbered pages.
- Rejected: retaining frontend filtering, because it gives incorrect results once the API returns only one page.

## Non-goals

No changes to the new UI, post mutations, provider post listing, or report pagination.
