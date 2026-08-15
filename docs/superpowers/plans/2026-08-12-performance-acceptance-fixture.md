# Governed Performance Acceptance Fixture

Backlog coverage: `BI-721DE20F` · Work capsule: `WC-5D2111A2`

## Objective

Make populated `/performance` acceptance repeatable without fabricating production state. Extend the existing restaurant demo path with deterministic metric history and a watched-analysis example owned by the authenticated user's current organization.

## Existing substrate

- `demo-business-load` and the restaurant demo-floor loader own demo identity and reversible `demo-` references.
- `BusinessMetricRollup` is the canonical metric-history projection.
- `ScheduledAgentTask` with `business-analysis-watch` is the canonical watched-analysis projection.
- The existing Performance read model owns owner-brief language, comparison, evidence limits, and the oldest metric watermark.

No new model, route, scheduler, metric catalogue, or dashboard is justified.

## Delivery plan

1. Define failing contracts for idempotency, populated current/prior periods, oldest-watermark evidence, material-change watch state, and pre-write tenant/demo refusal.
2. Add a source-owned seed function that verifies exact organization, restaurant storefront, demo reference, and owner current-org context before upserting canonical projections.
3. Add an explicit operator command that resolves organization scope from the named seeded owner; never accept a free-form organization override.
4. Document safe use and the populated live acceptance assertions.
5. Run focused tests, typecheck/build checks, architecture and UX-fit review, exact semantic review, one governed pregate, and the governed release path.

## Architecture and UX constraints

- All writes are idempotent and scoped to the verified demo organization.
- The fixture labels its lineage and upserts the canonical restaurant metric identity; it never creates a competing projection or claims unavailable sales or labor evidence.
- Different current metric watermarks exercise aggregate freshness as the oldest watermark.
- The scheduled watch contains a validated accepted plan and deterministic material-change evidence.
- No UI is added: the fixture exercises the existing owner-first Performance and watched-analysis surfaces.
