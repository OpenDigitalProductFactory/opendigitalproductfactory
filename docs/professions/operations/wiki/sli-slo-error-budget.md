---
title: SLIs, SLOs, and error budgets
pageKind: principle
status: published
abstract: An SLI is a quantitative measure of service level; an SLO is a target for it; an SLA adds consequences. The error budget — the gap between the SLO target and 100% — quantifies acceptable unreliability and aligns dev and ops on one incentive.
principleTier: core
principleDirection: Define a few representative SLIs, set SLO targets, and manage releases against the resulting error budget.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.6, "capacity_utilization": 0.5}
professionCompetencyLevel: expert
sources:
  - google/sre-book-slo
  - google/sre-book-risk
---

## Rule

Measure reliability with **SLIs**, target it with **SLOs**, and govern change with the resulting **error budget**.

## The Definitions

- **SLI (Service Level Indicator)** — "a carefully defined quantitative measure of some aspect of the level of service" (e.g. request latency, error rate, availability).
- **SLO (Service Level Objective)** — a target value or range for an SLI (e.g. latency under 100 ms for 99.9% of requests).
- **SLA (Service Level Agreement)** — an SLO **plus consequences** for missing it. No consequence means it is an SLO, not an SLA.

Prefer "a handful of representative indicators" and **percentiles over averages** — an average hides the tail that users feel.

## Error Budget

The **error budget** is the gap between the SLO target and 100% — "how much unreliability is remaining." It turns reliability into a currency: while budget remains, teams can spend it on release velocity; when it is exhausted, they self-regulate toward more testing and slower releases. This aligns development and SRE on **one shared incentive** instead of a reliability-vs-features tug of war.

## How To Apply

1. **Pick few, representative SLIs** from your [[professions/operations/observability-three-signals]].
2. **Set SLO targets** users actually care about; derive the error budget.
3. **Govern releases** by remaining budget — see [[professions/operations/error-budget-toil-tradeoff]].

## See Also

- [[professions/operations/observability-three-signals]]
- [[professions/operations/error-budget-toil-tradeoff]]
