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

Near follow-up tasks:

- Report queue/worker/storage/history UI wiring only after the persistence and runtime boundaries are intentionally designed.

## Explicit Boundaries

Do not start Phase 2 integrations. Do not add new providers, new channels, dashboard builder work, billing, entitlement checks, or multi-channel metrics as part of Sprint 2 report foundation tasks.

S2-01 must not generate PDF or XLSX files, persist report records, add report queues/workers, send emails, schedule recurring reports, or expose a public reports API.

S2-02 may generate in-memory PDF buffers only. It must not write files by default, persist report records, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, generate XLSX, or modify frontend export behavior.

S2-03 may generate in-memory XLSX buffers only. It must not write files by default, persist report records, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, modify PDF behavior, or modify frontend export behavior.

S2-04 may add Mongo `reports` and `report_runs` persistence for definitions and lifecycle metadata only. It must not store generated PDF/XLSX buffers, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, modify PDF/XLSX generation behavior, or modify frontend export behavior.

S2-05 may add an authenticated synchronous dashboard snapshot generation route. It must not add report queues/workers, send emails, schedule recurring reports, add file/cloud storage, expose unauthenticated report access, modify frontend export behavior, or start Phase 2 provider/channel work.

S2-06 may add frontend wiring to the existing authenticated dashboard snapshot report route. It must not add backend routes, alter backend generation behavior, add queues/workers, add scheduler changes, add email, add file/cloud storage, add report history UI, remove existing client-side exports without explicit justification, or start Phase 2 provider/channel work.

Report services should stay testable so later route, queue, worker, scheduler, and frontend tasks can build on a stable metadata contract.

Existing GBP dashboard behavior must not change during S2-01, S2-02, S2-03, S2-04, or S2-05.
