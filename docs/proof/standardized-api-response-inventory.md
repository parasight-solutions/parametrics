# Standardized API Response Inventory

Status: implementation inventory; update each row as its route family is migrated and verified.

Contract:

- JSON success: `{ statusCode, data, message, success: true }`.
- JSON error: `{ statusCode, message, success: false, errors: [...] }`.
- Exclusions: redirects, static files, binary/streaming bodies, CORS preflight, HTTP 204/304, and protocol-required acknowledgements.

Consumer labels:

- `client`: `apps/client` Axios services/pages.
- `web`: `apps/web` Fetch client/cache/pages.
- `external`: browser OAuth navigation or a direct download/upload caller.
- `none`: development-only or currently unmounted route; retained in the source audit.

## Mounted middleware and application responses

| Runtime source | Branches and current shape | Target/classification | Consumers | Verification |
| --- | --- | --- | --- | --- |
| `server.js:39-43` CORS/origin/body middleware | CORS preflight/body parsing; origin JSON 403 | Preflight remains bodyless; origin failure becomes canonical 403 | client, web | `validateRequestOrigin.test.js`, app HTTP tests |
| `server.js:45` `/uploads/*` | Express static bytes/404 fallthrough | Static exception; unchanged | external, post images | app/static smoke |
| `server.js:47-49` `GET /api/v1/health` | 200 `{ok,ts}` | 200 data `{ok,ts}` | deployment probes | app HTTP tests |
| `middleware/auth.js:6,50` | 401 nested `error`; 500 nested `error` | canonical 401/500; codes retained | every authenticated route | `auth.test.js` |
| `middleware/rateLimit.js:127` | 429 nested `error`, Retry-After | canonical 429 plus allowlisted retry seconds; header retained | rate-limited routes | `rateLimit.test.js` |
| `middleware/validateRequestOrigin.js:16` | 403 nested `error` | canonical 403 | unsafe API requests | `validateRequestOrigin.test.js` |
| `services/ownership.js:26` | shared nested `error` writer | delegate to canonical `sendError` | route families below | ownership/route tests |
| unknown `/api/v1/*` | Express default HTML 404 | canonical API-only 404 | client, web | app HTTP tests |
| final unexpected API error | Express/default behavior | canonical safe 500, raw error logged | client, web | app HTTP tests |

## Authentication and Google OAuth/integrations

