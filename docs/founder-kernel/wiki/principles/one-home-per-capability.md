---
title: One home per capability
slug: one-home-per-capability
pageKind: principle
status: published
abstract: Every capability gets exactly one canonical route home; secondary surfaces link to it and never restate it. Prefer a filtered view of the existing home over a new dashboard, tab, or route family.
principleTier: core
principleDirection: Give every capability exactly one canonical route home; secondary surfaces link to it and never restate it. Prefer a filtered view of the existing home over a new dashboard, tab, or route family.
principleDimensionVector: {"operator_effort": -0.5, "long_term_maintainability": 0.7, "reusability": 0.6, "human_cognitive_load": -0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: route-domain-specific
principleConsumerContexts:
  - ui
principleRingScope:
  - ring-2-workflow
principlePublic: false
authoredAt: 2026-07-23
authoredBy: mark-bodman
---

# One home per capability

**Every capability lives at exactly one canonical route.** Secondary surfaces
that need to reach it *link* to that home; they never restate it as a second
copy. When a capability outgrows what one screen shows, the first answer is a
filtered or scoped *view of the existing home* — not a new dashboard, a new tab
row, or a new route family.

## Why

A capability with two homes is a capability with two truths: two places to keep
in sync, two places an operator has to remember, two places a change has to
land. The portal's failure mode is accretion — every feature that adds "its own"
dashboard makes the whole product harder to hold in one head, and the cost is
paid on every visit forever, not once at build time. Reuse of the existing home
keeps the map small; a link is free, a duplicate home is a standing tax.

This is the single most-invoked rule of the UX fit review ("do not approve a new
dashboard when a section home or a filtered view would do"), promoted to a
principle so the decision is made before the surface is built, not caught in
review after the code already multiplied the problem.

## Applies To

In-platform coworkers and external coding agents proposing or building portal
surfaces, and humans reviewing UI plans. It governs *navigation and information
architecture* — where a capability lives and how other surfaces reach it. It is
not about data (that is [[principles/single-source-of-truth]]); the two compose:
one data model, one route home.

## How To Apply

Before adding a route, tab, dashboard band, or metric home, name the capability's
existing canonical home and ask whether a filtered view of it would serve. If a
second surface genuinely needs the capability, it links to the home and renders a
scoped projection — it does not fork a parallel copy. A new home must *retire or
converge* an old one, not sit beside it.

## Decision Dimensions

- `operator_effort: -0.5` — one home means one place to go; duplicated homes make
  the operator hunt across surfaces for the authoritative one.
- `long_term_maintainability: 0.7` — a single home is one thing to keep correct as
  the system grows; every duplicate is a future divergence bug.
- `reusability: 0.6` — a canonical home is linked-to and projected-from by many
  callers instead of re-implemented per surface.
- `human_cognitive_load: -0.5` — a small, non-duplicated route map is holdable in
  one head; accreted parallel homes are not.

## Overlap scan (§4.3)

Closest existing principle by the kernel-evolution discipline's overlap scan
(`principle_decide`, direction as a featureless option, DI on the ledger):
`native-cohesion-over-interfacing` at 0.64, then `design-research-required` at
0.56 — both below the 0.70 additivity bar, so this ships as a new principle.
Paired-but-distinct from [[principles/single-source-of-truth]]: that governs the
data (one system of record), this governs the navigation (one route home).
