---
title: Build Gate (Mandatory)
pageKind: principle
status: published
abstract: Work is not complete until unit tests pass, the production build succeeds, UX is verified, and any new migration applies cleanly.
principleTier: commandment
principleDirection: Pass all four Build Gate checks before declaring work complete.
principleDimensionVector: {"governance_compliance": 0.9, "evidence_density": 0.8, "blast_radius": -0.6, "long_term_maintainability": 0.55, "evidence_confidence": 0.65}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - release
principlePublic: true
principlePublicRationale: Adopters need to know that DPF treats "done" as evidence-passed, not claim-made — the Build Gate is the contract everything else relies on.
sources:
  - frameworks/it4it-v3
---

## Rule

Work is not complete until all four checks pass:

1. **Unit tests** — affected files green via the workspace-pinned test runner.
2. **Production build** — `next build` (or the relevant workspace's build) clean with zero errors.
3. **UX verification** — for any UI / agent / coworker / workflow / form change, exercise the affected path against the running Docker-served app.
4. **Migration applies cleanly** — if a migration was added, it applies on a fresh DB without error.

TypeScript errors only surface in the production build (vitest and the IDE both miss some classes); a green vitest run is not sufficient evidence on its own.

## Why

"Done" without evidence is a claim, not a state. The Build Gate is the platform's contract for converting claims into verifiable states — once all four checks pass, the change is known to compile, test, render, and migrate. Skipping any one of them is how regressions reach production: a passing test suite that hides a build failure, a clean build that ships a broken UI, a green migration check that ignored the missing backfill. The four checks together cost minutes per PR and save days per incident; the cost asymmetry is what makes this commandment-tier rather than optional discipline.

## Applies To

In-platform coworkers (Build Studio's pre-ship sandbox verification mirrors this gate), external coding agents (Claude / Codex must run all four before claiming completion), and humans operating the platform. Symmetric. Applies to feature work, bug fixes, refactors, and any change that touches code, schema, or running services. Does NOT apply to pure-text doc edits with no code touched — those have a doc-lint gate instead.

## How To Apply

Run the four checks in order; stop on the first failure and fix it before continuing. The pre-commit hook at `.githooks/pre-commit` enforces a typecheck on TypeScript files as a fast feedback loop; the full gate runs at PR open via CI and locally before push. When the build fails for reasons unrelated to your change (a pre-existing problem), note it in the PR and fix if feasible — don't defer it, that's how unrelated-failure technical debt accumulates. Build Studio's sandbox runs the same gate before any PR leaves the sandbox; if a Build-Studio-produced PR would fail CI typecheck, it never leaves the sandbox.

**Where each check runs matters.** Unit tests and typecheck can run in the topic worktree when the workspace shape allows. Production build, UX verification, and migration-apply checks run against the canonical install (root clone or a governed shared nonprod environment), per [`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md). A check that cannot run in the worktree because of harness limitations (missing pnpm/corepack on PATH, broken workspace symlinks, missing generated Prisma client, Next/Turbopack rejecting cross-workspace symlinks) is a **harness finding, not a product failure**: capture canonical-install verification evidence in the PR and file the harness gap as a separate platform BI rather than treating the worktree limitation as a build-gate failure.

## Decision Dimensions

- `governance_compliance: 0.9` — the Build Gate IS the platform's primary done-state contract.
- `evidence_density: 0.8` — each of the four checks produces durable artifacts (test report, build log, screenshots/recording, migration trace) that auditors and on-call can read months later.
- `blast_radius: -0.6` — the gate is what keeps regressions from reaching production; skipping it expands the blast radius of every change.

## Examples

- **Positive:** A PR adds a new lint detector. The author runs `pnpm --filter web exec vitest run lib/wiki/lint-detectors.test.ts`, then `pnpm --filter web build`, then rebuilds the portal and confirms the new lint finding kind appears at `/admin/wiki/lint`. The PR description lists all three checks. Reviewer trusts the evidence.
- **Counterexample:** A PR ships with "tests pass locally" in the description but no build run. Code is merged. The next morning, CI fails on `main` because the change introduced a TypeScript error that vitest does not catch. The team spends an hour reverting and re-shipping properly.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
