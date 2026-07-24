---
title: Mirror, don't migrate
slug: mirror-dont-migrate
pageKind: principle
status: published
abstract: When evolving substrate, mirror the canonical source into a runtime model and derive consumers from the mirror — rather than destructively replacing the canonical source with a new schema.
principleTier: core
principleDirection: Mirror canonical source data into a runtime model and derive consumers from the mirror, rather than destructively replacing the canonical source with a new schema.
principleDimensionVector: {"long_term_maintainability": 0.8, "blast_radius": -0.7, "schema_grounding": 0.6, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: route-domain-specific
principleConsumerContexts:
  - data-model
  - engineering-flow
principleRingScope:
  - ring-3-archetype
  - ring-4-sandbox-prod
principlePublic: false
authoredAt: 2026-05-24
authoredBy: mark-bodman
---

# Mirror, don't migrate

**When you need to evolve substrate, prefer adding a runtime mirror that
reads from the canonical source and exposes a typed surface, over
destructively replacing the canonical source with a new schema.**

The mirror pattern keeps the old source authoritative through the
transition, lets new consumers read from the typed runtime surface, and
defers the cutover decision until evidence supports it.

## What "mirror, don't migrate" looks like

- **Phase 0:** identify the canonical source (a JSON file, an env var, an
  existing table, a third-party API). Don't touch it.
- **Phase 1:** add a runtime model (a Prisma row, a derived API endpoint,
  a typed in-memory cache) whose only job is to reflect the canonical source.
  Updates flow `source → mirror`. Reads happen against the mirror.
- **Phase 2:** migrate consumers one at a time to read from the mirror.
  The canonical source stays authoritative throughout.
- **Phase 3 (optional, often never):** once every consumer reads from the
  mirror and writes against it, retire the canonical source on a deliberate
  cutover, not as a side effect of the new code landing.

## Why this exists

Two concrete examples from the platform's recent history:

- **Governed-upgrade Phase 1** (PR #1076): `version.json` is the canonical
  source for the installed bundle. Phase 1 added a `PlatformConfig.bundleSha`
  mirror updated on platform boot, exposed `/api/platform/version`, and
  surfaced a UI surface — without touching `version.json`'s role as the
  source of truth on disk. A future Phase 2 can move to DB-authoritative,
  but not until the mirror has shown it can serve every consumer.
- **Reduction Gear Architecture** (PR #1075): `GearInterface` is proposed
  as a dual-emit envelope alongside existing event tables
  (`ToolExecution`, `BuildPhaseRun`, `RuntimeVerification`), NOT as a
  replacement. The existing tables remain authoritative for their owning
  surfaces; GearInterface becomes the common operator timeline only after
  emitters prove correctness, retention, and Cockpit usability.

The migrate-destructively alternative — drop the old table, point all
consumers at the new one in one PR — produces three predictable failure modes:

1. **Lost evidence.** Operator data living in the old table is gone
   the moment the migration drops it. Recovery costs hours.
2. **Atomic-PR blast radius.** Every consumer must change in the same PR,
   so review takes longer, rollback is harder, and one missed call site
   breaks the platform.
3. **No graceful fallback.** If the new schema turns out to need a column
   that wasn't anticipated, you have to migrate again on top of a
   half-functional substrate.

## When mirroring is the wrong default

- **Bug-fix migrations.** If the canonical source has a defect that
  every consumer experiences, fix the source — don't mirror the bug into
  a runtime layer.
- **Tiny consumers (< 3 call sites).** The mirror overhead isn't worth it
  for a one-shot rewrite where the cutover is mechanical.
- **Schema changes the framework requires.** Prisma column renames, for
  instance, are physical — there is no mirroring possible around them.
  Pair with `schema-honesty-over-aspirational-naming` so the name change
  doesn't smuggle new meaning into the rename.

## The contract

Before opening a PR that replaces an existing source of truth, ask:

1. **Who is the current canonical source?** Name it.
2. **Why must I replace it rather than mirror it?** Document the reason.
3. **What evidence do I have that the mirror is unworkable?** A claim of
   "easier to just migrate" is not evidence.
4. **What's the rollback path?** If you can't draw a one-line rollback for
   the destructive option, the mirror is the architecturally sound choice.

## Anti-patterns

- "I'll just drop the old table and rebuild from this new one" without
  evidence that every consumer is moved.
- A new schema named for the future state, populated by a destructive
  migration from the old one, with no fallback.
- "We'll just deprecate the old API in this PR" — deprecation without a
  mirror means the deprecation is the cutover.

## Related principles

- [`schema-honesty-over-aspirational-naming`](schema-honesty-over-aspirational-naming.md) —
  paired discipline; the mirror should be named for what it carries today,
  not the aspirational future shape
- [`one-data-model`](../../../professions/data-architect/wiki/one-data-model.md) — the architectural reason
  ("not two integrated"); this principle is the migration-time pattern that
  honors it through the transition
- [`never-wipe-db-for-code-fixes`](never-wipe-db-for-code-fixes.md) —
  destructive substrate change is the extreme case; this principle is the
  general posture

## Spec references

- [Reduction Gear Architecture spec](../../../superpowers/specs/2026-05-24-reduction-gear-architecture-design.md) — §3.1, §4 dual-emit strategy
- [Founder kernel evolution discipline spec](../../../superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md) — §6.1 promotion record
