---
title: A same-scope handover is propose and acknowledge, with no human step
pageKind: principle
status: published
abstract: When work passes between parties under the same owner and the same workroom mandate, the handover is two steps between those parties. One proposes, the other acknowledges, and then it happens. The acknowledgement is where open issues are settled. A human approval is needed only when the handover crosses out of that scope.
principleTier: core
principleDirection: Hand work over inside a scope by proposal and acknowledgement between the parties, settling open issues at acknowledgement; ask a human only when the handover leaves the owner's or the workroom's scope.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleDimensionVector: {"speed_to_value": 0.8, "governance_compliance": 0.7, "legibility_of_consequence": 0.6, "human_cognitive_load": -0.8, "operator_effort": -0.7}
professionCompetencyLevel: practitioner
sources:
  - kanban/guide-for-scrum-2021
  - dpf/agents-rulebook
---

## Rule

Inside one scope (the same owning person, the same workroom mandate, and a receiver already admitted to the room), a handover takes two steps between the parties:

1. **Propose.** The current holder names the receiver, the next action, and anything still open: risks, in-flight runs, evidence.
2. **Acknowledge.** The receiver accepts, asks for changes, or declines. Open issues are settled here. On acceptance the handover takes effect, and the room's work, lease and evidence move to the receiver.

Neither step asks a human. A handover that crosses out of the scope (a different owner, a different mandate, a party not yet admitted) needs approval, and the request says in plain words what moves and why.

This is the kernel's [[principles/propose-acknowledge-reassign]] applied to workrooms. Inside a scope, the acknowledgement token comes from the receiving party, not from the owner.

## Why

The owner ruled on this on 2026-11-04: "when all involved are under the same ownership scope a hand over needs to be automated. There needs to be a 2 step process, ask to hand over, acknowledge, then hand over just happens. The acknowledge will also allow the parties to deal with any issue. Workroom scope it's not needed. Outside of workroom scope it is. This allows for coordinated autonomy."

The triggering case: two sessions working for the same owner on the same emergency fix could not pass its workroom between them without his approval. The fix waited overnight while production was halted.

## How To Apply

1. **Before handing over,** check scope: same owner, same mandate, receiver admitted. If all three hold, propose and wait for the receiver's acknowledgement. Do not raise an owner approval.
2. **In the proposal,** list what is in flight and what is unresolved, so the receiver can settle it before accepting.
3. **If any scope check fails,** request approval, and say plainly what moves, from whom, to whom, and why.
4. **If a tool asks the owner for a same-scope handover anyway,** treat it as a defect and file it, rather than routing the approval as normal.

## See Also

- [[principles/propose-acknowledge-reassign]]
- [[professions/enterprise-architecture/place-controls-at-the-owning-scope]]
- [[professions/scrum-master/wip-limits-and-flow]]
