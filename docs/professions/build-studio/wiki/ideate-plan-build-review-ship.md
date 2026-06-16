---
title: Ideate, plan, build, review, ship
pageKind: summary
status: published
abstract: The Build Studio loop separates discovery, design, implementation, verification, and promotion so each phase can use the right evidence and authority boundary.
professionCompetencyLevel: foundational
sources:
  - dpf/build-studio-guide
---

## Pattern

Build Studio uses a staged loop:

1. Ideate frames the user problem and desired outcome.
2. Plan turns that outcome into a scoped implementation path.
3. Build changes source code and seed artifacts.
4. Review checks tests, UX, architecture, and operational risk.
5. Ship hands off only when the change is ready for governed promotion.

## Why It Matters

Each phase answers a different question. Mixing them together makes the coworker look busy while hiding missing evidence. The staged loop keeps human approval, code changes, and runtime validation legible.

## Build Specialist Checklist

- Keep the current phase visible in the work record.
- Avoid doing implementation work while the plan is still ambiguous.
- Preserve review evidence in the backlog item or PR.
- Do not ship a phase that still depends on unstated assumptions.

## See Also

- [[professions/build-studio/build-phase-lifecycle]]
- [[professions/build-studio/design-review-gates]]
