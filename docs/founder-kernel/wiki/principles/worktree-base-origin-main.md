---
title: Base worktrees on origin/main
slug: worktree-base-origin-main
pageKind: principle
status: published
abstract: Always branch worktrees from `origin/main`, never from local `main` or `HEAD`. Local main drifts and sweeps unrelated commits or DCO failures into your PR.
principleTier: core
principleDirection: Pass `origin/main` explicitly as the base when running `git worktree add`; never branch from local main or HEAD because local drift sweeps into the PR.
principleDimensionVector: {"governance_compliance": 0.8, "blast_radius": -0.6, "evidence_density": 0.5, "long_term_maintainability": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
principlePublic: false
authoredAt: 2026-05-18
authoredBy: mark-bodman
---

# Base worktrees on origin/main

**`git worktree add ../DPF-<topic> -b feat/<branch> origin/main`** —
never `main`, never `HEAD`. Local `main` is often ahead of or behind
`origin/main` due to unpushed commits, in-flight rebases, or merges
from other concurrent sessions; basing a new feature branch on local
`main` sweeps that drift into the PR and fails DCO / sign-off checks.

## Why this exists

Local `main` is not a reliable baseline. It can be:

- Ahead of `origin/main` with unpushed commits from a prior session
- Behind `origin/main` because the operator's pull lagged a merge
- Mid-rebase from a concurrent session

A new worktree branched off local `main` inherits whichever of those
states the local clone happens to be in. The branch is then *not* what
the operator + reviewer think it is, and the resulting PR either:

- Has unrelated commits sweep in (failing DCO, polluting the diff)
- Drops commits that were already merged elsewhere (looking like a
  rollback)
- Conflicts in ways that aren't actually conflicts in `origin/main`

## What to do

When creating a worktree:

```
git -C D:/DPF fetch origin main --quiet
git -C D:/DPF worktree add D:/DPF-<topic> -b <branch-name> origin/main
```

Three precise verbs:

1. **`fetch origin main`** first — ensure the local ref of `origin/main`
   is fresh
2. **`worktree add`** the worktree directory
3. **Base the new branch on `origin/main`** explicitly (not `HEAD`,
   not `main`)

## Verify before claiming done

Per [`structural-verification-is-not-functional`](structural-verification-is-not-functional.md),
**verify PR-level checks before claiming the work is done.** Local
"tests pass" is not the same as "the PR's CI is green." The PR view
itself is the ground truth.

## Anti-pattern

- `git worktree add ../DPF-X -b feat/X` (no base specified → defaults
  to HEAD)
- `git worktree add ../DPF-X -b feat/X main` (uses local main, may be
  stale or ahead)
- Branching off `HEAD` of a worktree that was itself branched off
  stale local main → compounded staleness

## Related principles

- [`worktree-per-session`](worktree-per-session.md) — one worktree per
  concurrent session
- [`sweep-main-before-trusting-worktree-specs`](sweep-main-before-trusting-worktree-specs.md) — local
  worktrees go stale; trust `origin/main` only
- [`all-changes-land-via-pr`](all-changes-land-via-pr.md) — all changes
  ship through a PR off a current base
