---
title: Native cohesion over interfacing
pageKind: principle
status: published
abstract: Prefer building a capability natively into the cohesive platform over interfacing to a separate product. Interfacing is a supported bridge — migration, or the customer's own regulated accounts — not the end state. Native cohesion enables the whole (one data model, one lifecycle, AI acting across everything) and replaces the fragmented stack where possible.
principleTier: core
principleDirection: Prefer building the capability natively into the unified platform over interfacing to a separate tool; replace what is separate where possible.
principleDimensionVector: {"long_term_maintainability": 1.0, "vendor_lock_in": -0.9, "operational_independence": 0.8, "schema_grounding": 0.7, "reusability": 0.6, "human_cognitive_load": -0.5, "speed_to_value": -0.5}
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
  - stances/dont-integrate-ea-platform
  - stances/digital-product-is-the-unit-of-organization
  - stances/persistent-product-teams-over-projects
---

## Rule

When a capability is needed, build it **natively into the unified platform** rather than interfacing to a separate product. Interfacing is a supported bridge — for migration, or for the customer's own regulated accounts (the conduit) — but the goal is native cohesion that enables the whole and **replaces what is separate where possible**.

This is the capability/product-layer sibling of `[[principles/one-data-model]]`: that principle says do not run two systems of record over the same *data*; this one says do not delegate a *capability* to a separate product when it can be built into the whole.

## Why

The rationale is the founder's, distilled from four positions (see Sources):

- **Product-centricity.** A business runs on durable, value-focused digital products with persistent ownership and one data model — not a stack of project-, app-, or vendor-scoped silos glued together. Fragmented tools mirror and perpetuate fragmented organizations; cohesion is the antidote.
- **Integration drifts.** Interfacing two systems progresses Independent → Honeymoon → Ugly Reckoning: chicken-vs-egg ownership, scope creep, semantic mismatch, perpetual reconciliation. Data quality collapses and people stop trusting the model. (`[[principles/one-data-model]]` is the data-layer statement of this; here it applies to whole capabilities.)
- **Agentic AI moves the destination.** Reporting and integration were stepping stones to *human* insight. Agentic AI acts on the unified model directly — detect → recommend → execute. An agent can only act on the whole if the whole lives in one cohesive system; interfacing to a separate product hides half the picture from the AI.
- **The moat is the loop, not any one feature.** One system where operations, financials, inventory, and AI share one model lets the agent reason and act across the whole chain — for field service: job → part used → warranty → invoice → payment → reorder. No integration of separate products can do that. That cohesion is the reason to replace QuickBooks (native accounting), the dispatch tool, and the inventory tool with one platform — even when each incumbent is individually mature.

## Applies To

In-platform coworkers, external coding agents, and human operators. When a capability is needed, the default is **build it natively**, not interface to a separate product. Coworkers and agents must not reach for an integration when a native capability can be built or already exists, and must not propose "mark it done by syncing to the incumbent" as a shortcut.

## How To Apply

Surface the "build native vs. interface to an existing tool" choice explicitly and **default to native**. Interfacing is justified only as:

1. a **migration bridge** — import from the incumbent, optionally sync during transition, then cut over to native; or
2. a **conduit for regulated money-movement / the customer's own accounts** — payroll, banking, tax filing where DPF must not become the partner-of-record (see `dpf-as-integration-conduit`).

Close functionality gaps natively rather than permanently delegating them. Name what is being replaced.

## Decision Dimensions

- `long_term_maintainability: 1.0` — native cohesion compounds; integrations decay. The strongest pull.
- `vendor_lock_in: -0.9` — interfacing binds you to the separate product; native frees you.
- `operational_independence: 0.8` — own the capability end to end, on your own runtime and model.
- `schema_grounding: 0.7` — one model, one vocabulary; integration guarantees semantic mismatch.
- `reusability: 0.6` — a native capability serves the whole platform, not just one seam.
- `human_cognitive_load: -0.5` — one system, one mental model, one trust posture.
- `speed_to_value: -0.5` — native build is slower up front than wiring a tool; the principle accepts that cost.

## Examples

- **Positive:** DPF builds native double-entry accounting to replace QuickBooks. The warranty-classified field invoice posts to DPF's own ledger; the AI sees job → part → warranty → invoice → payment in one model and acts on it. QuickBooks is reduced to a one-time import.
- **Counterexample:** "Keep QuickBooks as the system of record and sync invoices to it." Two systems, perpetual sync, the AI blind to the accounting side, the customer still paying for and trusting QuickBooks. The cohesion moat never materialises.

## When this does not apply

- **Migration bridges** — interface to the incumbent to import data and ease the switch, then cut over.
- **Regulated money-movement / the customer's own accounts** — payroll, banking, tax filing where DPF is a conduit (the customer brings their own account), not the partner-of-record. Here interfacing is correct.
- **Genuinely specialist domains the platform will not cover**, where the integration cost is justified — the bar is high; see `[[principles/one-data-model]]`.

## Sources

- Mark Bodman, [Why Product-Centricity Within [EA] is Critical](https://www.linkedin.com/pulse/why-product-centricity-within-critical-mark-bodman-dbhfc) — the product as the unit of value; unified data model; visibility across the lifecycle.
- Mark Bodman, [Think Twice When Integrating Your EA Platform](https://www.linkedin.com/pulse/think-twice-when-integrating-your-ea-platform-mark-bodman/) — integration's Independent → Honeymoon → Ugly Reckoning; native consolidation avoids the four recurring challenges.
- Mark Bodman, [Reporting [is] No Longer Relevant in the Age of Agentic AI](https://www.linkedin.com/pulse/reporting-longer-relevant-age-agentic-ai-mark-bodman-llrjc) — reporting/integration were stepping stones; agentic AI acts on the unified model directly.
- Mark Bodman, [Why a Product-Centric Approach is Needed](https://www.linkedin.com/pulse/why-product-centric-approach-need-mark-bodman-bkc8c) — continuous value, persistent ownership, integrated value-stream tooling over fragmented silos.

## See also

- Data-layer sibling: `[[principles/one-data-model]]`
- `[[principles/ship-real-functionality]]`, `[[principles/single-source-of-truth]]`, `[[principles/specialization-over-generalization]]`
- Stances: `[[stances/dont-integrate-ea-platform]]`, `[[stances/digital-product-is-the-unit-of-organization]]`, `[[stances/persistent-product-teams-over-projects]]`
- Applied: `[[2026-06-14-native-financial-management-strategy]]` (the QuickBooks-equivalent build that this principle mandates)
