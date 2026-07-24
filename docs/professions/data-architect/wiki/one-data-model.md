---
title: One data model, not two integrated
pageKind: principle
status: published
abstract: Prefer one canonical data model over two integrated systems of record claiming authority over the same entities. The integration progresses Independent → Honeymoon → Ugly Reckoning; consolidation pays back the depth you lose many times over.
principleTier: core
principleDirection: Prefer one canonical data model over two integrated systems of record over the same entities.
principleDimensionVector: {"long_term_maintainability": 1.0, "schema_grounding": 0.9, "human_cognitive_load": -0.5, "speed_to_value": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-3-archetype
  - ring-4-sandbox-prod
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - articles/think-twice-ea-platform-servicenow
  - articles/sibling-portfolios
---

## Rule

When two systems would claim authority over the same entities, consolidate onto one canonical data model rather than integrating both.

## Why

The integration pattern is structural, not technological. With two systems of record, reconciliation requires either a third authoritative source nobody can afford or a one-way master-slave relationship one team must accept losing. Both options usually fail to ship, and the integration limps along producing increasingly stale views.

The lifecycle is predictable: **Independent** (both work fine on their own terms) → **Honeymoon** (integration ships; first six months look great) → **Ugly Reckoning** (scope creep, semantic mismatches, chicken-vs-egg ownership, reconciliation drift). Data quality collapses. People stop trusting the model.

Consolidation accepts a known cost — typically 10–20% of specialist feature depth — in exchange for never running the integration. The maths almost always favour consolidation: you lose depth you'd use occasionally and gain reliability you'd use every day.

The same logic produced the APM/SPM merge into Digital Portfolio Management: two portfolios that share the same dependency map belong in one house on a shared CMDB, not in separate tools glued together.

## Applies To

In-platform coworkers, external coding agents, and human operators. Coworkers and agents must avoid creating parallel systems of record (a second graph, a side cache, an export-then-recompute) when a canonical one already exists. Humans must resist the "we'll integrate them later" pattern when choosing between best-of-breed point tools and a consolidated platform.

## How To Apply

When you spot two systems being asked to own the same entity (application, service, CI, portfolio item), surface the consolidation question explicitly. Name the alternatives: consolidate on one, accept the specialist gap on the other, or commit to running the integration with full reconciliation discipline. Prefer the first. If you must integrate, design the master-slave contract before shipping, not after.

## Decision Dimensions

- `long_term_maintainability: 1.0` — the strongest pull. Two-system integrations decay; one-system consolidations compound.
- `schema_grounding: 0.9` — one model = one schema, one vocabulary, one set of relationships. Two models guarantee semantic mismatches.
- `human_cognitive_load: -0.5` — pulls toward options that reduce cognitive load on operators. Two systems mean two mental models, two query languages, two trust postures.
- `speed_to_value: -0.4` — modest concession. Consolidation is slower up front than running two tools that "already work." The principle accepts that cost.

## Examples

- **Positive:** A team inherits a deployment with a dedicated EA tool integrated to the CMDB. Reconciliation has drifted; the EA model says one thing, operations says another. Rather than fix the integration for the third time, the team migrates the high-value EA artefacts onto the CMDB's data model and retires the integration. Trust returns within a quarter.
- **Counterexample:** A "we'll keep the existing EA tool as the source for application data, and ServiceNow as the source for everything else" decision is made to avoid migration cost. Twelve months later, neither team trusts the application data, both teams blame the integration, and the depth advantage of the specialist tool went unused because nobody trusts the joined view.

## When this does not apply

- Pure modelling work that doesn't need to flow into operations — academic EA exercises, future-state target architectures with no current-state tie-in.
- Specialist domains the consolidation target genuinely doesn't cover (some industry-specific EA tools have capability ServiceNow lacks; those *might* justify the integration cost, but the bar is high).

## See also

- Originating stance: `[[stances/dont-integrate-ea-platform]]` (includes the ServiceNow-employment conflict-of-interest disclosure)
- Sibling stance: `[[stances/trust-the-cmdb-or-rebuild-it]]` — consolidation only works if the surviving spine is trustworthy.
- Heuristic: `[[heuristics/reuse-the-camera-in-your-pocket]]` — the trade-off in concrete form.
- Sibling principle: `[[principles/trust-the-data-spine]]`
- Entity: `[[entities/csdm]]`
- Entity: `[[entities/portfolio]]`
