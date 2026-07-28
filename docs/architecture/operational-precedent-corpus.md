# Operational precedent corpus

DPF grounds physical operational twins in current, official incumbent product
evidence before designing the interaction. The source of truth is
[`operational-precedents.csv`](../../apps/web/data/design-intelligence/operational-precedents.csv);
this page explains the contract without copying its evidence.

The corpus is part of the existing design-intelligence data plane. Coworkers can
query it with `search_design_intelligence(domain="precedent")`, while application
and planning code can use `getOperationalPrecedents({ archetypeId, spaceKind,
operatorJob })`.

Every row records:

- the pack, archetype, space, and operator job it grounds;
- the product and an official source URL;
- access and recheck dates;
- information hierarchy, spatial grammar, state vocabulary, and conflict
  behavior;
- a complete list/table accessibility alternative; and
- a DPF `adopt`, `adapt`, or `reject` decision with rationale.

`Incumbent Provider Name` is populated only when the product already has a
canonical identity in the vertical-incumbents manifest. The typed loader
validates that provider and archetype link and fails loudly if it drifts. An
empty value means “not registered in that manifest”; it does not create a second
vendor catalog.

Physical-twin pull requests must pair normal design-grounding evidence with
`Operational-Precedent: <pack-id>`. When research finds no incumbent spatial
workflow, use `Operational-Precedent: no-precedent (<researched reason>)`. The
design-grounding gate enforces both forms.

## Cross-view archetype contracts

`deriveArchetypeBusinessViews` is the pure bridge from an archetype to its
Operations grammar and bounded Performance pack. Operations reuses the
canonical `TwinProfile` and supplies the scene adapter, selector, commands,
conflicts, and a complete list/table alternative. Performance packs contain
metric keys grouped as headline, operating, financial, customer, and workforce.

Each key resolves through `PERFORMANCE_METRIC_DEFINITIONS`; a definition names
its domain source owner, grain, aggregation, comparison, sensitivity, and
optional operational drill-down. Renderers must not synthesize zeroes or
redefine formulas. The six priority physical packs are keyed by archetype ID
and also record their twin template, physical space kind, and operator job.
`independent-hotel` is deliberately present as a forward contract even though
that archetype is not yet part of the seeded catalog.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
  - `docs/superpowers/plans/2026-07-28-business-operations-and-performance-views-plan.md`
- Current code substrate reviewed:
  - `apps/web/lib/design-intelligence.ts`
  - `packages/storefront-templates/src/twin-profile.ts`
  - `packages/db/src/portfolio-sources/vertical-incumbents-manifest.ts`
- Source of truth:
  - `apps/web/data/design-intelligence/operational-precedents.csv`
- Decision:
  - extend design intelligence and the existing derive-with-override storefront
    family; do not create another vendor or archetype catalog.

Operational-Precedent: restaurant-floor
