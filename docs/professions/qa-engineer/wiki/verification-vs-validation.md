---
title: Verification vs validation
pageKind: entity
status: published
abstract: Verification asks "are we building the product right?" (mostly static review against spec); validation asks "are we building the right product?" (dynamic execution against intended use). Both are required.
professionCompetencyLevel: foundational
sources:
  - wikipedia/verification-validation
  - wikipedia/software-testing
---

## Definition

The classic Boehm framing distinguishes two complementary questions:

- **Verification — "Are we building the product right?"** Predominantly a **static** process: reviews of artifacts and specifications, confirming each phase's output satisfies its input specification.
- **Validation — "Are we building the right product?"** A **dynamic** process requiring actual software execution, confirming the product satisfies intended use and customer needs.

## Why Both Are Required

Verification without validation can perfectly build the wrong thing — a system that flawlessly meets a specification nobody wanted. Validation without verification ships something roughly right but internally broken. QA owns both: confirm the build matches the spec **and** that the spec serves the user.

## How DPF Coworkers Use It

- Classify each quality activity: a code review or spec check is verification; running the feature against a user scenario is validation.
- The [[professions/qa-engineer/test-levels]] map onto this — acceptance testing leans validation; unit testing leans verification.
- Validation depends on reproducible behavior — see [[professions/qa-engineer/defect-needs-reproduction]].

## See Also

- [[professions/qa-engineer/test-levels]]
- [[professions/qa-engineer/defect-needs-reproduction]]
