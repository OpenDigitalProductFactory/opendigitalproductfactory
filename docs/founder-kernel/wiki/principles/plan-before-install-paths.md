---
title: Plan Before Acting on Install/Seed/Template Paths
pageKind: principle
status: published
abstract: A symptom on one install is usually a defect for every install. Use writing-plans for anything touching setup, seeds, or shared templates.
principleTier: contextual
principleDirection: Plan before editing install / seed / template paths; the change ripples across every install.
principleDimensionVector: {"blast_radius": -0.7, "long_term_maintainability": 0.4, "governance_compliance": 0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - release
principlePublic: true
principlePublicRationale: Adopters need to know that DPF treats install / seed / template changes with extra care — every install inherits the change.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Before editing install scripts, seed files, or shared templates, write a plan. A symptom that surfaces on one install is usually a defect for every install — the change ripples across every existing and future install, so the design needs to be thought through before code lands. Use the `writing-plans` flow for these surfaces.

## Why

Install / seed / template paths have the largest blast radius of any code in the platform: a one-line edit in `packages/db/src/seed.ts` propagates to every fresh install going forward, and a poorly-thought-through change can corrupt downstream state in ways that only surface days later when an adopter hits the broken state. The planning step costs an hour and forces the implementer to think through migration paths, rollback, and idempotency before code lands. The cost asymmetry is what makes this contextual (the principle applies in a narrow set of code paths) but high-weight on `blast_radius` (the rare hit has a big impact).

## Applies To

In-platform coworkers and external coding agents touching install scripts, `packages/db/src/seed.ts`, founder-kernel content, kernel manifests, or shared templates. Does NOT apply to feature code that doesn't touch these surfaces — those have a normal commit cadence.

## How To Apply

When the change you're about to make touches an install / seed / template path, stop and write a plan in `docs/superpowers/plans/`. The plan covers what data shape changes, what the migration looks like, how fresh installs handle it, how existing installs handle it, and how rollback works if the change is wrong. Then implement against the plan. The `writing-plans` slash command produces the right format.

## Decision Dimensions

- `blast_radius: -0.7` — install / seed / template changes propagate to every install. This is the axis the principle exists to manage.
- `long_term_maintainability: 0.4` — planned changes age better than ad-hoc patches.
- `governance_compliance: 0.3` — the plan is the audit artifact that explains why the change was made.

## Examples

- **Positive:** Adding a new `principle` page kind required a plan document covering the schema migration, seed walker changes, lint detector additions, and UI surface — all reviewed before any code landed.
- **Counterexample:** A one-line edit to `seed.ts` that "just fixes the agent grant" without a plan. The fix works on the dev install but breaks fresh installs because the migration path wasn't thought through.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
