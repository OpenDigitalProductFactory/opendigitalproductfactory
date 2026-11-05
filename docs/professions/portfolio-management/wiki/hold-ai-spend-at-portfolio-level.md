---
title: Hold AI spend at the portfolio level
pageKind: principle
status: published
abstract: AI spend is budgeted and governed at the portfolio level of structured work, set by the portfolio owner. Per-coworker or per-session caps are not budgets. A single worker's limit must never be able to stop work, least of all a mandatory platform function every change depends on.
principleTier: core
principleDirection: Budget AI spend per portfolio, owned and adjusted by the portfolio owner; attribute each call's real cost to the portfolio of the work it served; never let a worker-level cap halt work.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleDimensionVector: {"cost_efficiency": 0.8, "governance_compliance": 0.7, "speed_to_value": 0.6, "legibility_of_consequence": 0.6, "business_disruption": -0.8, "operator_effort": -0.5}
professionCompetencyLevel: practitioner
sources:
  - safe/lpm
  - epicflow/ppm-guide
  - dpf/agents-rulebook
---

## Rule

- **The budget lives on the portfolio.** The portfolio owner sets and changes it in the product, with a recorded reason, without a code release.
- **Cost is attributed upward.** Each call's real marginal cost is charged to the portfolio of the work it served, through workroom, backlog item and epic. Zero-marginal usage (local models, flat-rate subscriptions) costs the budget nothing.
- **Worker caps are signals, not gates.** A coworker's unusual spend is reported for attention. It does not refuse work.
- **Mandatory platform functions are never refused.** Reviews and readiness checks every change depends on are charged to the platform portfolio. Overspend is reported to that portfolio's owner, and the function keeps running.

## Why

On 2026-11-03 a per-coworker 200,000-token daily cap on the change reviewer ran out mid-day, and every PR's mandatory Failure Readiness check failed until midnight UTC. Almost all of that usage cost nothing: it ran on the local model and a flat-rate subscription. The owner's ruling on 2026-11-04 was "The budget concerns need to be held at higher levels of the structured work. Portfolio level. Why we have this budget at this low level is a horrid design for the reason we currently are experiencing."

Lean Portfolio Management takes the same view: fund value streams and portfolios, not individual projects or people, and govern with guardrails at that level.

## How To Apply

1. **When a design adds or reviews an AI spending limit,** attach it to the portfolio that owns the work, and name that portfolio's owner as the person who adjusts it.
2. **Trace attribution.** Confirm every paid call can be charged to a portfolio. An unattributed call goes to the platform portfolio, never to nobody.
3. **Remove refusals below the portfolio.** Replace any per-worker or per-session cap that refuses work with a report.
4. **Exempt mandatory gates from refusal.** Charge them, report them, never stop them.

## See Also

- [[professions/enterprise-architecture/place-controls-at-the-owning-scope]]
- [[professions/operations/size-shared-limits-to-measured-demand]]
- [[professions/portfolio-management/balance-the-portfolio]]
