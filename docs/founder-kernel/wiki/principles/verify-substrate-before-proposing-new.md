---
title: Verify substrate before proposing new
slug: verify-substrate-before-proposing-new
pageKind: principle
status: published
abstract: Before proposing a new table, type, capability, or epic — grep live code and the backlog for the noun. The architecture is denser than first reads suggest.
principleTier: core
principleDirection: Grep the live codebase and query the live backlog for the candidate noun before proposing any new substrate; assume the substrate already exists until proven otherwise.
principleDimensionVector: {"reusability": 0.9, "long_term_maintainability": 0.8, "schema_grounding": 0.8, "evidence_density": 0.6, "speed_to_value": -0.1}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: false
authoredAt: 2026-05-18
authoredBy: mark-bodman
---

# Verify substrate before proposing new

**Before proposing a new table, type, capability, epic, or substrate
concept — grep the live codebase + the live backlog for the noun.**
DPF's architecture is denser than first reads suggest; the most common
reflex of "we'll need a new X" is wrong because X already exists.

## What to grep for, where

When tempted to propose a new substrate:

1. **Prisma schema**: `grep -n "model NameOfThing"
   packages/db/prisma/schema.prisma`. Many candidate "new tables" turn
   out to be columns or relations on existing models.
2. **Type unions / enums**: `grep -rn "type NameOfThing\|enum
   NameOfThing" packages/types/ apps/web/lib/`. Some "new states" are
   already values in existing string-union types.
3. **Backlog**: query the live backlog via `mcp__dpf__query_backlog` or
   `psql` for `Epic.title` / `BacklogItem.title` keyword matches.
   "New" epics often duplicate work already in flight.
4. **Capability registry** (`packages/db/data/...` JSON files): new
   "we need a capability for X" is usually a column / flag on existing
   `Capability` / `ServiceOffering` / `ModelProvider` rows.
5. **Spec frontmatter**: search `docs/superpowers/specs/` for the noun.
   Frequently the design decision has already been resolved in an
   `APPROVED` spec months ago.

## Why this exists

Concrete examples:

- "Let's add a `Backup` table" → `BackupRun` already existed in the
  schema (added in the same PR week) → caught before the migration
  draft
- "Let's add a `Capability.tier` enum" → `capabilityCategory` already
  carried the discriminator → renaming would have broken the
  routing-layer joins
- "Let's create an epic for restore wizard" → `EP-PLATFORM-BACKUP`
  already existed and had it as a backlog item

## The contract

Before writing a spec / plan that proposes new substrate:

1. **Grep first**, write second.
2. **Note the closest existing fit** in the spec — even if you're
   rejecting it, the reader needs to know why a new substrate is
   warranted.
3. **If existing substrate fits with minor extension** (a new column,
   a new enum variant, a new association table) — propose the
   extension, not a parallel substrate.
4. **If the existing fit is misnamed** for the new use, prefer
   renaming + extending over duplicating. Naming churn is cheap;
   parallel substrates are expensive forever.

## Anti-pattern

- Proposing `WorkItem` when `BacklogItem` already exists
- Proposing `JobStatus` when `Job.status` already exists with the
  needed values
- Proposing a new epic for work already tracked in an existing epic

## Related principles

- [`consult-specs-first`](consult-specs-first.md) — the design-time
  counterpart
- [`sweep-main-before-trusting-worktree-specs`](sweep-main-before-trusting-worktree-specs.md) —
  worktree specs can be stale; check origin/main for the actual state
- [`one-data-model`](../../../professions/data-architect/wiki/one-data-model.md) — the architectural reason this
  matters
