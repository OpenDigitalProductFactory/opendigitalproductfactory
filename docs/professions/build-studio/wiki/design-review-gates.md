---
title: Design review gates
pageKind: principle
status: published
abstract: A Build Studio specialist should treat design review as a gate on scope, architecture, UX fit, risk, and evidence, not as a decorative review note after code is already finished.
principleTier: core
principleDirection: Review scope, architecture, UX fit, risk, and evidence before advancing a build phase.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.8, "long_term_maintainability": 0.7, "evidence_density": 0.7}
professionCompetencyLevel: practitioner
sources:
  - dpf/build-studio-guide
  - dpf/agents-rulebook
---

## Rule

Use design review as a real phase gate. Before a build advances, verify that the proposed change still matches the user request, preserves the architecture, fits the product UX, has an appropriate evidence plan, and avoids avoidable blast radius.

## Why

Most Build Studio failures are not raw coding failures. They are phase failures: unclear scope, mismatched architecture, missing verification, or a UI that technically works but does not belong in the product. A review gate catches those failures while they are still cheap to correct.

## How To Apply

1. Check the active backlog item and work capsule.
2. Confirm the design uses existing product patterns before adding new abstractions.
3. Inspect affected UI against DPF theme and report-kit rules.
4. Name required evidence before claiming the work is ready.

## See Also

- [[professions/build-studio/build-phase-lifecycle]]
- [[professions/build-studio/scope-containment]]