| Method and endpoint | Current response branches | Target/classification | Consumers | Verification |
| --- | --- | --- | --- | --- |
| `POST /api/v1/auth/login` | 400/401/500 nested error; 200 `{user}` plus session cookie | canonical errors; 200 data `{user}`; cookie unchanged | client, web | `routes/auth.test.js`, login helpers |
| `GET /api/v1/auth/session` | 401 middleware; 200 `{user}`; 500 nested error | canonical JSON with data `{user}` | client, web | `routes/auth.test.js`, auth state tests |
| `POST /api/v1/auth/logout` | clears/revokes cookie; 204 empty | bodyless exception; unchanged | client, web | `routes/auth.test.js` |
| `GET /api/v1/auth/google/start` | 500 JSON config error or Google redirect | canonical 500 JSON; redirect exception unchanged | external browser | auth Google route/app tests |
| `GET /api/v1/auth/google/callback` | 400/502/500 text errors; success redirect | text/redirect OAuth protocol branches remain transport-compatible and documented | external browser | OAuth smoke tests |
| `GET /api/v1/integrations/google/start` | 500/401 JSON; Google redirect | canonical JSON errors; redirect unchanged | client, web, external | integration tests |
| `GET /api/v1/integrations/google/callback` | four 400 text state errors; success/failure redirects | OAuth text/redirect exceptions unchanged | external browser | integration OAuth tests |
| `GET /api/v1/integrations/google/status` | 200 connected/disconnected variants; 502 error | canonical 200 data; canonical 502 | client, web | integration route tests |
| `GET /api/v1/integrations/google/connections` | 200 `{connections}` | 200 data `{connections}` | client, web | integration consumers |
| `POST /api/v1/integrations/google/connections/:id/activate` | 404/500 nested error; 200 `{ok,activeIntegrationId}` | canonical JSON | client, web | integration consumers |
| `POST /api/v1/integrations/google/disconnect` | 200 `{ok}`; 500 nested error | canonical JSON; cookie/session unaffected | client, web | integration consumers |
| `GET /api/v1/integrations/google/accounts` | cached/fresh 200 `{accounts,errors}`; 502 variants | canonical 200 data and safe 502 errors | client, web | integration consumers/cache tests |
| `GET /api/v1/integrations/google/locations` | validation errors; 200 `{locations}`; Google reauth/502 errors | canonical JSON; allowlisted Google details only | client, web | integration consumers/reauth tests |
| `POST /api/v1/integrations/google/locations/import` | validation/no-integration/provider errors; 200 `{inserted}` | canonical JSON | client, web | location import tests |
| `POST /api/v1/integrations/google/locations/reconcile` | 409 no integration; 200 result; 500 error | canonical JSON, stable codes | client, web | reconcile tests |
| `GET /api/v1/integrations/google/location-media` | 400/404/502 errors; 200 media data | canonical JSON | client, web | integration consumers |
| `GET /api/v1/integrations/google/performance` | 400/404/502 errors; 200 performance data | canonical JSON | client, web | dashboard tests |
| `GET /api/v1/integrations/google/performance-series` | validation 400s; 200 series; 409/provider/500 errors | canonical JSON; safe provider errors | client, web | `integrations.google.extras.test.js` |
| `GET /api/v1/integrations/google/reviews` | validation 400; 200 reviews; 409/500 errors | canonical JSON | legacy review paths | extras tests |
| `PUT /api/v1/integrations/google/reviews/reply` | validation 400; 200 `{reply}`; 409/500 errors | canonical JSON | legacy review paths | extras tests |
| `GET /api/v1/integrations/google/media` | validation 400; 200 `{mediaItems}`; 409/500 errors | canonical JSON | client, web | extras tests |

## Organizations, locations, and binding

| Method and endpoint | Current response branches | Target/classification | Consumers | Verification |
| --- | --- | --- | --- | --- |
| `GET /api/v1/locations` | three 200 location variants; 500 error | 200 data `{locations,activeIntegrationId}`; canonical 500 | client, web | `locations.test.js`, location consumers |
| `DELETE /api/v1/locations/:id` | 200 `{ok}` or shared errors | canonical JSON | client, web | location tests |
| `GET /api/v1/location-org` | validation 400; empty/mapped 200 variants | canonical JSON data `{map,org,binding}` | client, web | binding tests |
| `PUT /api/v1/location-org` | two validation 400s; two 404s; 200 binding result | canonical JSON | client, web | binding tests |
| `GET /api/v1/orgs` | 200 `{orgs}` or shared error | canonical JSON | client, web | `orgs.test.js` |
| `POST /api/v1/orgs` | 200 `{org}` or shared error | canonical JSON, preserve current status | client, web | `orgs.test.js` |
| `GET /api/v1/orgs/:orgId/member-candidates` | 200 `{users}` or shared error | canonical JSON | client, web | `orgs.test.js` |
| `GET /api/v1/orgs/:orgId/members` | 200 `{members}` or shared error | canonical JSON | client, web | `orgs.test.js` |
| `POST /api/v1/orgs/:orgId/members` | 200 `{member,created}` or shared error | canonical JSON | client, web | `orgs.test.js` |
| `PATCH /api/v1/orgs/:orgId/members/:memberId` | 200 `{member,updated}` or shared error | canonical JSON | client, web | `orgs.test.js` |
| `POST /api/v1/orgs/:orgId/members/:memberId/disable` | 200 `{member,disabled}` or shared error | canonical JSON | client, web | `orgs.test.js` |
| `POST /api/v1/orgs/bind-location` | validation 400; not-found 404; 200 binding | canonical JSON | client, web | `orgs.test.js` |

## Posts, recurrence, reviews, reports, and uploads

