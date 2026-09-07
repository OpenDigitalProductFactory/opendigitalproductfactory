---
title: Gates are proportional to the shape of the work
slug: gates-proportional-to-shape
pageKind: principle
status: published
abstract: Governance asks a unit of work only for the artifacts it naturally produces. The delivery shape (break-fix, small, medium, large, xlarge) plus sensitivity decides which gates it owes; no artifact is produced solely to satisfy a gate.
principleTier: core
principleDirection: Select the delivery shape at the claim, declared or derived and never guessed; gate by (shape, sensitivity, target); raise for sensitivity and never lower silently; treat a demand for an artifact the work would not otherwise produce as a defect in the gate table, not in the work.
principleDimensionVector: {"governance_compliance": 0.7, "speed_to_value": 0.7, "human_cognitive_load": -0.5, "evidence_density": 0.5, "legibility_of_consequence": 0.6, "long_term_maintainability": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - build-studio
principlePublic: false
authoredAt: 2026-09-06
authoredBy: mark-bodman
---

# Gates are proportional to the shape of the work

**Governance asks a unit of work only for the artifacts it naturally produces.**
A one-file operational repair and a new archetype do not answer to the same
gauntlet. The delivery shape — `break-fix`, `small`, `medium`, `large`,
`xlarge` — together with the deliverable's sensitivity decides which gates the
work owes and who signs them.

## The rule

- **The shape is an explicit act.** It is declared at the claim, or derived
  only when every classification rule agrees. An implementation claim with no
  derivable shape is refused with the pick list; the agent puts the list to a
  person and re-claims. Nobody guesses a shape.
- **Gates follow the shape.** A small fix owes a reproduction, the PR gate, a
  merged SHA on main and a runtime check. A medium item owes a design note and
  acceptance criteria in the item body and an independent acceptance receipt.
  A large item owes an approved spec, a plan with live backlog coverage and
  architecture review. An xlarge initiative only ever decomposes. A break-fix
  skips pre-authorisation and owes a post-implementation review within 48
  hours by someone other than the declarer.
- **Sensitivity raises, never lowers.** High sensitivity takes a small or
  medium item to the large gates; elevated raises one step. Lowering a shape
  is a recorded override, visible on the item and in the gate decision.
- **Delivery evidence is the trunk.** A SHA reachable from main with green
  required checks is delivery for every shape; no manifest is built to prove
  what git already knows.
- **No artifact is produced solely to satisfy a gate.** When a gate asks for a
  document the work did not naturally produce, the gate table is wrong, not
  the work. Writing a plan after the fact to placate a projector converts a
  reporting defect into falsified governance history.

## Where it lives

Design: `docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md`.
Registry: `apps/web/lib/work-management/delivery-shapes.ts`. Policy:
`apps/web/lib/backlog/initiative-readiness/shape-requirements.ts`
(`initiative-readiness.v3`). Kernel rulings 2026-09-03 and DI-C0989B8514AF.
