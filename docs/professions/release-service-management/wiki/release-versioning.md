---
title: Release versioning
pageKind: principle
status: published
abstract: Version every release with SemVer — MAJOR for incompatible changes, MINOR for backward-compatible features, PATCH for backward-compatible fixes. Pre-release tags rank below stable; build metadata is ignored for precedence. The version is the contract that drives a subscriber's accept/hold decision.
principleTier: core
principleDirection: Version every release as SemVer by compatibility impact; never reuse or mis-rank a version, because subscribers decide on it.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.7, "human_cognitive_load": 0.5}
professionCompetencyLevel: practitioner
sources:
  - semver/spec
---

## Rule

Version every release with **Semantic Versioning**, incrementing by the compatibility impact of the change:

- **MAJOR** — incompatible (breaking) API changes.
- **MINOR** — backward-compatible new features.
- **PATCH** — backward-compatible bug fixes.

Precedence rules: **pre-release tags** (e.g. `-rc.1`) rank below the corresponding stable release and signal possible instability; **build metadata** (`+build`) MUST be ignored when determining precedence.

## Why It Is a Release Concern

The version is the **contract** that drives a subscriber's accept/hold decision. A mis-ranked or reused version misleads consumers about risk — a "patch" that actually breaks compatibility will be auto-accepted and break downstream systems.

## How To Apply

1. **Let the change pick the bump** — a breaking change is MAJOR even if small.
2. **Never reuse a version**; re-cut, don't mutate.
3. **Feed the acceptance heuristic** — see [[professions/release-service-management/subscription-release-acceptance]].
4. The version is one of the three required [[professions/release-service-management/release-gate-package]] artifacts.

## See Also

- [[professions/release-service-management/release-gate-package]]
- [[professions/release-service-management/subscription-release-acceptance]]
