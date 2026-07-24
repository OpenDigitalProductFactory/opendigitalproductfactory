---
title: Schema honesty over aspirational naming
slug: schema-honesty-over-aspirational-naming
pageKind: principle
status: published
abstract: Name columns, types, and models for what they hold today. Defer aspirational names until the substrate actually carries the aspirational meaning. A misnamed schema misleads every reader and every consumer.
principleTier: core
principleDirection: Name columns, types, and models for what they hold today; defer aspirational names until the substrate actually carries the aspirational meaning.
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.7, "evidence_density": 0.5, "human_cognitive_load": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: universal
principleConsumerContexts:
  - data-model
  - engineering-flow
principleRingScope:
  - ring-2-workflow
  - ring-3-archetype
principlePublic: false
authoredAt: 2026-05-24
authoredBy: mark-bodman
---

# Schema honesty over aspirational naming

**A column, type, model, or API field name is a promise about what it
contains. If the name promises more than the substrate currently holds,
every reader misreads it and every consumer codes against the promise
rather than the reality.**

Defer aspirational names until the substrate actually carries the
aspirational meaning. A column named `currentSha` that holds a SHA is
honest. A column named `currentVersion` that also holds only a SHA is a
lie waiting to confuse the next reader.

## What "schema honesty" looks like

- A column that stores a Git SHA today and may store semantic versions
  later is named `currentSha` today, not `currentVersion`. The rename
  happens in the PR that actually changes what the column holds.
- A model named `StorefrontArchetype` that genuinely stores
  archetype-bootstrap data stays `StorefrontArchetype`. The runtime
  capability calibration that would live elsewhere gets its own table
  (`ArchetypeCapabilityProfile`), not a JSON blob hidden inside the
  bootstrap model.
- An enum value `pending_review` that currently means "waiting for
  human" is named `pending_review`, not `pending_triage`, until the
  triage workflow actually exists.

## Why this exists

Two concrete examples from the platform's recent work:

- **Governed-upgrade plan** (PR #1076) explicitly kept SHA-named columns
  (`currentSha`, `targetSha`) until the substrate would carry versions.
  The Phase 2 versioning work renames in the same PR that introduces
  version semantics — not before.
- **Reduction Gear Architecture** (PR #1075) explicitly rejected
  smuggling runtime-evolving capability data into the existing
  `StorefrontArchetype` JSON fields. The spec proposes a separate
  `ArchetypeCapabilityProfile` association table so the bootstrap-template
  model keeps its honest scope, and the runtime calibration data gets a
  name that reflects what it is.

The misnamed-schema alternative — pick the aspirational name now to
"save a rename later" — produces three predictable failure modes:

1. **Every reader gets the wrong mental model.** A code reviewer reads
   `currentVersion` and reasons about version semantics; the actual data is
   a SHA, and the reasoning is wrong.
2. **Consumers write code against the name, not the truth.** A future
   service that depends on `currentVersion` being a semantic version
   breaks the day a SHA shows up in the field. The schema lies; the
   consumer crashes.
3. **The rename you "saved" still happens.** When the substrate finally
   carries the aspirational meaning, the column has to change either
   way — and now it has consumers built on the wrong assumption.

## When aspirational naming is acceptable

- **Greenfield models with no consumers yet.** A new `ReleaseManifest`
  table that ships with no readers can be named for its full intended
  shape, because there are no current consumers to mislead.
- **External standards.** If the data is a OAGIS / FHIR / OTel
  attribute name, the standard's naming wins — schema honesty defers
  to standards-alignment, not the other way around.
- **A documented "this will hold X within N weeks" plan.** If a PR
  description names the rename's trigger (e.g. "rename to
  `currentVersion` in Phase 2 of `EP-PLATFORM-UPGRADE` when semver
  semantics land"), the aspirational name is acceptable because the
  honesty restoration is scheduled.

## The contract

Before naming any column, type, model, or API field:

1. **Name what it holds today.** Not what you hope it will hold.
2. **If the future name is different, document the rename trigger.** In
   the spec or PR description, not as a `// TODO` comment.
3. **Default to the SHA-name pattern.** Columns named for the literal
   shape of the data they hold (SHA, URL, slug, timestamp) age better
   than columns named for abstractions (version, identifier, name).

## Anti-patterns

- Naming a column `version` when it stores a SHA.
- Naming a table `Workflow` when it stores BuildStudio phase runs only
  (call it `BuildPhaseRun` until it generalizes).
- Naming an enum value for the future workflow stage instead of the
  current state.
- A schema field that stores `null` today because "we'll fill it in
  Phase 2" — either drop the field or document the trigger.

## Related principles

- [`mirror-dont-migrate`](mirror-dont-migrate.md) — paired discipline;
  the mirror should be named honestly too
- [`strongly-typed-string-enums`](../../../professions/data-architect/wiki/strongly-typed-string-enums.md) — type
  shape discipline; this is the name-meaning counterpart
- [`single-source-of-truth`](single-source-of-truth.md) — the
  architectural reason names must be honest

## Spec references

- [Governed-upgrade plan](../../../superpowers/plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md) — SHA-naming decision
- [Reduction Gear Architecture spec](../../../superpowers/specs/2026-05-24-reduction-gear-architecture-design.md) — StorefrontArchetype scope decision
- [Founder kernel evolution discipline spec](../../../superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md) — §6.2 promotion record
