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

Near follow-up tasks:

- Report route/queue/worker/frontend wiring only after the persistence and runtime boundaries are intentionally designed.

## Explicit Boundaries

Do not start Phase 2 integrations. Do not add new providers, new channels, dashboard builder work, billing, entitlement checks, or multi-channel metrics as part of Sprint 2 report foundation tasks.

S2-01 must not generate PDF or XLSX files, persist report records, add report queues/workers, send emails, schedule recurring reports, or expose a public reports API.

S2-02 may generate in-memory PDF buffers only. It must not write files by default, persist report records, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, generate XLSX, or modify frontend export behavior.

S2-03 may generate in-memory XLSX buffers only. It must not write files by default, persist report records, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, modify PDF behavior, or modify frontend export behavior.

S2-04 may add Mongo `reports` and `report_runs` persistence for definitions and lifecycle metadata only. It must not store generated PDF/XLSX buffers, add report queues/workers, send emails, schedule recurring reports, expose a public reports API, modify PDF/XLSX generation behavior, or modify frontend export behavior.

Report services should stay testable so later route, queue, worker, scheduler, and frontend tasks can build on a stable metadata contract.

Existing GBP dashboard behavior must not change during S2-01, S2-02, S2-03, or S2-04.
