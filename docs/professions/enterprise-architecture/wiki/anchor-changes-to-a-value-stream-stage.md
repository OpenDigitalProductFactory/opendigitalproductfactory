---
title: Anchor every change to a value-stream stage
pageKind: principle
status: published
abstract: A design should name the value-stream stage it serves and the whole outcome it moves. A change that cannot name one is a local optimization — it may be individually correct and still not advance anything end to end, which is the most common non-blocking finding in architecture review.
principleTier: contextual
principleDirection: Require every design to name the value-stream stage it serves and the end-to-end outcome it advances; treat an unanchored change as a local optimization.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"evidence_density": 0.6, "long_term_maintainability": 0.6, "reusability": 0.5, "capacity_utilization": 0.4}
professionCompetencyLevel: practitioner
sources:
  - opengroup/it4it
  - techtarget/it4it
  - iso/42010
---

## Rule

Every architecturally significant design names two things:

- **The value-stream stage it serves** — in IT4IT terms, Strategy to Portfolio, Requirement to Deploy, Request to Fulfill, or Detect to Correct.
- **The end-to-end outcome it moves** — what a user or operator can do afterwards that they could not do before, stated at the level of the whole flow rather than the component.

An unanchored change is not automatically wrong. It is *unevidenced*, and that is a named adjustment on an otherwise-passing review — not a block.

## Why

IT4IT is a **value-stream-based** reference architecture: its organizing claim is that IT work is understood as flows that cross functions, not as a set of independently-managed components. The four value streams exist so that a change can be located in a flow and its contribution measured there.

The failure this prevents is local optimization — a component improved in isolation while the flow it belongs to is unchanged or worse. It is hard to catch by inspection precisely because the component-level work is usually good; nothing in the diff looks wrong. Only the question "which stage of which flow is better because of this?" exposes it.

ISO/IEC/IEEE 42010 gives the same discipline its general form: an architecture description exists to address identified stakeholder **concerns**. A change with no nameable concern behind it has no criterion by which anyone can later judge whether it worked. Anchoring is what makes the outcome falsifiable.

## How To Apply

1. **Name the stage explicitly in the design**, not by implication. "This serves Requirement to Deploy by removing a manual step between plan approval and build dispatch" is anchored; "this improves the build page" is not.
2. **State the outcome end to end.** Whose flow, and what is different at the end of it.
3. **Grade a missing anchor as minor.** It is an adjustment carried on a proceed verdict — see [[professions/enterprise-architecture/architecture-review-verdict-thresholds]] — unless the change is *only* justifiable by an anchor it cannot supply, in which case the design has no rationale at all.
4. **Watch for the stage mismatch.** A change filed under one stage whose real effect lands in another usually means the design is solving a different problem than the one it opens with.
5. **Where the estate is organized by archetype or vertical**, anchor to that vertical's load-bearing stage — the generic stage name alone under-specifies which flow was meant.

## See Also

- [[professions/enterprise-architecture/it4it-value-streams]]
- [[professions/enterprise-architecture/architecture-review-verdict-thresholds]]
- [[professions/enterprise-architecture/minimal-proven-associations]]