| Method and endpoint | Current response branches | Target/classification | Consumers | Verification |
| --- | --- | --- | --- | --- |
| `GET /api/v1/posts` | 200 paginated post result; shared validation/access errors | 200 data keeps pagination object | client, web | `postList.test.js`, page tests |
| `GET /api/v1/posts/provider` | 400/409 errors; 200 provider posts | canonical JSON | client, web | provider tests |
| `POST /api/v1/posts/sync` | 200 raw sync result; shared errors | 200 data sync result | client, web | `manualPostSync.test.js` |
| `GET /api/v1/posts/:id` | 200 `{post}`; shared errors | canonical JSON | client, web | `postDetails.test.js` |
| `POST /api/v1/posts` | validation 400; binding/integration/account 409; image 400/413; unexpected/shared errors; 200 `{post}` | canonical JSON, preserve multipart parsing/image cleanup and current statuses | client, web | image/publish/route tests |
| `PATCH /api/v1/posts/:id` | 404; publishing/published 409; schedule 400; 200 `{post}`; shared errors | canonical JSON | client, web | post lifecycle/page tests |
| `POST /api/v1/posts/:id/retry` | 404/409 branches; 200 `{ok}`; shared errors | canonical JSON | client, web | post lifecycle/page tests |
| `DELETE /api/v1/posts/:id` | conflict/reconciliation errors; 200 deletion result | canonical JSON; Google-first/tombstone lifecycle unchanged | client, web | deletion suites/UI tests |
| `GET /api/v1/recurrence` | 400; 200 `{rule}` | canonical JSON | web | recurrence tests/pages |
| `PUT /api/v1/recurrence` | validation 400 branches; 200 `{rule}` | canonical JSON | web | recurrence tests/pages |
| `GET /api/v1/recurrence/posts` | 400; 200 `{posts}` | canonical JSON | web | recurrence tests/pages |
| `POST /api/v1/recurrence/plan-now` | 400/404; 200 `{ok,...}` | canonical JSON | web | recurrence tests/pages |
| `GET /api/v1/reviews` | 400; 200 `{reviews,sync}` | canonical JSON | client, web | review page tests |
| `POST /api/v1/reviews/sync` | 400/409; immediate 200 result or queued 200 `{queued,jobId,since}` | canonical JSON; queue behavior unchanged | client, web | review sync tests |
| `PUT /api/v1/reviews/:id/reply` | 400/404/409; 200 `{ok}` | canonical JSON | client, web | review reply tests |
| `GET /api/v1/reports/runs` | 200 list result or shared errors | canonical JSON metadata | client, web | `reports.test.js` |
| `POST /api/v1/reports/dashboard-snapshot` | 200 report generation result or shared errors | canonical JSON metadata | client, web | `reports.test.js` |
| `GET /api/v1/reports/runs/:runId/outputs/:format` | success 200 raw buffer with download headers; JSON error branches | binary success exception; errors canonical | direct Fetch/Axios download | `reports.test.js`, download tests |
| `POST /api/v1/uploads` | 400 missing/upload error; 200 saved metadata | canonical JSON; multipart/file behavior unchanged | client, web | upload/image tests |

## Debug, standalone, and non-runtime sources

| Source | Runtime status/current branches | Target/classification | Consumers | Verification |
| --- | --- | --- | --- | --- |
| `GET /api/v1/debug/google/access` | mounted; 200 success or provider diagnostic body | canonical JSON with provider bodies/tokens removed | development only | debug smoke |
| `POST /api/v1/debug/google/clear` | mounted; 200 `{ok,deleted}` | canonical JSON | development only | debug smoke |
| `GET /api/v1/debug/google` from `debug.google.js` | mounted; three 200 variants, currently exposes token prefix | canonical safe JSON; remove token prefix | development only | debug security test |
| `routes/health.js` | not imported/mounted; duplicate 200 health router | migrate if retained or remove only with separate approval | none (unmounted) | source audit |
| `routes/demo.js` | not imported/mounted; 400 and 200 demo branches | migrate if retained; remains unmounted | none (unmounted) | source audit |
| `server.js.bak` | backup source, not imported/executed | non-runtime evidence; do not migrate as an endpoint | none | import/mount audit |

