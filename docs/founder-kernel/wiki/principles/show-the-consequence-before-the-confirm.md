---
title: Show the consequence before the confirm
slug: show-the-consequence-before-the-confirm
pageKind: principle
status: published
abstract: Every affordance that authorizes an AI action must state, before the confirm, what will happen, to what, under whose authority, and how it is undone.
principleTier: core
principleDirection: Every affordance that authorizes an AI action must state, before the confirm, what will happen, to what, under whose authority, and how it is undone.
principleDimensionVector: {"legibility_of_consequence": 0.9, "human_cognitive_load": -0.4, "evidence_density": 0.4, "customer_consent_state": 0.5, "blast_radius": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principleRingScope:
  - ring-1-coworker
  - ring-2-workflow
principlePublic: false
authoredAt: 2026-07-23
authoredBy: mark-bodman
---

# Show the consequence before the confirm

**Any affordance that authorizes an AI action must state — before the operator
confirms — what will happen, to what, under whose authority, and how it is
undone.** Consent to an action the operator cannot foresee is not consent.

## Why

The platform's premise is that AI drives real actions, and the safeguard against
that going wrong is not only "ask before acting" but "ask *legibly*." A confirm
button on an opaque action is a rubber stamp: the operator clicks yes to
something they cannot picture, and the guardrail that was supposed to catch the
bad case never fires because the human had nothing to catch it with. The four
things a preview must carry — the effect, the target, the authority, the reversal
— are exactly what an operator needs to withhold consent from the one action in a
hundred that should be stopped.

This is the UI-side realization of the authority commandments. Those say *that*
you must get an explicit go
([[principles/destructive-actions-require-explicit-go]],
[[principles/outbound-actions-require-explicit-go]]); this says *what the ask
must show* for that go to mean anything. It is the anchor for the
`legibility_of_consequence` axis — the "can the operator foresee it?" dimension
the anti-YOLO concern actually names.

## Applies To

In-platform coworkers and external coding agents building any affordance that
authorizes an AI action (a confirm dialog, a run button, an approval card) — the
agent classes that construct these surfaces, matching the authority family
([[principles/destructive-actions-require-explicit-go]]). It does not add a
*second* gate where the authority commandments already require one — it governs
the *content* of the gate that already exists.

## How To Apply

Every authorize-an-AI-action affordance renders, before its confirm control: the
effect (what will happen), the target (to what), the authority (under whose
grant/role it runs), and the reversal (how it is undone, or that it cannot be).
This composes with [[principles/no-native-browser-dialogs]] (the preview must be
real DOM an agent and a test can read, not an opaque native dialog) and with
[[principles/destructive-actions-require-explicit-go]] (the danger-tone confirm
step stays; this makes its preview legible).

## Decision Dimensions

- `legibility_of_consequence: 0.9` — this principle exists to make an action's
  consequence visible before authorization; it is the axis's primary author.
- `human_cognitive_load: -0.4` — a structured four-part preview *reduces* what the
  operator must reconstruct in their head to decide; an opaque confirm raises it.
- `evidence_density: 0.4` — the preview is grounded in what the action will
  actually do (target, authority), not a generic "are you sure?".

## Overlap scan (§4.3)

Closest existing principle by the overlap scan: `governance-approves-evidence-
not-provenance` at 0.62, then `one-concern-per-pr` at 0.49 — below the 0.70 bar.
**Scan caveat (recorded honestly):** the overlap scan ranks a candidate against
core/contextual principles only — commandment directions are not embedded, so the
authority *commandments* this principle is closest to in spirit
(`destructive-actions-require-explicit-go`, `outbound-actions-require-explicit-go`)
could not be scored by the scan. The additivity claim is therefore made on
reasoning, not on a number: those commandments govern **whether** an explicit go
is required; this governs **what the ask must display** for that go to be
informed consent. It is the UI-content complement, not a fourth "ask first" rule.
