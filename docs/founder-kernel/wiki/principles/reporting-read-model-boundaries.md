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
principleConsumerArchetype: route-domain-specific
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
2. **Join on canonical ids** — document the join path in the schema audit; do not invent parallel customer/org keys in the report layer.
3. **Partial results** — when an adapter or source is unavailable, return structured partials (e.g. `raw.unsupported` / empty series + reason) so the UI can render what it has; never invent zeros that look like real metrics.
4. **Compose report-kit** — `StatusBadge`, `DataTable`, `StatCard`, charts via the shared palette; status colors through `statusColors`.

## Decision Dimensions

- `long_term_maintainability: 0.7` — one reporting composition style scales across domains.
- `schema_grounding: 0.6` — joins on canonical identity prevent parallel truth.
- `human_cognitive_load: -0.4` — partial, labeled gaps beat silent wrong numbers (cost axis: lower load is better).

## Examples

- **Positive:** Delivery/Demand board loads via a server loader that scopes by principal and maps Prisma rows through pure view models; missing estimate columns fail soft to an empty board with a warn (not a 500).
- **Counterexample:** A KPI card that imports a write-side CRM service from a client component and treats a failed channel fetch as zero revenue.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
