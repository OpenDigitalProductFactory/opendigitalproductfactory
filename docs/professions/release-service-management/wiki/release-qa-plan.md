---
title: Every Release Passes the QA Test Plan
pageKind: principle
status: published
abstract: Each release passes the 15-phase QA plan at tests/e2e/platform-qa-plan.md. next build and unit tests do not replace UX exercise.
principleTier: core
principleDirection: Run the affected QA phases as part of the definition of done; never substitute build success for UX evidence.
principleDimensionVector: {"evidence_density": 0.8, "governance_compliance": 0.6, "blast_radius": -0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-4-sandbox-prod
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Adopters need to know DPF treats UX verification as release evidence — silent UI regressions are caught here, not in production.
sources:
  - frameworks/it4it-v3
---

## Rule

Every release passes the QA test plan at `tests/e2e/platform-qa-plan.md` (15 phases). For feature work, run the affected phases as part of the definition of done — `next build` and unit tests do not replace UX exercise. Failures get a backlog item with reproduction steps filed under the active QA epic. Test results are release evidence and are archived.

## Why

Compile success doesn't catch UI regressions, agent flow regressions, form-validation regressions, or any failure mode that only appears under real user interaction. The Build Gate's UX-verification check is the first defense; the QA test plan is the second, structured one — 15 phases covering distinct platform surfaces. Releases that skip the affected QA phases ship with regressions adopters discover before the team does, which costs everyone more than the QA pass would have.

## Applies To

In-platform coworkers running pre-release verification, external coding agents authoring features that touch user-facing surfaces, and humans approving release candidates. Symmetric. Applies to every release that touches UI, forms, agent flows, workflows, or external integrations. Does NOT apply to silent-fix patches with no user-visible surface — those still pass the Build Gate but skip the user-facing QA phases.

## How To Apply

For feature work, identify which of the 15 QA phases the change touches and run them locally against the Docker-served portal before opening the release PR. Document the result in the PR description: which phases passed, which failed, what reproduction steps surface the failure. When a phase fails, file a backlog item under the active QA epic with the repro steps so the failure gets owned, not silently deferred. Release evidence (test results, screenshots/recordings, failure backlog items) is archived alongside the release.

## Decision Dimensions

- `evidence_density: 0.8` — UX-exercise evidence is the densest evidence release governance has; unit-test results don't replace it.
- `governance_compliance: 0.6` — the QA plan is the structured contract between release engineering and the wider platform.
- `blast_radius: -0.5` — releases that ship UX regressions reach every adopter; the QA plan contains that blast radius.

## Examples

- **Positive:** A release that touched Build Studio's plan-phase agent runs the affected QA phases (plan-phase UX, agent-chat flow, evidence recording). Two phases pass on first run; one fails with a console error; backlog item filed; the failure is fixed before the release ships.
- **Counterexample:** The same release ships with "tests pass and `next build` is clean" as the only evidence. Adopters hit a plan-phase agent crash on their next build; support tickets pile up; the team retrospects and discovers the QA plan wasn't run.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
