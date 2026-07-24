---
title: All Changes Land via PR Against Main
pageKind: principle
status: published
abstract: No direct pushes; every change lands via PR against main, and opening a PR means the branch is ready to merge.
principleTier: commandment
principleDirection: Land every change via PR review against main; never push directly; never open a PR before the branch is ready to merge.
principleDimensionVector: {"governance_compliance": 1.0, "blast_radius": -0.6, "evidence_density": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
principlePublic: true
principlePublicRationale: Adopters need to see DPF's governance posture — even the maintainer follows the PR-review contract; the platform's audit chain depends on it.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Every change lands via PR against `main` — including the maintainer's. Branch protection enforces it. No direct pushes, no admin-bypass merges, no "I'll fix it after." Every commit on `main` traces back to a PR; every PR traces back to a reviewed branch.

Opening a PR is also the ready-to-merge signal. A pushed branch, Work Capsule, or Build Studio build is the place for in-flight handoff and recovery. Do not open a PR as a parking place, early visibility marker, or draft handoff. GitHub draft PRs are not used in DPF's normal delivery lane: agents must open regular ready-for-review PRs and must not pass `--draft` to `gh pr create`. If an agent opens a PR before the branch has passed the relevant build, migration, and UX gates, close the PR and keep the branch alive. If an agent accidentally opens a draft PR after gates are green, immediately mark it ready for review so CI and operator review stay visible in the normal PR lane.

## Why

PR review is the cheapest cross-check the platform has. Two minutes of a reviewer's eyes catches the wrong-file edit, the off-by-one, the secret accidentally committed, the migration that doesn't roll back. Direct pushes skip that check entirely and trade a known-bounded cost (PR review latency) for an unknown-bounded one (cost of the defect that slipped through). The PR audit chain also makes the codebase's history readable: every change has a description, a discussion, a CI run, and a merge timestamp — that's the operational evidence DPF's compliance and on-call posture both depend on.

## Applies To

In-platform coworkers (Build Studio's feature PRs), external coding agents (Claude / Codex working on the repo), and humans (including the maintainer). Symmetric. Applies to feature work, bug fixes, documentation, configuration, and dependency bumps. Does NOT apply to operational hot-fixes during a confirmed production incident with the incident-response runbook engaged — and those exceptions get a post-incident audit PR within the same business day.

## How To Apply

Create a topic branch named by intent: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `doc/<slug>`, `clean/<slug>`. Push the branch whenever useful so work is backed up and visible. Keep using the branch or Work Capsule while the work is not merge-ready. Open the PR only after the author has run the relevant checks, captured required evidence, and believes merge automation may act on it. Let CI run. Get review (human, automated, or both). Merge with squash-and-delete. Never `git push origin main` directly. Never `gh pr merge --admin` to bypass review. When a change is too small to justify the ceremony, the PR description can say so — the ceremony is still cheap and the audit value is the point.

## Decision Dimensions

- `governance_compliance: 1.0` — this principle IS the platform's primary governance gate. Maximum weight.
- `blast_radius: -0.6` — PR review catches mistakes before they reach production; direct pushes have unbounded blast radius.
- `evidence_density: 0.5` — every PR is durable evidence (description, discussion, CI run, diff) that makes the codebase auditable months later.

## Examples

- **Positive:** A typo fix in a README still lands via PR. The PR description says "typo fix"; CI runs; the merge happens via squash-and-delete. The PR record is permanent evidence that the change was reviewed.
- **Positive:** A coding agent pushes `feat/work-capsule-phase-1` after each verified commit but leaves PR creation until the branch has passed focused tests, typecheck, production build, migration apply, and the affected UI smoke.
- **Counterexample:** A maintainer pushes a "trivial" change directly to `main` because it's "just a comment." Three weeks later someone tries to find when that comment changed and which discussion drove it; the git blame points at a commit with no PR, no description, and no review — the audit chain is broken for that line.
- **Counterexample:** An agent opens a draft PR merely to show progress. The PR is easy for the operator to miss, and unfinished work sits outside the normal merge lane without the expected ready-for-review signal. The correct handoff artifact was the pushed branch or Work Capsule, not a PR.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
