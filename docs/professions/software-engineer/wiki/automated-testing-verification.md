---
title: Verify with automated tests and disciplined review
pageKind: principle
status: published
abstract: Code is verified by correct, well-designed automated tests and by review focused on overall code health. Error and exceptional paths are tested, not just the happy path.
principleTier: core
principleDirection: Require correct automated tests (including error/edge paths) and review that improves overall code health.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.8, "evidence_density": 0.7}
professionCompetencyLevel: foundational
sources:
  - google/eng-practices
  - owasp/top-ten
---

## Rule

A change is verified by automated tests that are correct and well-designed, and by review that assesses whether the change improves the overall health of the codebase. Tests cover error and exceptional paths, not only the happy path.

## Why

Google's code-review standard frames review as a code-health decision: a reviewer should **approve a change once it definitely improves overall code health**, even if it is not perfect, and one of the things review checks is whether the code **has correct, well-designed automated tests**. Reviewers should not demand perfection; optional polish is marked as a nit, and technical facts override personal preference.

The OWASP Top 10:2025 reinforces testing the unhappy paths: **A05 Injection** and **A10 Mishandling of Exceptional Conditions** both manifest where error and edge handling go untested.

## How To Apply

1. **Test the contract, including failure.** Cover invalid input, exceptional conditions, and boundaries — the paths where security defects live.
2. **Review for health, not perfection.** Approve once the change clearly improves the codebase; capture optional improvements as nits.
3. **Let facts decide.** Resolve disagreement with engineering principles and the style guide, not preference — see [[professions/software-engineer/code-review-standard]].

## See Also

- [[professions/software-engineer/code-review-standard]]
- [[professions/software-engineer/secure-coding-no-injection-validate-input]]
