---
title: Risk-based testing and shift-left
pageKind: principle
status: published
abstract: Allocate test depth by risk — business impact, not uniform coverage — and move quality and security checks earlier in the lifecycle so feedback is fast and defects are caught before they compound.
principleTier: core
principleDirection: Prioritize test effort by business impact and run checks as early as possible; do not gate quality only at the end.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"evidence_density": 0.7, "public_safety": 0.6, "speed_to_value": 0.6}
professionCompetencyLevel: practitioner
sources:
  - wikipedia/software-bug
  - owasp/wstg
  - fowler/test-pyramid
---

## Rule

Allocate testing effort by **risk**, and move quality and security checks **earlier** ("shift left") rather than treating them as a final gate.

## Why

- **Prioritize by impact.** Severity and priority are managed separately, so test prioritization must weigh business impact, not just defect count — see [[professions/qa-engineer/severity-vs-priority]].
- **Shift security left.** OWASP frames web security testing as a framework of best practices integrated across the lifecycle by testers and organizations — not a one-time pass before release.
- **Fast feedback.** Structure suites (per the [[professions/qa-engineer/test-automation-pyramid]]) so fast tests run first and reveal breakage immediately.
- **Reproducibility enables triage.** The first step in locating a bug is to reproduce it reliably — see [[professions/qa-engineer/defect-needs-reproduction]].

## How To Apply

1. **Tier by risk.** Give high-impact, high-exposure areas deeper coverage; do not spread effort uniformly.
2. **Move checks earlier.** Lint, unit tests, and security scans run in development, not just pre-release.
3. **Order for speed.** Fast tests gate early in the pipeline; slow end-to-end tests run later.

## See Also

- [[professions/qa-engineer/test-automation-pyramid]]
- [[professions/qa-engineer/security-testing-strategy]]
- [[professions/qa-engineer/severity-vs-priority]]
