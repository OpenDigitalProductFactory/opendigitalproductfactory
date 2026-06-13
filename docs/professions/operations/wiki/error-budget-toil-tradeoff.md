---
title: Trade reliability against innovation via error budgets
pageKind: principle
status: published
abstract: Beyond a point, more reliability costs more than it returns. The error budget makes the reliability-vs-velocity trade-off explicit: spend remaining budget on release speed; when depleted, slow down and harden. Extreme reliability is not free.
principleTier: contextual
principleDirection: Use the error budget to govern release velocity vs hardening; do not chase 100% reliability where it is not worth the cost.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"speed_to_value": 0.6, "capacity_utilization": 0.5}
professionCompetencyLevel: expert
sources:
  - google/sre-book-risk
---

## Rule

Use the **error budget** to manage the trade-off between reliability and innovation explicitly. Beyond a point, more reliability is "worse for a service…rather than better" — extreme reliability carries real cost (slower delivery, more toil) that may exceed its user value.

## How The Trade-off Works

- While the error budget is **positive**, spend it on **release velocity** — ship features, take measured risk.
- When the budget is **depleted**, teams self-regulate toward **more testing and slower releases** until reliability recovers.

The budget tensions several levers: software hardening, test intensity, release frequency, and canary size/duration. Making these trade-offs against a shared budget — rather than by argument — is the expert SRE discipline.

## How To Apply

1. **Derive the budget** from the SLOs in [[professions/operations/sli-slo-error-budget]].
2. **Gate velocity on budget**, not on opinion.
3. **Pair with postmortems** — recurring budget burn signals systemic issues for [[professions/operations/blameless-postmortem]].

## See Also

- [[professions/operations/sli-slo-error-budget]]
- [[professions/operations/blameless-postmortem]]
