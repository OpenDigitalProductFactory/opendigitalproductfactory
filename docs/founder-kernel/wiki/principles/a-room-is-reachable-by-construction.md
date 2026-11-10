---
title: A Room Is Reachable by Construction
pageKind: principle
status: published
abstract: A room that exists can be opened. Its address is composed by one helper, resolved from one anchor, and never offered as a link that cannot be honoured.
principleTier: core
principleDirection: Compose a room's address from the canonical helper and resolve it from the canonical anchor; never spell a room path out, and never emit a link the read model cannot honour.
principleDimensionVector: {"long_term_maintainability": 0.9, "schema_grounding": 0.85, "legibility_of_consequence": 0.7, "reusability": 0.6, "evidence_density": 0.5, "blast_radius": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters building surfaces over DPF work need to know that room addressing is a platform guarantee they compose against, not a URL convention they reimplement.
---

## The rule

A room that exists is reachable. Four parts, all enforceable:

1. **A room is addressable by construction.** Exactly one helper composes a
   room's URL from its identity. No surface builds a room path by string
   interpolation.
2. **A room is resolvable from its canonical anchor.** The read model resolves a
   room through the foreign key that anchors it, never through a naming
   convention that may or may not have been populated.
3. **A room that exists is reachable.** No surface emits a link to a room the
   read model cannot resolve. If it cannot be opened, it is not offered.
4. **A room's activities are contextual to the room's design.** What a room shows
   derives from its own shape and projection mode, not from a default the
   renderer assumes. A room whose projection cannot be computed degrades inside
   its own frame; it never denies the operator the rest of the room.

## Why

Founder direction, 2026-09-07, on finding that no "Open room" button on the
owner's attention inbox worked: *"The room should be reachable by design; the
activities in that room are contextual to the design of that room."*

That single symptom was four independent defects, and every one was this rule
missing:

- the attention lens composed `/ea/workrooms/<id>`, a path with no dynamic
  segment behind it, so every card 404'd (BI-6F2CC21B);
- the case loader resolved rooms by a naming convention instead of the
  `Workroom.workItemId` anchor, so 405 of 462 active rooms could not be opened
  (BI-EBEB77E2);
- the source registry classified standing rooms as finite, so their cycle threw
  and the uncaught error destroyed the whole page (BI-97B24FB5);
- a backlog row built `/workspace/cases/<capsuleId>` without its source-type
  prefix, so every workroom link on it 404'd — found by the guard this principle
  carries, in a surface nobody had looked at.

Four surfaces, four different wrong answers to the same question, none caught by
a test. Fixing four instances leaves the fifth to be written next month. The rule
is what closes the class, and a guard is what keeps it closed.

## How it is enforced

`scripts/check-no-unreachable-room-links.mjs` fails a diff that spells out a
work-case path instead of composing it, or that links to a route prefix which
provably cannot accept a dynamic segment. Rule 1 has no baseline — a hand-built
work-case path is always wrong. Rule 2 carries a baseline so the class cannot
grow while pre-existing entries are judged individually.

The guard reads live repository state, so its self-test is registered as a
`conformanceTest(...)` — see
[[all-changes-land-via-pr]] and `scripts/check-guard-conformance-marks.mjs` for
why an unmarked repository-reading self-test is silently stripped.

Related: [[single-source-of-truth]] (one home for the addressing rule),
[[verify-substrate-before-proposing-new]] (the classifying fact was already on
the room), [[make-silent-failures-observable]] (a room whose cycle fails says so
rather than reporting itself healthy).
