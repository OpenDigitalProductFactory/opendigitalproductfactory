---
title: Prove a blocking gate's capacity, failure behaviour and emergency path before enforcing it
pageKind: principle
status: published
abstract: A check that can stop delivery, such as a required CI status, a mandatory review or a spending cap, is part of the delivery system's critical path. Before it is switched from observe to enforce, record whether its capacity covers measured demand, what it does when full or broken, and how an owner gets an urgent fix through. Otherwise one saturated gate halts all work, including the fix for the gate.
principleTier: core
principleDirection: Do not enforce a blocking gate until its capacity is sized to measured demand with headroom, its saturation and failure states are named plainly, and an audited owner emergency path exists that does not depend on the gate itself.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleDimensionVector: {"speed_to_value": 0.8, "legibility_of_consequence": 0.8, "governance_compliance": 0.6, "blast_radius": -0.8, "operator_effort": -0.5}
professionCompetencyLevel: expert
sources:
  - google/sre-book-risk
  - dora/four-keys
  - dpf/agents-rulebook
---

## Rule

Treat every blocking gate as production capacity on the delivery critical path. This covers required CI statuses, mandatory independent reviews, admission limits and spending caps. Before a gate moves from observe or shadow mode to enforce, record four things:

1. **Capacity against demand.** What the gate can process per day, compared with the trailing-week measured volume, with headroom. Example: reviews per day times tokens per review, against the reviewer's daily allowance.
2. **Saturation and failure behaviour.** What happens when it is full or its dependency is down. The state must name its cause, its reset time and its remedy. It must never present as an "unknown" or "uncertain" outcome, which invites futile retries.
3. **Owner emergency path.** An audited, human-declared route that lets an urgent operational fix through on production when the gate cannot run. The path must not depend on the failing component, and the skipped check runs afterwards.
4. **Owner and off-switch.** Who is accountable for the gate's flow, and how it is returned to observe mode.

## Why

A fail-closed gate with no capacity sizing turns a resource limit into a delivery outage. Its fail-closed design is correct; its missing capacity plan is the defect. DORA's lead time and deployment frequency fall to zero while the gate is saturated. Because the fix for the gate must itself pass the gate, recovery waits for an external reset unless an emergency path exists. In the SRE framing, a gate spends the organisation's change budget, and a gate with unbounded downside is an unmanaged risk.

## Observed failure (DPF, 2026-11-03)

- The mandatory semantic review was switched to enforce for every PR (required "Failure Readiness" status).
- The reviewer's daily cap of 200,000 tokens had been set months earlier for occasional use. It covered about 13 reviews against more than 20 open PRs, and it counted zero-cost local-model tokens.
- The refusal was reported as "provider-outcome-uncertain". The exemption route worked only on development installs.
- About 20 PRs, including the fix itself, waited for the 00:00 UTC reset. The same gate had blocked every PR once before, when a required setting was missing.

## How To Apply

1. **When you add or tighten a blocking check,** write the four records in the PR, or in a gate-readiness manifest where the platform requires one. Cite measured volume, not an estimate.
2. **Start in observe/shadow mode,** measure real demand and failure rates, and only then enforce.
3. **Give every refusal a typed, plainly worded state** with its reset time and the remedy. Make retries refuse while the state persists, so they do not spend recovery attempts.
4. **Count blocked work daily per gate.** A gate holding up most open work is an incident, not a policy outcome.
5. **When reviewing someone else's gate change,** treat a missing capacity or emergency record as a blocking finding.

## See Also

- [[professions/operations/size-shared-limits-to-measured-demand]]
- [[professions/devops-platform/pin-ci-toolchain-to-qualified-version]]
- [[professions/operations/error-budget-toil-tradeoff]]
