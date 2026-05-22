---
title: Audit Existing Schema Before Adding Large Features
pageKind: principle
status: published
abstract: Before adding a large feature, audit the existing schema for refactoring opportunities. Reuse beats parallel.
principleTier: core
principleDirection: Audit the existing schema first; refactor a shared concept before bolting on a parallel one.
principleDimensionVector: {"long_term_maintainability": 0.8, "schema_grounding": 0.7, "reusability": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: route-domain-specific
principleConsumerContexts:
  - data-model
principlePublic: true
principlePublicRationale: Documents DPF's schema discipline — the platform actively refactors instead of accreting parallel models.
sources:
  - frameworks/csdm
---

## Rule

Before adding any large feature, audit the existing schema for refactoring opportunities. Indicators that refactoring is needed: a domain model being reused as a shared concept; the same logical data appearing in two or more existing models; a new feature needing meta-data with no canonical home.

## Why

Schemas accrete. Each new feature that bolts on a parallel model instead of refactoring an existing one adds duplication, divergent validation, and inconsistent indexing — all of which compound across the codebase. The audit step costs an hour upfront and saves weeks later when the third feature that needs the same shared concept finally forces a refactor against five different parallel implementations. Catching the refactor signal early — "this is the same thing as that other model" — keeps the schema lean and the agents reasoning about it consistent.

## Applies To

In-platform coworkers proposing schema changes, external coding agents writing migrations, and humans authoring data-model specs. Symmetric. Applies to Prisma models, derived projections (Neo4j, Qdrant payloads), and shared TypeScript types.

## How To Apply

Before adding a new model, search the existing schema for the same conceptual entity under a different name. Search for the same field shape in other models. Ask: does this belong as a column on an existing model, as a polymorphic alias, as a derived projection, or genuinely as its own table? Default to extension; reach for "new parallel table" only when extension would compromise the existing model. The Principal convergence work (after 2026-05-09) is the canonical example of this principle being cashed in: parallel identity tables (`User`, `CustomerContact`, `Agent`, `EdgeNode`, `MobileDevice`, `ServiceAccount`) converge to `Principal` + `PrincipalAlias` instead.

## Decision Dimensions

- `long_term_maintainability: 0.8` — schema convergence pays back over years; parallel models compound debt.
- `schema_grounding: 0.7` — keeping one canonical model per concept IS the schema discipline.
- `reusability: 0.5` — features built on the shared model compose with each other; features built on parallel models don't.

## Examples

- **Positive:** EP-WIKI-001 absorbed `KnowledgeArticle` into `WikiPage` instead of shipping both. The audit revealed the underlying domain was the same; the convergent model has one source of truth, one revision chain, one retrieval surface.
- **Counterexample:** A hypothetical world where `PrincipleEntry` shipped as a new table parallel to `WikiPage` because "principles are different." Two retrieval surfaces, two lint pipelines, two seed paths — three months later someone has to converge them anyway, by then with twice the call sites to update.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
