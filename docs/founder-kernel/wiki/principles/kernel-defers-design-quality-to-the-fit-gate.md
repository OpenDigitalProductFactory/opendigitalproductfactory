---
title: The kernel defers design quality to the fit gate
slug: kernel-defers-design-quality-to-the-fit-gate
pageKind: principle
status: published
abstract: The kernel decides where a surface belongs and what it may do; it does not score design quality by weighted sum. Design quality routes to the ux-fit-review gate and the ux-design profession corpus, and the kernel consumes the verdict and its measured evidence as inputs.
principleTier: core
principleDirection: The kernel decides where a surface belongs and what it may do; it does not score design quality by weighted sum. Design quality routes to the ux-fit-review gate and the ux-design profession corpus, and the kernel consumes the verdict and its measured evidence as inputs.
principleDimensionVector: {"schema_grounding": 0.8, "evidence_density": 0.7, "governance_compliance": 0.5, "human_cognitive_load": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: universal
principleRingScope:
  - universal-ring
principlePublic: false
authoredAt: 2026-07-23
authoredBy: mark-bodman
---

# The kernel defers design quality to the fit gate

**The kernel governs where a surface belongs and what it is allowed to do. It
does not score design *quality* by weighted sum.** Design quality routes to the
`dpf-ux-fit-review` gate and the `ux-design` profession corpus; the kernel
consumes their verdict and measured evidence as inputs to a decision, rather than
pretending to weigh craft it cannot commensurate.

## Why

`principle_decide` weighs options over commensurable axes. Some things are
genuinely commensurable — blast radius, reversibility, operator effort — and the
kernel weighs them well. Design *quality* — hierarchy, aesthetics, whether a
screen feels calm — is not a defensible 0..1 an author can score before the
surface exists; asking the kernel to weigh it produces theatre, where a binary
UI-hygiene rule bubbles up as the "top contributor" on a decision it has nothing
real to say about (the observation that opened BI-B5EA2FB2).

The honest architecture is a division of labour: the kernel decides **altitude**
(placement, authority, blast radius — governance it can weigh), the fit gate
renders the **verdict** on a specific surface (`fits` / `fits-with-guardrails` /
`defer` / `reject`), and the profession corpus holds the **craft**. The kernel's
competence is knowing which questions it should answer and which it should route
— and saying so, rather than producing a confident number over the wrong field.
This generalizes: any future "the kernel can't really weigh X" finding gets the
same treatment — recognise the altitude, route to whoever owns the craft, consume
the verdict as evidence — instead of another dimension-family proposal.

## Applies To

In-platform coworkers, external coding agents, and humans making or reviewing a
design decision. It is a rule about *how the kernel itself behaves* on
design-altitude questions, which is why it is universal rather than surface-
scoped. It composes with [[principles/design-research-required]] (research the
design first) and [[principles/structural-verification-is-not-functional]] (a
passing route test is not evidence the design is good).

## How To Apply

When a decision is about design quality rather than governance, do not force it
through a weighted-sum consult. Route it to `dpf-ux-fit-review` and the
`ux-design` profession corpus, take their verdict plus any measured evidence
(operations-to-outcome, the fit decision and its required edits), and feed *that*
back as an input. Reserve `principle_decide` for the parts the kernel can
genuinely weigh — where the surface belongs, what it may do, who authorizes it.

## Decision Dimensions

- `schema_grounding: 0.8` — routing to the gate/corpus that owns the craft anchors
  the decision in the real evaluator instead of a synthetic score.
- `evidence_density: 0.7` — the kernel consumes a measured fit verdict as
  evidence rather than manufacturing a number it cannot defend.
- `governance_compliance: 0.5` — it keeps the kernel inside its own remit
  (altitude and authority), which is what its governance role actually is.
- `human_cognitive_load: -0.3` — one honest hand-off is easier to trust and audit
  than a confident-looking weighted sum over the wrong field.

## Universal-ring justification (§4.2)

Earned, not defaulted: this binds at Ring 1 (a coworker choosing how to present an
action), Ring 2 (Build Studio design phases), and Ring 4 (a promotion gate
consuming a fit verdict) — three of the five rings — so it is scoped
`universal-ring` rather than to a single ring.

## Overlap scan (§4.3)

Closest existing principle by the overlap scan: `design-research-required` at
0.64, then `one-common-process-three-surfaces` at 0.62 — both below the 0.70 bar.
Distinct from design-research-required (research a design against comparable
systems before building): this is about *which evaluator owns the design-quality
verdict* and the kernel declining to fake it. It is the highest-leverage of the
BI-B5EA2FB2 set because it is the reframe made into doctrine.
