---
title: Size shared limits to measured demand and meter them by real cost
pageKind: principle
status: published
abstract: A quota or budget that every request shares, such as a daily token cap or a concurrency limit, must be sized from measured demand and must count only what it is protecting. Counting zero-marginal-cost work as spend, or leaving a cap at a number set for a different workload, turns an accounting rule into an outage. Hold budgets at the portfolio level, owner-adjustable, never hard-coded per worker.
principleTier: core
principleDirection: Derive shared limits from measured demand with headroom, count only the scarce resource the limit protects, and let the accountable owner adjust them without a code release.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleDimensionVector: {"capacity_utilization": 0.8, "cost_efficiency": 0.7, "speed_to_value": 0.6, "operator_effort": -0.6}
professionCompetencyLevel: practitioner
sources:
  - google/sre-book-slo
  - google/sre-book-risk
  - dpf/agents-rulebook
---

## Rule

Every shared limit names the scarce resource it protects and counts only consumption of that resource. Its value comes from measured demand plus headroom, and the accountable owner can change it in the product, with a recorded reason, without a code release.

- **Money budgets** count marginal spend. Local models and flat-rate subscriptions cost nothing extra per call. A provider with no recorded price is estimated, never treated as free.
- **Capacity limits** count what is actually scarce. On a single local model, that is execution time and concurrency, not tokens or dollars.
- **Per-worker caps** are signals, not gates. Money budgets sit at the portfolio level of structured work; see [[professions/portfolio-management/hold-ai-spend-at-portfolio-level]].

## Why

A limit that counts the wrong thing trips on harmless work and misses real cost. A limit sized for last quarter's workload becomes the bottleneck the day demand changes. That day is often the day a new process starts depending on it. Measuring against real demand is the same discipline as setting an SLO from user need, not from what the system happens to deliver.

## Observed failure (DPF, 2026-11-03)

The change reviewer's 200,000-token daily cap counted 178,275 local-model tokens, recorded at $0.02, plus 28,255 subscription tokens at $0.00. It ran out mid-day and stalled every PR. The cap lived in a bundled registry, and the database could only lower it. On a fully local install the real constraint was time on one local model, which the token cap did not measure at all.

## How To Apply

1. **Before setting or reviewing a limit,** state what is scarce, then pull the trailing-week demand for that resource.
2. **Exclude zero-marginal-cost usage from money limits,** decided by recorded price, never by provider name.
3. **Put the owner-level allowance where the owner can change it,** and show current use against it.
4. **Review limits whenever a process starts depending on them,** for example when a review or gate becomes mandatory.

## See Also

- [[professions/software-engineer/mandatory-gate-readiness]]
- [[professions/operations/sli-slo-error-budget]]
- [[professions/operations/error-budget-toil-tradeoff]]
- [[professions/portfolio-management/hold-ai-spend-at-portfolio-level]]
