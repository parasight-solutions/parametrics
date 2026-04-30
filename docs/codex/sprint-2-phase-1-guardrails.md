# Sprint 2 / Phase 1 Guardrails

These guardrails apply to ParaMetrics Phase 1 / Sprint 2 work.

## State

Sprint 1 / Phase 0 stabilization is complete. The proof pack is recorded in `docs/proof/sprint-1-phase-0-proof-pack.md`.

ParaMetrics remains a Google Business Profile first operations app. The target product direction is still a multi-tenant, multi-channel SaaS, but Phase 2 integrations remain blocked until the Phase 1 foundation is intentionally built and verified.

## Active Priority

Phase 1 / Sprint 2 starts with report service MVP work, then workspace/member foundation work.

Current Sprint 2 task:

- S2-01 report service abstraction in progress: create pure backend report run metadata helpers for dashboard snapshot inputs.

Near follow-up tasks:

- S2-02 PDF export.
- S2-03 XLSX export.
- S2-04 report/report_runs persistence.

## Explicit Boundaries

Do not start Phase 2 integrations. Do not add new providers, new channels, dashboard builder work, billing, entitlement checks, or multi-channel metrics as part of Sprint 2 report foundation tasks.

S2-01 must not generate PDF or XLSX files, persist report records, add report queues/workers, send emails, schedule recurring reports, or expose a public reports API.

Report persistence, PDF output, and XLSX output are separate follow-up tasks. S2-01 should keep the service pure and testable so those tasks can build on a stable metadata contract.

Existing GBP dashboard behavior must not change during S2-01.