## Line-level response-writer reconciliation

These runtime writer lines are the implementation checklist. A line may move as code is edited; mark it migrated only after its endpoint row and tests are green.

| File | Response-writer lines at inventory time |
| --- | --- |
| `server.js` | 48 |
| `services/ownership.js` | 26 |
| `middleware/auth.js` | 6, 50 |
| `middleware/rateLimit.js` | 127 |
| `middleware/validateRequestOrigin.js` | 16 |
| `routes/auth.js` | 51, 66, 84, 87, 95, 96, 99, 127 |
| `routes/auth.google.js` | 174, 182, 196, 208, 225, 255, 264 |
| `routes/integrations.google.extras.js` | 59, 68, 83, 233, 265, 268, 273, 337, 347, 357, 370, 386, 400, 408, 421, 438, 461, 470, 483, 499, 512, 517, 530 |
| `routes/integrations.google.js` | 60, 213, 223, 249, 265, 279, 288, 297, 323, 336, 352, 420, 429, 442, 463, 473, 486, 496, 519, 532, 539, 548, 577, 585, 718, 719, 723, 728, 731, 761, 764, 785, 789, 796, 801, 806, 827, 831, 843, 890, 898, 920, 979, 993, 1005, 1011, 1023, 1030, 1124, 1147, 1177, 1187, 1205 |
| `routes/locations.js` | 49, 58, 69, 72, 98 |
| `routes/locationOrg.js` | 37, 62, 75, 84, 90, 101, 112, 173 |
| `routes/orgs.js` | 65, 586, 599, 613, 626, 645, 665, 687, 707, 729, 785 |
| `routes/posts.js` | 366, 385, 399, 417, 446, 466, 485, 492, 497, 510, 525, 540, 549, 634, 695, 704, 733, 788, 821, 870, 943 |
| `routes/recurrence.js` | 54, 70, 82, 121, 124, 127, 130, 133, 136, 139, 144, 245, 260, 286, 298, 326, 339 |
| `routes/reviews.js` | 61, 83, 98, 118, 137, 180, 199, 206, 227, 232, 271 |
| `routes/reports.js` | 557, 591, 842 (binary success) |
| `routes/uploads.js` | 14, 21, 24 |
| `routes/debug.js` | 11, 13, 19 |
| `routes/debug.google.js` | 10, 12, 14 |

Unmounted writers: `routes/health.js:3` and `routes/demo.js:10,12`. Test-only response doubles and `server.js.bak` are not runtime writers.

## Completion evidence

- Starting and ending committed SHA: `ea0788bce1c0c3c4a08b54142a3b73f75e75f8d8` (all work intentionally remains uncommitted on `refactor/standardize-api-responses`).
- Backend: `npm test -w @parametrics/api` — 342/342 passed. The importable-app HTTP contract suite covers success, API 404, unexpected failure, malformed/oversized JSON, rejected async handlers, and bodyless logout.
- New client: `npm test -w client` — 38/38 passed; `npm run lint -w client` — zero errors and one existing React Hook Form compiler warning; production build passed.
- Legacy web: `npm test -w @parametrics/web -- --run` — 105/105 passed; lint clean; production build passed.
- Repository: `git diff --check` passed. Phase 3 branch remains `c3c5de1321e396e2bda8e98619637f7b802f3262`.
- Browser smoke: not run against the updated backend; no browser verification is claimed.

Final classification: application JSON uses the canonical success/error helpers. Preserved exceptions are OAuth redirects/callback text, bodyless 204 logout, and binary report downloads. Axios and Fetch consumers use full envelopes; explicit binary consumers remain direct.

Deployment coupling: the backend, new client, and legacy web are contract-coupled and must deploy atomically using immutable versioned artifacts. Avoid stale CDN HTML/assets pairing an old frontend with the new backend. Rollback must restore all three artifacts to the same prior release in one coordinated operation.
