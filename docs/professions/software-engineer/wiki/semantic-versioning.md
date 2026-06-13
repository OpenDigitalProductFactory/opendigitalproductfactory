---
title: Communicate compatibility with Semantic Versioning
pageKind: principle
status: published
abstract: Release versions follow MAJOR.MINOR.PATCH so the version number itself communicates compatibility. MAJOR signals incompatible changes, MINOR backward-compatible features, PATCH backward-compatible fixes.
principleTier: core
principleDirection: Version every released artifact as MAJOR.MINOR.PATCH and increment by the compatibility meaning of the change, never arbitrarily.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.8, "human_cognitive_load": 0.6}
professionCompetencyLevel: foundational
sources:
  - semver/spec
---

## Rule

Version released software as **MAJOR.MINOR.PATCH** per Semantic Versioning 2.0.0. The version string is a compatibility contract, not a marketing number.

## Why

SemVer requires that a version take the form X.Y.Z, each a non-negative integer without leading zeroes, and that the increment encode the nature of the change:

- **MAJOR** — incremented for incompatible API changes.
- **MINOR** — incremented for backward-compatible added functionality.
- **PATCH** — incremented for backward-compatible bug fixes.

Two further requirements make the contract trustworthy: software using SemVer **MUST declare a public API**, and a released version **MUST NOT be modified** — any change ships as a new version. Consumers can then depend on a range with confidence.

## How To Apply

1. **Declare the public API.** What is in-contract must be explicit, so "incompatible" is decidable.
2. **Let the change pick the bump.** A breaking change is MAJOR even if it feels small; a new optional feature is MINOR; a fix is PATCH.
3. **Never re-release a version.** Re-cut, do not mutate.
4. **Drive the bump from commits** — see [[professions/software-engineer/conventional-commits]], which maps commit types onto SemVer increments.

## See Also

- [[professions/software-engineer/conventional-commits]]
- [[professions/software-engineer/api-design-http-semantics]]
