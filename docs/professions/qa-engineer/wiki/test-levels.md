---
title: Test levels — unit, integration, system, acceptance
pageKind: entity
status: published
abstract: Testing is organized into levels — unit/component, integration, system, and acceptance — each catching a distinct class of fault. Coverage at one level does not substitute for another.
professionCompetencyLevel: foundational
sources:
  - wikipedia/software-testing
---

## Definition

Software testing is organized into **levels**, each exercising the system at a different scope and catching a different class of fault:

- **Unit / component** — isolated source code is tested to validate expected behavior of the smallest testable parts.
- **Integration** — multiple components, modules, or services are exercised together to verify they work when combined.
- **System** — testing conducted on a complete, integrated software system, end to end.
- **Acceptance** — system-level testing to ensure the software meets customer expectations.

## Why Levels Matter

Each level catches faults the others miss: a unit test cannot find an interface mismatch between two services, and a system test is too coarse to localize a logic error in one function. **Coverage at one level does not substitute for another** — a healthy suite spreads effort across levels, weighted by the [[professions/qa-engineer/test-automation-pyramid]].

## How DPF Coworkers Use It

- Place a new test at the lowest level that can catch the fault it targets.
- Use the level vocabulary when reasoning about a gap ("this is an integration risk, not a unit risk").
- Pair with [[professions/qa-engineer/verification-vs-validation]] to ask whether a level is checking "built right" or "right thing."

## See Also

- [[professions/qa-engineer/test-automation-pyramid]]
- [[professions/qa-engineer/verification-vs-validation]]
