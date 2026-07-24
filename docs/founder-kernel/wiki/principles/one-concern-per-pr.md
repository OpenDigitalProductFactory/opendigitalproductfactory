---
title: One Concern Per Branch, One Concern Per PR
pageKind: principle
status: published
abstract: Topic branches named by intent. Bundling unrelated changes makes review harder and rollback worse.
principleTier: core
principleDirection: Scope each branch and PR to one concern; bundle nothing extra.
principleDimensionVector: {"long_term_maintainability": 0.6, "governance_compliance": 0.5, "blast_radius": -0.5}
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
principlePublicRationale: Reviewers and adopters benefit from PRs that do one thing — the cost shows up at incident response and on every audit.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Each topic branch addresses one concern. Each PR addresses one concern. Branches named by intent: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `doc/<slug>`, `clean/<slug>`. When you find yourself making an unrelated change mid-PR, stash it for a separate branch rather than bundling.

## Why

Mixed-concern PRs cost more at every downstream stage: review takes longer because the reviewer has to context-switch, CI failures are harder to attribute, rollback becomes "we can't revert because it would lose the unrelated fix," and incident retro is harder because the timeline mixes concerns. The 20-percent refactoring budget exists so improvements get their own dedicated branches, not so they get smuggled into feature PRs. The discipline pays back on every audit, every revert, every "when did X change?" question.

## Applies To

In-platform coworkers, external coding agents, and humans. Symmetric. Applies to every branch and every PR. Does NOT apply to refactors that are genuinely prerequisites for the feature being shipped — those land in the same PR but get called out in the PR description's "Refactor budget retired" section.

## How To Apply

Before starting a branch, decide what the one concern is and name it explicitly in the branch slug. When tempted to bundle an unrelated improvement, stash it (`git stash push -m "unrelated <description>"`) and create a separate branch for it after the current PR opens. When a PR description starts to list multiple unrelated things, split it. Reviewers should reject mixed-concern PRs even when the changes individually look fine.

## Decision Dimensions

- `long_term_maintainability: 0.6` — single-concern PRs are easier to revert, audit, and reason about months later.
- `governance_compliance: 0.5` — PR review is more effective on focused scopes; the governance value of the gate compounds.
- `blast_radius: -0.5` — smaller PRs have smaller blast radius when they regress.

## Examples

- **Positive:** `feat/principles-batch-4b-core` lands 14 principle markdown files + AGENTS.md pointers + manifest bump. One concern: promoting AGENTS.md core-tier rules to the kernel. Every diff in the PR serves that one purpose.
- **Counterexample:** A branch called `fix/build-fix` that also "happened to clean up the routing module" while the author was in there. Reviewer can't tell which lines fixed the build and which lines are the cleanup; the revert "fixes the build but loses the routing improvement"; the audit asks "what changed in routing on 2026-05-13?" and the answer is "the build fix, somehow."

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
