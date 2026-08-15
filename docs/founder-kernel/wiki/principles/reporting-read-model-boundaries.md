---
title: Reporting and Read-Model Composition Boundaries
pageKind: principle
status: published
abstract: Analytics and reporting UX compose domain data through boundary-owned authorization, canonical identity joins, and partial-failure result contracts — not ad-hoc UI imports of write paths.
principleTier: core
principleDirection: Keep reporting as a composed read model — authorize at the boundary, join on canonical identity, fail partial not silent.
principleDimensionVector: {"long_term_maintainability": 0.7, "schema_grounding": 0.6, "human_cognitive_load": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-3-archetype
principleConsumerArchetype: universal
principleConsumerContexts:
  - reporting
  - analytics
  - ux
principlePublic: true
principlePublicRationale: Documents how DPF keeps reporting surfaces consistent, permission-safe, and resilient when adapters return partial data.
sources:
  - frameworks/csdm
---

## Rule

Reporting and analytics surfaces are **composed read models**. Permission checks live at the route/server-action boundary (or a dedicated reporting service), not scattered inside UI leaf components. Domain services may be imported by UI only when they are read-oriented and already enforce principal scope. Canonical identity joins (e.g. `Organization`, `Principal`, product/portfolio ids) are documented once; adapters and metrics aggregators return **partial-result contracts** rather than failing the whole board when one source is down.

## Why

Cross-domain reporting (engagement, outbound publication, finance rollups) mixes sources that fail independently. If the UI owns joins and auth, every screen reinvents permission checks and silent drops. Boundary-owned authorization + canonical joins + partial-failure contracts keep report-kit UX honest and agent-automatable.

## Applies To

Specs and PRs that add KPI tiles, report tables, engagement rollups, multi-adapter metrics, or mixed-source dashboards. Complements `compose-report-kit-for-reporting-ux` (component palette) and transport-vs-domain placement (routes/actions = auth/HTTP; `lib` = orchestration).

## How To Apply

1. **Authorize once** at the page/action/MCP tool boundary for the calling principal.
2. **Join on canonical ids** — document the join path in the schema audit. Normalize provider publication, thread, conversation, asset, and reply identifiers into the owning domain's canonical relationship before aggregation; never infer a join from incidental JSON metadata or invent parallel customer/org keys in the report layer.
3. **Normalize at the adapter boundary** — an adapter emits provider-neutral domain facts and an explicit capability/maturity status. Maturity is an attribute of the same capability projection, not a parallel contract. Cross-channel KPI calculation, attribution, and joins belong to a shared domain read model or reporting service, not to a provider adapter, route, or page. The [channel capability rule](../../../architecture/orientation.md#channel-adapter-capabilities) remains the source for unsupported-operation signalling.
4. **Return typed partials** — distinguish an expected no-match from an unavailable, failed, or stubbed source. Each partial identifies the source and carries an honest status and reason (for example `raw.unsupported` or an empty series plus reason); include freshness or retryability when the caller can act on it. Never invent zeros that look like real metrics.
5. **Expose degradation** — propagate source status through the read model so user-facing surfaces and operational telemetry can show which sources are partial. When a stub becomes operational, update the adapter's capability/maturity projection; callers must not need a parallel recovery path or a rewritten aggregate.
6. **Compose report-kit** — `StatusBadge`, `DataTable`, `StatCard`, charts via the shared palette; status colors through `statusColors`.

## Decision Dimensions

- `long_term_maintainability: 0.7` — one reporting composition style scales across domains.
- `schema_grounding: 0.6` — joins on canonical identity prevent parallel truth.
- `human_cognitive_load: -0.4` — partial, labeled gaps beat silent wrong numbers (cost axis: lower load is better).

## Examples

- **Positive:** A marketing performance loader authorizes once, resolves provider thread ids to canonical publications, asks adapters for normalized facts, and returns available metrics plus a labeled unavailable-source partial.
- **Positive:** Delivery/Demand board loads via a server loader that scopes by principal and maps Prisma rows through pure view models; missing estimate columns fail soft to an empty board with a warn (not a 500).
- **Counterexample:** A KPI card that imports a write-side CRM service from a client component and treats a failed channel fetch as zero revenue.

## Boundary

This principle owns reporting normalization, identity joins, aggregation placement, and partial-result propagation. It does not define provider method signatures, retry or timeout schedules, schema-migration/backfill strategy, or dashboard interaction timing; those remain explicit concerns of their owning integration, deployment, data, and UX contracts rather than being smuggled into a reporting read model.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
