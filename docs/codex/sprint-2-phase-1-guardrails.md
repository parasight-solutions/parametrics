# Sprint 2 / Phase 1 Guardrails

These guardrails apply to ParaMetrics Phase 1 / Sprint 2 work.

## State

Sprint 1 / Phase 0 stabilization is complete. The proof pack is recorded in `docs/proof/sprint-1-phase-0-proof-pack.md`.

ParaMetrics remains a Google Business Profile first operations app. The target product direction is still a multi-tenant, multi-channel SaaS, but Phase 2 integrations remain blocked until the Phase 1 foundation is intentionally built and verified.

## Active Priority

Phase 1 / Sprint 2 starts with report service MVP work, then workspace/member foundation work.

Current Sprint 2 task:

- S2-01 report service abstraction complete: pure backend report run metadata helpers for dashboard snapshot inputs are in place.
- S2-02 PDF output generation complete: minimal backend PDF buffers from S2-01 report run metadata are in place without routes, persistence, queues, or frontend changes.
- S2-03 XLSX output generation complete: minimal backend XLSX buffers from S2-01 report run metadata are in place without routes, persistence, queues, or frontend changes.
- S2-04 report/report_runs persistence complete: report definitions and report run lifecycle metadata persistence are in place without routes, queues, scheduler changes, or frontend wiring.
- S2-04.1 report index verification complete: configured MongoDB index creation for `reports` and `report_runs` was verified before adding report routes.
- S2-05 authenticated dashboard snapshot report route complete: existing report metadata, PDF/XLSX output, persistence, auth, rate-limit, and audit services are wired without queues, scheduler changes, frontend wiring, or file storage.
- S2-05.1 authenticated report route smoke complete: live API smoke verified HTTP 200, PDF/XLSX base64 response, metadata-only `report_runs` persistence, and audit success logging.
- S2-06 frontend dashboard report action complete: the GBP dashboard calls the authenticated backend dashboard snapshot report route and downloads returned PDF/XLSX base64 files without storing generated file content.
- S2-06.1 frontend report browser smoke complete: browser verification passed against the running API, including downloads, metadata-only `report_runs` persistence, and audit success logging.
- S2-07 workspace/member foundation audit and design complete: existing org/user/client/location ownership is documented before any workspace/member implementation.
- S2-07.1 local dev port coordination and app-shell cleanup complete: deterministic local API/web port preparation and a cleaner global header/page-action split are in place without workspace/member runtime changes or Phase 2 integrations.
- S2-08 organization_members indexes and owner seed migration complete: membership collection indexes and a dry-run-first owner membership seed migration were added without route authorization changes.
- S2-08.1 organization_members owner seed migration apply complete: safe owner memberships were applied and verified against live Mongo with summarized counts only.
- S2-09 organization access helpers complete: membership-aware helper functions were added without route authorization changes, RBAC middleware, auth/JWT changes, frontend UI, or Phase 2 integrations.
- S2-10 org/report membership authorization complete: low-blast-radius org/report route checks are in place while auth/JWT behavior, frontend UI, member APIs, and Phase 2 integrations remain unchanged.
- S2-10.1 location-bound GBP membership authorization in progress: current GBP location-bound operations are being protected after existing owned-location and canonical scope checks, without changing Google provider auth, app JWT middleware, frontend workspace/member UI, member APIs, billing, or Phase 2 integrations.

Near follow-up tasks:

- Report queue/worker/storage/history UI wiring only after the persistence and runtime boundaries are intentionally designed.
- Workspace/member implementation only after the S2-07 audit/design is verified.

## Explicit Boundaries

Do not start Phase 2 integrations. Do not add new providers, new channels, dashboard builder work, billing, entitlement checks, or multi-channel metrics as part of Sprint 2 report foundation tasks.

S2-01 must not generate PDF or XLSX files, persist report records, add report queues/workers, send emails, schedule recurring reports, or expose a public reports API.

S2-02 may generate in-memory PDF buffers only. It must not write files by default, persist report records, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, generate XLSX, or modify frontend export behavior.

S2-03 may generate in-memory XLSX buffers only. It must not write files by default, persist report records, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, modify PDF behavior, or modify frontend export behavior.

S2-04 may add Mongo `reports` and `report_runs` persistence for definitions and lifecycle metadata only. It must not store generated PDF/XLSX buffers, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, modify PDF/XLSX generation behavior, or modify frontend export behavior.

S2-05 may add an authenticated synchronous dashboard snapshot generation route. It must not add report queues/workers, send emails, schedule recurring reports, add file/cloud storage, expose unauthenticated report access, modify frontend export behavior, or start Phase 2 provider/channel work.

S2-06 may add frontend wiring to the existing authenticated dashboard snapshot report route. It must not add backend routes, alter backend generation behavior, add queues/workers, add scheduler changes, add email, add file/cloud storage, add report history UI, remove existing client-side exports without explicit justification, or start Phase 2 provider/channel work.

S2-07 may audit and design the workspace/member foundation only. It must not implement workspace/member APIs, modify auth behavior, modify tenancy/ownership behavior, add RBAC middleware, add frontend workspace/member UI, add billing/entitlements, add migrations, or start Phase 2 provider/channel work. Do not implement workspace/member runtime changes before the S2-07 audit/design is verified.

S2-07.1 may add deterministic local API/web port preparation, generated ignored local env files, docs for local runtime commands, and a restrained app-shell/header cleanup. It must not add workspace/member runtime behavior, change backend business logic beyond local dev env loading/port coordination, remove existing GBP dashboard/report/export/post/review/recurrence functionality, add fake routes, or start Phase 2 integrations.

S2-08 may create `organization_members` indexes and a safe migration that seeds owner memberships from existing `orgs.owner_user_id || orgs.user_id`. S2-08 creates membership data only. It must not change auth/JWT behavior, route authorization behavior, frontend workspace/member UI, RBAC middleware, billing/entitlements, Phase 2 providers, imported Google location binding, `location_org_map` canonicality, or org ownership fields.

S2-09 may add membership-aware organization access helpers and pure tests only. It must not wire those helpers into existing routes, change route authorization behavior, replace current user-owned guards, add RBAC middleware, change JWT/auth behavior, add workspace/member APIs or frontend UI, change Google location binding behavior, make `location_org_map` canonical, or start Phase 2 integrations.

S2-10 is complete. It applied membership-aware checks to low-blast-radius organization and report routes only. It did not modify locations, posts, reviews, recurrence, Google integration routes, provider auth behavior, JWT/auth middleware behavior, frontend workspace/member UI, member-management APIs, invite APIs, billing/entitlements, Phase 2 providers, report PDF/XLSX generation behavior, Google location binding behavior, or `location_org_map` canonicality.

S2-10.1 may apply membership-aware checks to current GBP location-bound operations after existing owned-location and canonical location scope resolution. It must preserve stale/unowned location 404 behavior, provider reauth behavior, app JWT/auth middleware behavior, unbound imported-location fail-closed behavior, report PDF/XLSX generation behavior, Google OAuth/import behavior, and `location_org_map` legacy-only status. It must not add frontend workspace/member UI, member-management APIs, invite APIs, billing/entitlements, queues/workers/scheduler changes, Phase 2 providers, multi-channel metrics, automatic Google location binding, or destructive scripts.

Report services should stay testable so later route, queue, worker, scheduler, and frontend tasks can build on a stable metadata contract.

Existing GBP dashboard behavior must not change during S2-01, S2-02, S2-03, S2-04, or S2-05.
