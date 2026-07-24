---
title: Trust the data spine before anything built on it
pageKind: principle
status: published
abstract: Prefer working from a trusted, auto-populated data spine over reasoning on a model nobody trusts. An untrusted CMDB is technical debt that compounds — every dependent decision inherits the doubt.
principleTier: core
principleDirection: Prefer a trusted, auto-populated data spine (Ingestion + Insight + Governance) over reasoning on a model nobody trusts.
principleDimensionVector: {"evidence_density": 1.0, "schema_grounding": 0.8, "governance_compliance": 0.6, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-3-archetype
  - ring-4-sandbox-prod
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - frameworks/csdm
---

## Rule

Do not build decisions on a data spine you cannot trust. Either fix the spine on the three pillars (Ingestion, Insight, Governance & Health) or stop pretending it is the source of truth.

## Why

The CMDB problem isn't that the data model is hard. `[[entities/csdm]]` settled the model question — it's the canonical spine. The problem is that organisations stand up the model without standing up the three pillars, then are surprised when the CMDB stops being useful.

Every downstream decision — rationalisation, ROI, AI-assisted operations, risk reporting — inherits the spine's trustworthiness. If the spine is wrong, the answer is wrong, and the wrongness only surfaces months later when the consequences land. This is why "trust is the only quality of a CMDB that matters." A spine you cannot trust is worse than no spine, because it absorbs effort that would otherwise go into building one.

For DPF specifically, the same logic governs every retrieval and recall surface: the wiki, the memory store, the code graph, the CSDM projection. If a coworker can't trust what comes back from the retrieval layer, the agent stops grounding answers in it — and starts hallucinating against the user instead.

## Applies To

In-platform coworkers, external coding agents, and human operators. Coworkers and agents must check whether the data they're reasoning about comes from a governed, auto-populated source before treating it as authoritative. Humans must own one of the three pillars — usually Governance & Health — or the spine decays whether or not it was set up correctly originally.

## How To Apply

When you reach a decision that depends on platform state (inventory, ownership, capacity, dependencies, configuration drift): ask first whether the state was auto-populated and currently governed, or whether it was hand-entered and unowned. If the latter, surface the doubt before acting. Prefer options that build or extend the spine over options that route around it with bespoke queries, exports, or screenshots. If the spine isn't trustworthy and won't be made so, escalate before recommending decisions that depend on it.

## Decision Dimensions

- `evidence_density: 1.0` — the strongest pull. This principle is about evidence over intuition; options that produce or rely on dense, governed evidence are strictly preferred.
- `schema_grounding: 0.8` — a trusted spine is a schema-grounded one. Options that respect CSDM (or the platform's equivalent) reinforce the spine; options that invent their own shape erode it.
- `governance_compliance: 0.6` — Governance & Health is the third pillar. Options that bring an owner, a review cadence, and a triage process attached to the data are favoured.
- `speed_to_value: -0.3` — modest concession. Building the three pillars is slower than skipping them. The principle accepts that cost because the alternative is faster wrong answers.

## Examples

- **Positive:** A coworker is asked to summarise a portfolio's risk posture. It checks that the underlying CIs are auto-populated from discovery and reconciled in the last 24 hours before answering. When discovery is stale, it flags the doubt in the response instead of inventing a number.
- **Counterexample:** A team builds a custom reporting layer on top of a hand-maintained spreadsheet "because the CMDB is incomplete." Six months later the spreadsheet has diverged from reality; decisions made against it have to be unwound. The right move was to invest in the spine, not route around it.

## See also

- Originating stance: `[[stances/trust-the-cmdb-or-rebuild-it]]`
- Heuristic: `[[heuristics/auto-populate-or-its-wrong]]` — the first pillar in operational form.
- Heuristic: `[[heuristics/model-what-naturally-happens]]` — how to build the model without becoming a data-lake project.
- Entity: `[[entities/csdm]]`
- Sibling principle: `[[principles/one-data-model]]` — consolidation only works if the resulting spine is trustworthy.
