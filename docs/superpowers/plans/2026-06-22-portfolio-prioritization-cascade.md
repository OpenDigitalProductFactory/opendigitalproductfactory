# Portfolio Budgets, Per-Portfolio Prioritization & Dependency Cascade — Plan

| Field | Value |
|-------|-------|
| **Date** | 2026-06-22 |
| **Author** | Claude (Opus 4.8) with founder (Mark Bodman) |
| **Epic** | EP-BOM-WIRING (extends the 2026-06-07 BOM-wiring spec §7/§12.3 + the just-shipped portfolio-coverage projection) |
| **Items** | BI-PORTPRIO-1..4 (this plan) under BI-30EE393B (the governed Phase-4 dispatcher), reusing EP-LIFECYCLE gap→backlog |

## Why

The portfolio-coverage work populated the four portfolios (DigitalProduct entries) from every substrate. The next layer is **investment**: set per-portfolio budgets, prioritize each portfolio's backlog within its envelope, and let priority **cascade from customer-sold offerings back through their dependencies** (DPPM line-of-sight). Verified gaps: backlog→portfolio is only indirect (no `portfolioId`), `Portfolio.budgetKUsd` is an inert placeholder, prioritization is a single global flat int (no WSJF/value), and — the blocker for the cascade — **product→product dependency edges are not persisted** (the registry's `depends_on_product_ids` is dropped at seed).

## Slices

1. **BI-PORTPRIO-1 — backlog→portfolio attribution.** `resolveBacklogPortfolio()` (digitalProduct→taxonomyNode→epic precedence) + denormalized `BacklogItem.portfolioId` (additive) + per-portfolio grouping read. *Enabler.*
2. **BI-PORTPRIO-2 — persist the product dependency graph (THIS PR, keystone).** New `ProductDependency` model (`relationType` depends_on|part_of, `source`), `linkProductDependency` writer (idempotent, resolves public productId→internal id, skips missing/self), registry backfill (`depends_on_product_ids`/`is_part_of_product_ids`) + platform-capability manifest `dependsOn` edges emitted by the projectors, and cycle-safe transitive traversal (`getProductDependencies` / `getProductDependents`). Wired into the seed (`productDependencyGraph` step). This is the rail the cascade runs on. The seeded graph already yields a real cascade case: `dpf-platform-standard` (Products & Services Sold) → `dpf-meta` → `infra-neo4j-core`/`infra-docker-runtime`.
3. **BI-PORTPRIO-3 — budgets as real funding envelopes.** Operator-set, persisted `Portfolio.budgetKUsd` (provenance flips demo→live) + budget-vs-allocated surfaced on the portfolio root.
4. **BI-PORTPRIO-4 — per-portfolio ranking + the cascade.** Rank backlog within each portfolio's envelope; a CASCADE pass traverses the dependency graph from sold offerings and **floors** (not overrides) the priority/criticality of their dependencies + dependency-linked backlog; explainable. Composes under BI-30EE393B (WSJF×theme / MoAR / guardrails, PAR-gated, WWWD-governed).

## Build order

1 + 2 (enablers) → 3 (envelopes) → 4 (ranking + cascade) → BI-30EE393B (governed composite engine on top).

## Substrate decisions (verified)

- **Dependency edges:** dedicated `ProductDependency` join (not EaRelationship) — the EA graph is a separate concern; the cascade wants a clean product→product traversal. Edges address products by public `productId`, resolved to the internal FK.
- **Migration:** additive new table only; generated via `prisma migrate dev` on a throwaway Postgres then trimmed to the table (the repo's schema has pre-existing finance/contract drift that `migrate dev` would otherwise fold in — out of scope).
- **No new prioritization substrate yet:** ranking/WSJF live in BI-30EE393B; this plan only adds the graph + (later) the cascade pass + envelope grouping.

## Acceptance (BI-PORTPRIO-2, this PR)

`ProductDependency` table exists; registry + platform-capability edges are persisted by the seed (idempotent); traversal returns transitive deps/dependents and is cycle-safe; unit tests green; migration applies on a fresh Postgres (CI).
