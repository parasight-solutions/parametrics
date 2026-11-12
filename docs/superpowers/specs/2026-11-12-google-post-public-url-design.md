# Google Post Public URL Design

## Intent

Return Google's actual public post link so the UI can open a published post. `provider_post_name` remains the Google API resource identifier and is not treated as a browser URL.

## Scope

- Persist the `searchUrl` returned by Google as `provider_post_url` after every successful future publication.
- Include `provider_post_url` in the posts list response.
- Let the new Posts UI open this URL in a new tab and disable the action when it is unavailable.
- Backfill historical published posts that have a provider resource name but no URL.

## Backfill safety

- Provide a script that is dry-run by default and writes only with `--apply`.
- Group missing records by user/integration/location, refresh credentials through the existing integration service, and paginate through `localPosts.list`.
- Match records by exact `provider_post_name`; use `localPosts.get` only for unresolved names.
- Update only the matching post's missing `provider_post_url`, making repeat runs idempotent.
- Produce compact counts for candidates, matched, updated, unavailable, failed, and skipped records without logging credentials.

## Approaches considered

- Construct a URL from `provider_post_name`: rejected because the resource name is not a public URL.
- Fetch missing URLs while listing posts: rejected because it adds Google API latency, quota use, and failure modes to a normal page request.
- Persist future URLs and run a controlled historical backfill: selected because Google supplies the canonical `searchUrl` and normal reads remain local and fast.

## Constraints and non-goals

- Preserve `provider_post_name` for Google API operations.
- Do not invent a fallback URL when Google does not return `searchUrl`.
- Do not mutate posts in dry-run mode.
- No UI component internals will be changed; the existing `ActionButton` API will be used.
