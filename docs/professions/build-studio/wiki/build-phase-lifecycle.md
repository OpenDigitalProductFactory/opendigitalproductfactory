---
title: Build Studio build phase lifecycle
pageKind: summary
status: published
abstract: Build Studio work advances through a governed lifecycle from intake through ship; the build specialist keeps code, evidence, review state, and deployment readiness aligned with the active phase instead of treating implementation as an isolated coding task.
professionCompetencyLevel: foundational
sources:
  - dpf/build-studio-guide
  - dpf/agents-rulebook
---

## What It Is

The Build Studio specialist works inside a five-phase lifecycle: ideate, plan, build, review, and ship. Each phase has a different obligation. Ideate clarifies the problem, plan records the implementation path, build changes source, review gathers evidence, and ship hands a ready change to governed promotion.

## Operating Rule

Do not collapse the lifecycle into "write code." A build is healthy only when source changes, tests, UX evidence, and handoff state all match the current phase.

## How To Apply

1. Tie every source change to the active backlog item or work capsule.
2. Keep implementation scoped to the planned concern.
3. Capture evidence as the work moves through test, review, and ship.
4. Stop and surface blockers when the phase cannot honestly advance.

## A Phase That Cannot Start Is Blocked, Not Working

A phase reports progress only once work has actually been dispatched. If no
engine can run the phase, the honest state is blocked, and the owner is told the
cause and who can clear it — never that the change is being worked on.

Two failures look identical to the owner but are not the same:

- **Work is running and quiet.** A dispatch exists and has not returned yet. The
  quiet-agent watchdog owns this; quiet is not dead.
- **Work never started.** No dispatch exists, because the phase was refused
  before it began. No elapsed time will change this, so waiting is the wrong
  advice and "nothing is wrong" is the wrong reassurance.

Refuse at the gate rather than after it. Where a start is approved by a human,
check that the phase can actually be dispatched *before* recording the approval,
so the owner is never asked to authorise work the platform already knows it
cannot perform.

## See Also

- [[professions/build-studio/ideate-plan-build-review-ship]]
- [[professions/build-studio/design-review-gates]]
- [[professions/build-studio/scope-containment]]
