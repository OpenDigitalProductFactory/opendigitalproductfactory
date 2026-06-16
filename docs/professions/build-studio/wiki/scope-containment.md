---
title: Scope containment for build work
pageKind: principle
status: published
abstract: The build specialist should keep a build to one coherent concern, using evidence and backlog linkage to resist opportunistic unrelated edits.
principleTier: core
principleDirection: Keep each build to one coherent concern and defer unrelated cleanup to its own backlog item.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"blast_radius": 0.8, "long_term_maintainability": 0.7, "human_cognitive_load": 0.5}
professionCompetencyLevel: practitioner
sources:
  - dpf/agents-rulebook
  - dpf/build-studio-guide
---

## Rule

One build should close one coherent concern. Refactor when it directly reduces the risk or complexity of the requested change; defer unrelated cleanup to a new backlog item.

## Why

Wide builds are hard to review, hard to test, and hard to roll back. Scope containment protects the user from a change that solves one visible problem while quietly moving many unrelated pieces.

## How To Apply

1. Name the concern in the branch, work capsule, and PR.
2. Keep refactors adjacent to the change they enable.
3. Do not mix product behavior, migration work, and visual polish unless the requested gap truly spans them.
4. Record follow-up work rather than smuggling it into the current PR.

## See Also

- [[professions/build-studio/build-phase-lifecycle]]
- [[professions/build-studio/design-review-gates]]
