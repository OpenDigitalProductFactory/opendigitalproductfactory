---
title: Place controls at the scope that owns the work
pageKind: principle
status: published
abstract: Approvals, budgets and handover rules belong to the level of structured work that owns the outcome. Inside a scope, the parties coordinate on their own; a control applies only where work crosses out of that scope. An architecture that puts a control lower, such as on one coworker or one session, turns a local limit into an estate-wide outage.
principleTier: core
principleDirection: When a design decides cross-room coordination or spend, place each approval, budget and handover rule at the scope that owns the work; let parties inside that scope coordinate on their own, and gate only what crosses out of it.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleDimensionVector: {"governance_compliance": 0.8, "long_term_maintainability": 0.8, "legibility_of_consequence": 0.7, "speed_to_value": 0.6, "blast_radius": -0.7, "human_cognitive_load": -0.6}
professionCompetencyLevel: expert
sources:
  - opengroup/togaf
  - safe/lpm
  - dpf/agents-rulebook
---

## Rule

This is the steerage check whenever an architecture decision involves work that crosses rooms, or involves spend. For each control the design adds, name the scope that owns the outcome, and attach the control there:

- **Inside one scope** (the same owner, the same workroom mandate, parties already admitted): the parties coordinate between themselves. A handover is proposed and acknowledged by the two parties, with no human step.
- **Crossing out of the scope** (a different owner, a different mandate, a new party, a different portfolio): the control applies, and the person asked is told in plain words what will happen and why.
- **Budgets** sit at the portfolio level of structured work, not on a coworker or a session. See [[professions/portfolio-management/hold-ai-spend-at-portfolio-level]].

A design that attaches a control below its owning scope is incomplete. Review sends it back.

## Why

The owner ruled on this on 2026-11-04, after two controls placed too low halted delivery:

- A per-coworker daily token cap on the change reviewer stopped every PR's mandatory check.
- Moving a workroom between two sessions working for the same owner needed his approval every time, including the overnight approval that blocked an emergency fix for over seven hours.

In his words: "when all involved are under the same ownership scope a hand over needs to be automated", and "the budget concerns need to be held at higher levels of the structured work. Portfolio level."

Standards say the same. Lean Portfolio Management funds and governs at the value-stream or portfolio level and lets teams act inside that guardrail. TOGAF places governance at the architecture level that owns the decision.

## How To Apply

1. **List every approval, budget and handover rule the design introduces or touches.**
2. **For each one, name the owning scope.** That is the workroom, the epic or the portfolio, never "this agent".
3. **Check the inside path.** Two parties in the same scope must be able to complete the action with a proposal and an acknowledgement, under [[principles/propose-acknowledge-reassign]], with no human step.
4. **Check the crossing path.** Leaving the scope must hit the control, and the request must be legible to the person it reaches.
5. **Check mandatory platform functions.** A scoped budget or approval must never stop a gate every change depends on. Charge that function to its owning portfolio and report overspend instead.

## See Also

- [[principles/propose-acknowledge-reassign]]
- [[principles/escalation-is-a-gate-not-a-trust-tier]]
- [[principles/decisions-belong-to-their-scope]]
- [[professions/scrum-master/same-scope-handover-is-propose-and-acknowledge]]
- [[professions/portfolio-management/hold-ai-spend-at-portfolio-level]]
