---
title: Substrate cleanup before substrate addition
slug: substrate-cleanup-before-substrate-addition
pageKind: principle
status: published
abstract: When adding a new substrate layer, consolidate the existing layer first. A Phase-0 cleanup pass that shrinks fragmentation beats a Phase-1 layer-on every time — and most "we'll clean up later" plans never come back to do it.
principleTier: core
principleDirection: Consolidate existing substrate before adding new substrate to it; a Phase-0 cleanup pass beats a Phase-1 layer-on every time.
principleDimensionVector: {"long_term_maintainability": 0.8, "reusability": 0.6, "schema_grounding": 0.5, "speed_to_value": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - data-model
  - portfolio
principleRingScope:
  - ring-2-workflow
  - ring-3-archetype
principlePublic: false
authoredAt: 2026-05-24
authoredBy: mark-bodman
---

# Substrate cleanup before substrate addition

**Before adding a new substrate layer to the platform — a new table, a
new event stream, a new coordination primitive, a new spec area — first
consolidate the existing substrate the new layer will sit on.** A
Phase-0 cleanup pass that shrinks fragmentation pays for itself many
times over. A "we'll clean it up later" plan almost never returns to do
the cleanup, because the new layer has already cemented the old
fragmentation in place.

## What "cleanup before addition" looks like

- **Reserve 20% of implementation capacity** for refactoring existing
  event/evidence/coordination seams before adding new emitters or
  consumers. Treat the budget as non-optional, not as slack.
- **Phase 0 of any multi-phase plan consolidates.** Phase 1+ adds. If a
  plan starts at Phase 1 with no Phase 0, ask why the cleanup didn't
  fit; the answer is usually "we didn't think we needed it" — which is
  the classic reason the substrate keeps fragmenting.
- **The cleanup PR ships first**, alone, with its own evidence. The
  addition PR depends on the cleanup landing.

## Why this exists

Two concrete examples from the platform's recent work:

- **Reduction Gear Architecture** (PR #1075) explicitly reserves at
  least 20% of implementation capacity for "refactoring existing
  event/evidence seams before adding new emitters." Quoting the spec:
  *"The intent is to shrink fragmentation, not layer one more table over
  unclear boundaries."* The architect's review forced this discipline
  in — the original draft would have added GearInterface on top of the
  existing fragmentation, locking it in.
- **Governed-upgrade plan** (PR #1076) Phase 0 consolidates `version.json`
  parsing and validation BEFORE Phase 1 introduces the PlatformConfig
  mirror. Phase 1 doesn't dual-parse — it depends on the canonical
  parser from Phase 0. Skipping Phase 0 would have meant two parsers,
  silently drifting forever.

The addition-without-cleanup alternative — ship the new layer and tell
yourself you'll come back to refactor — produces three predictable
failure modes:

1. **The new layer cements the old fragmentation.** Now there are N+1
   coordination mechanisms instead of N, and the new one depends on
   the old shape staying frozen.
2. **The "later" cleanup never happens.** Engineering attention moves
   to the next addition. A year later the substrate has three layers
   of partially-overlapping primitives and no one remembers which one
   to use.
3. **Operator cognitive load grows linearly with substrate count.**
   The Reduction Gear spec named this explicitly: "the CEO cannot *see*
   what's happening across procedural + A2A + specialist invocations +
   gates + evidence with one query, in one view, on one timeline." That
   surface is the cost of accreted substrate.

## When skipping Phase 0 is acceptable

- **The new substrate is genuinely orthogonal.** If you're adding a
  surface that has zero overlap with existing primitives (rare), there
  is nothing to consolidate first. The default assumption is that this
  is wrong — verify before believing it (see
  `verify-substrate-before-proposing-new`).
- **The existing substrate is already clean.** If a recent audit
  confirmed the fragmentation isn't there, you can ship Phase 1 first.
  Cite the audit in the PR.
- **Genuinely urgent fix.** A security-critical addition can ship before
  cleanup if the cleanup would block the fix. File the Phase 0 cleanup
  as a follow-up BI in the same PR, with a clear merge target — and
  honor it.

## How cleanup discipline interacts with the discovery / naming pair

This principle is part of a three-step progression:

1. **`verify-substrate-before-proposing-new`** — discovery: does the
   thing I want to add already exist? (Answer: probably yes.)
2. **`substrate-cleanup-before-substrate-addition`** (this one) —
   sequencing: even if a new layer is justified, consolidate the
   existing substrate first.
3. **`schema-honesty-over-aspirational-naming`** — naming: name the new
   layer for what it holds, not what you hope it will hold.

A clean substrate addition runs all three. Missing any one produces a
recognizable failure mode in the resulting code.

## The contract

Before opening a PR that adds a new substrate layer:

1. **List the existing primitives the new layer will sit on or
   compose with.**
2. **Identify the fragmentation.** Are there N near-identical event
   shapes? N similar-purpose tables? N gate models?
3. **Decide what Phase 0 looks like.** Even if Phase 0 is "merge two
   activity tables into one," do it first.
4. **Land Phase 0 on its own.** The new addition depends on it; don't
   bundle.
5. **If Phase 0 is "no cleanup needed," document the audit.** Otherwise
   the discipline is satisfied by ceremony, not evidence.

## Anti-patterns

- A plan that goes straight to Phase 1 with the new addition and lists
  "refactor existing X" as Phase N+2 — that refactor will never ship.
- A new table that conceptually overlaps an existing one, shipped
  without merging or consolidating the older one.
- "We'll add the new shape, and consumers can migrate gradually" — most
  consumers won't migrate.
- Bundling cleanup and addition into one PR — review becomes
  unreviewable, rollback becomes impossible.

## Related principles

- [`verify-substrate-before-proposing-new`](verify-substrate-before-proposing-new.md) —
  paired discipline; discovery (does X exist?) precedes sequencing
  (cleanup before adding)
- [`schema-audit-before-features`](../../../professions/data-architect/wiki/schema-audit-before-features.md) —
  data-model-scoped sibling; this principle generalizes to all
  substrate, not just schema
- [`one-data-model`](../../../professions/data-architect/wiki/one-data-model.md) — the architectural reason
  fragmentation is expensive
- [`architecture-over-shortcuts`](architecture-over-shortcuts.md) — the
  refactoring budget posture this principle operationalizes (~80% refactor and
  integration since 2026-08-23)

## Spec references

- [Reduction Gear Architecture spec](../../../superpowers/specs/2026-05-24-reduction-gear-architecture-design.md) — §0 architect verdict, 20% refactor budget
- [Governed-upgrade plan](../../../superpowers/plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md) — Phase 0 consolidation
- [Founder kernel evolution discipline spec](../../../superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md) — §6.4 promotion record
