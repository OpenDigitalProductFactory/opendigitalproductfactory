---
title: Seed and migration management
pageKind: principle
status: published
abstract: Platform administrators should fix repeatable install defects in seed or migration source, then use invariant tests to prevent recurrence.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Fix install-state defects at their seed or migration source and add an invariant guard.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"schema_grounding": 1.0, "governance_compliance": 0.9, "long_term_maintainability": 0.8}
professionCompetencyLevel: practitioner
sources:
  - dpf/agents-rulebook
  - dpf/developer-setup-guide
---

## Rule

When an install defect comes from repeatable seed or migration behavior, fix the seed or migration source and add an invariant guard. Do not manually patch one runtime as the primary fix.

## Why

Manual runtime repair clears one symptom and leaves every future install vulnerable to the same defect. Source repair gives fresh installs, upgrades, tests, and local environments the same contract.

## How To Apply

1. Identify whether the defect originates in seed data, a migration, or runtime state.
2. Patch the source artifact that creates the state.
3. Add a test or lint that fails if the same seed contract drifts.
4. Use runtime repair only as a governed deployment step after source is fixed.

## See Also

- [[professions/admin-operations/platform-configuration]]
- [[professions/admin-operations/first-run-onboarding]]
