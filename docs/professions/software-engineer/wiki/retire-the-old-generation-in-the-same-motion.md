---
title: Retire the old generation in the same motion
pageKind: principle
status: published
abstract: Parallel change ends with the contract step — when a replacement pattern lands, the superseded code is deleted or reduced to an expiring alias in the same PR, and its tests move with it. Leaving both generations alive is the expand step of a migration that never finishes.
principleTier: core
principleDirection: Finish every replacement with its contract step — delete or alias-with-expiry the superseded code and relocate its tests in the same change; never leave two generations coexisting without a written coexistence argument.
principleDimensionVector: {"long_term_maintainability": 0.9, "human_cognitive_load": -0.6, "reusability": 0.5, "schema_grounding": 0.4, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - fowler/parallel-change
  - conventional-commits/spec
---

## Rule

Parallel change (expand → migrate → contract) is the craft's standard shape for replacing a contract without breaking consumers — and it is only a *migration* if the **contract step happens**. When you land a replacement (a new handler pattern, a new result type, a new module home), the same change either deletes the superseded code, or reduces it to a delegating alias with a stated expiry and a tracking anchor, and moves its tests to the new address. A replacement PR that leaves the old generation fully alive has performed the expand step and stopped — that is not a smaller migration, it is a permanent third pattern.

## Why

The expand step is where parallel change is *supposed* to pause mid-flight; the failure mode is making the pause permanent. On this platform the measured cost of stopped-at-expand: three coexisting MCP handler generations (packs + a 1,952-line legacy monolith + an abandoned one-file pattern), ~30 orphaned tests exercising subjects that moved out from under them, nine local `ActionResult` aliases, and two connector registries. Orphaned tests are the sharpest cost: they pass forever against the dead generation, manufacturing false confidence about code no caller runs.

## How to apply

Structure a replacement as expand→migrate→contract from the start, and put the contract step in the plan with an anchor before writing the expand step. If the migrate step is too large for one PR, land expand with the alias *and its expiry*, and make the contract PR's backlog item exist before merging — an alias without an expiry is a generation, not a bridge. In review, ask of any new-beside-old change: where is the delete, the expiring alias, or the written coexistence argument? Move tests with their subjects in the same commit; a test at the old address is part of the old generation.

## Decision dimensions

- `long_term_maintainability: 0.9` — finished migrations are what keep pattern count constant while the codebase grows.
- `human_cognitive_load: -0.6` — negative: one generation per concern removes the which-one-applies tax.
- `schema_grounding: 0.4` — the surviving generation is the one the schema and specs describe.
- `speed_to_value: -0.2` — the contract step is real scope in the landing PR.

## Related

- [[professions/software-engineer/code-review-standard]] — the coexistence question belongs in every review checklist.
- [[professions/software-engineer/semantic-versioning]] — expiring aliases are the in-repo form of a deprecation window.
