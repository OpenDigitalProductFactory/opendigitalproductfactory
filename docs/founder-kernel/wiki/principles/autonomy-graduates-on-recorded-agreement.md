---
title: Autonomy Graduates on Recorded Agreement
pageKind: principle
status: published
abstract: Autonomy for a decision class is earned a level at a time by measured agreement over recorded decisions, lost the same way, and capped by the lowest of earned trust, risk ceiling and regulatory ceiling.
principleTier: core
principleDirection: Autonomy for a decision class is earned a level at a time by measured agreement over recorded decisions, lost the same way, and capped by the lowest of earned trust, risk ceiling and regulatory ceiling.
principleWeight: 0.4
principleWeightRationale: >-
  Core default. It governs the RATE at which authority changes, not whether a
  particular action is permitted — the permission question is already answered
  at commandment tier by the escalation gate and the auto-execute floor. A
  higher weight would let a graduation argument outrank those, which is the
  exact inversion this page exists to prevent.
principleDimensionVector: {"evidence_density": 0.8, "legibility_of_consequence": 0.5, "blast_radius": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: An adopter deciding whether to let AI coworkers act needs to know that authority moves on measured evidence rather than on a setting someone changed once, and that no amount of good behaviour widens a regulatory ceiling.
---

## Rule

Autonomy is a level per decision class, not a switch per coworker.

Everything starts at **shadow**: the coworker computes what it would do, acts on nothing, and the proposed decision is recorded beside what actually happened.

A level is earned by an **agreement rate over a rolling window** of recorded decisions with a stated minimum sample. It is lost the same way: a bad call drops a level. Graduation is symmetric, or it is only ever a ratchet upward.

The effective level is the **lowest** of three independent caps:

- what the coworker has earned,
- the **risk ceiling** of the action,
- the **regulatory ceiling** for that activity in that jurisdiction.

A regulatory ceiling is raised by a compliance decision, never by an agreement rate. No amount of measured agreement graduates past it.

## Why

Two opposite failures. Approve-everything-forever never graduates, so the human stays a queue of clicks and the system's certainty never compounds. Granting autonomy up front has no evidence behind it, and the first bad call is discovered by its consequence.

A rate over recorded decisions is the only thing that distinguishes them. It also makes the human's job the right one: reviewing an evidenced overview and tuning the scopes, rather than gating each call.

The failure mode this forbids specifically is **a graduation that widens what a coworker may attempt**. Earned trust decides how closely a coworker is watched. It never decides whether an action is permitted at all.

## What this page does NOT say

Three neighbouring rules already own their questions and are not restated here:

- **Whether a human is engaged at all** belongs to [[principles/escalation-is-a-gate-not-a-trust-tier]]: a trust tier is "a ceiling on what it may attempt, never a reason to escalate". A coworker already graduated by its operator keeps acting alone; this page never widens that.
- **Which actions may auto-execute at any level** belongs to [[principles/never-auto-execute-irreversible-or-estate-wide-response]]. That page is the floor, and this one "can only make a decision more conservative, never less".
- **Whether trust is inferred from past behaviour at all** belongs to [[principles/trust-is-prospective-not-retrospective]]. Agreement is a measured record of decisions, not a reputation.

## How to apply

Ship a new autonomous loop at shadow and make three things first-class from the start, not later polish: the per-decision recorded outcome, the operator's overview with drill-in, and the tuning loop that feeds overrides back into the scope that produced them.

An **override is the highest-value row** in that record. It is a labelled correction, and it is the only thing that can tune the scoring. A design that makes an override feel like a failure will not collect any.

A level with no recorded outcomes has earned nothing. Silence is not agreement.

## Overlap scan (§4.3)

The kernel-evolution discipline asks for the closest existing principle by alignment, scored with the direction as a featureless option. **That procedure does not currently produce a number.** Run on 2026-09-22 (`DI-67616CE84F5A`): 51 principles applied, every contribution exactly 0, `insufficientSignal: true`. Governance commandments are loaded with full dimension vectors, so scoring takes the structured path and the semantic fallback never fires for them — a featureless option scores zero against all of them. The numeric scan is therefore unavailable and the overlap argument below is textual.

The three nearest neighbours are named in "What this page does NOT say" above, and each is cited rather than restated. All three are commandment tier, which `commons-are-curated-not-just-appended` excludes from consolidation, so folding this in was not available either.

What is genuinely absent from the corpus is the **mechanic**: no page defines the ladder, the agreement rate, the rolling window, or symmetric demotion. `governance-approves-evidence-not-provenance` already asserts that a practice "erode[s] the autonomy ladder" — citing a construct the kernel had never defined. This page defines it.
