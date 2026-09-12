---
title: Escalation Is a Gate, Not a Trust Tier
pageKind: principle
status: published
abstract: A human is engaged only when the action is damaging, or when nothing recorded can steer it; a coworker's trust tier is a ceiling on what it may attempt, never a reason to escalate.
principleTier: commandment
principleDirection: A human is engaged only when the action is damaging, or when nothing recorded can steer it; a coworker's trust tier is a ceiling on what it may attempt, never a reason to escalate.
principleWeight: 0.3
principleWeightRationale: >-
  Procedural meta-principle. It decides WHO decides, not WHAT to decide, so it
  deliberately carries a low structured decision weight and a focused vector:
  scored at commandment default it pulled the canonical quick-vs-proper decision
  below its margin floor by rewarding low operator effort, a trade-off it has no
  bearing on. Its force is as an enforced gate (resolveEscalation) and a followed
  directive, not as decision math.
principleDimensionVector: {"governance_compliance": 0.5, "human_cognitive_load": -0.9}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-1-coworker
  - ring-2-workflow
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters need to know exactly when the platform will interrupt a person and when it will not, because that boundary is the difference between an autonomous workforce and a queue of approval clicks.
sources:
  - frameworks/nist-ai-rmf
---

## Rule

Escalation is a property of the decision, not of the acting coworker's trust tier.

A coworker whose operator has already graduated it keeps acting alone; this gate never widens that.

For every other coworker, a human is engaged only when the action is damaging, or when nothing recorded can steer it.

An action is damaging when it declares a consequence (outward, irreversible, authority), when a Work Case declares it consequential, or when its data sensitivity is restricted.

A damaging action is decided by a person; a coworker's steering does not decide damage.

Automated steering is a recorded, server-resolved fact about the action itself: independent-reviewer, room-authority, wwmd.

A non-damaging action with steering is decided automatically and mints no approval envelope.

A non-damaging action with no steering reaches a human only when it has a side effect; an immediate read never escalates.

A tool declared as a proposal is always put to a person, because that is its declared shape.

## Why

Founder ruling, 2026-09-09: "The only reason to escalate to a human is for more sensitive, damaging decisions, notably if there is no automated decision process to steer decisions, as the delegation system for the human in the loop." And, on where the rule belongs: "less prose, more process."

The platform had the opposite shape. Approval was minted from the acting coworker's HITL tier, a property of the actor rather than of the decision. Every specialist reviewer ships at the most cautious tier, so the receipts those reviewers exist to write — the governance evidence that lets initiative readiness advance at all — each raised an approval envelope that only the delegating human could clear. A routine platform receipt that decides nothing damaging was put in front of a person, and on 2026-09-09 that reached the founder, who had never been asked to approve anything in the project's history. The delegation system is the human in the loop; asking a person to confirm what the delegation system already decided is waste wearing a governance costume.

The emphatic half of the ruling is a second path TO a human, never a path away from one. Reading "if there is no automated decision process" as an exemption would let a reviewer coworker's judgment stand in for the human go on an outbound send or an irreversible change, which `outbound-and-irreversible-actions-require-explicit-go` and `destructive-actions-require-explicit-go` forbid at commandment tier. So a coworker's steering does not decide damage.

Two authorities stay separate on purpose. The operator decides, per coworker, whether ordinary side effects need approval at all; a graduated coworker keeps acting alone and this rule does not touch that. This rule decides only, among the actions that configuration would have escalated, which ones genuinely need a person. Its conformance guard proves exhaustively that it can only remove escalations, never add one — a fix for over-escalation that introduced new approval envelopes would be the same defect wearing the opposite coat.

This page is generated against the gate it describes. `resolveEscalation` exports these sentences and `check-escalation-gate.ts` fails the build if this page does not state them verbatim, so doctrine and enforcement cannot drift apart on any install.

## How to apply

Do not ask a person to confirm an action that is neither damaging nor unsteered — and do not write a rule into an agent's memory to make that true. Memory does not reach the next install. Put the decision in the gate, where every install runs it with no AI client present.

When an approval envelope appears for a routine action, treat it as a defect in the gate's inputs, not as a step to perform. Either the action's declared consequence is wrong, or the steering that should have decided it was not recorded — a reviewer binding that never resolved, or a room whose action boundary nobody declared. Fix the input.

When a human genuinely must decide, give them the consequence before the confirm, per `show-the-consequence-before-the-confirm`.
