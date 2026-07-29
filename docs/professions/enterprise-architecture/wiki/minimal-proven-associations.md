---
title: Add only the associations live data proves necessary
pageKind: principle
status: published
abstract: Every relationship in a model is a permanent constraint on how the estate can change. Add an association only when live data or a named stakeholder concern requires it — and treat a structural check as insufficient evidence that it works, because a schema that compiles proves nothing about behaviour.
principleTier: core
principleDirection: Add an association only when live evidence or a named concern requires it, and treat structural verification as insufficient evidence of behaviour.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"evidence_density": 0.9, "long_term_maintainability": 0.6, "blast_radius": -0.5, "human_cognitive_load": -0.4}
professionCompetencyLevel: expert
sources:
  - iso/42010
  - opengroup/archimate-3-2
  - wikipedia/verification-validation
  - dpf/agents-rulebook
---

## Rule

Two halves, both about evidence:

- **Minimal associations.** A relationship — a foreign key, a link table, a cross-module dependency, a new coupling between layers — is added when live data or a named stakeholder concern shows it is needed. "We will probably want to traverse this later" is not that showing.
- **Structural verification is not functional verification.** That a model compiles, a migration applies, a type-check passes, or a page renders is evidence about *structure*. A claim about **behaviour** requires the behaviour to have been exercised.

A review that asserts a design works, on structural grounds alone, has overstated its evidence.

## Why

ISO/IEC/IEEE 42010 ties every element of an architecture description back to a **stakeholder concern**: views exist because concerns exist. An association with no concern behind it fails that test — it is in the model because someone anticipated a need, not because a need was demonstrated.

ArchiMate makes the cost concrete. Relationships are typed and load-bearing: they are what analysis traverses, what impact assessment follows, and what a change must preserve. A speculative relationship is therefore not free storage — it enlarges the blast radius of every future change to either end, and it will be traversed by tooling and by readers as though it meant something.

The verification half is the standard distinction between verification and validation: verification asks whether the thing was built to specification, validation whether it does the job. Structural checks are firmly on the verification side, and they are systematically over-trusted because they are the cheap ones and they go green. A schema that applies cleanly and a schema that stores the right thing are different claims, and only the first one has been tested.

Both halves fail the same way: **confident, unfalsifiable output**. A speculative association is never wrong today; an unexercised behaviour is never observed failing. Neither produces an error until something depends on it.

## How To Apply

1. **Demand the concern.** For each association in a design, name the stakeholder concern or the live query it serves. No answer means drop it — it can be added when a real traversal needs it.
2. **Prefer the narrower relation.** One-to-many before many-to-many; a direct foreign key before a link table. Widening later is additive — see [[professions/enterprise-architecture/evolve-schema-additively]]; narrowing later is a migration with data loss.
3. **Grade behavioural claims by their evidence.** In a review, separate "this compiles / is placed correctly" from "this works". Only the first can be settled by reading.
4. **Say which check you ran.** State the verification actually performed, and do not carry a structural result across into a behavioural conclusion.
5. **A relationship that exists only to serve a report is a projection**, not a model change — build the read path rather than the association.

## See Also

- [[professions/enterprise-architecture/architecture-review-verdict-thresholds]]
- [[professions/enterprise-architecture/anchor-changes-to-a-value-stream-stage]]
- [[professions/enterprise-architecture/archimate-three-layers]]
