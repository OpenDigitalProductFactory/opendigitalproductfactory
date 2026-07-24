---
title: Sweep main before trusting worktree specs
slug: sweep-main-before-trusting-worktree-specs
pageKind: principle
status: published
abstract: Worktrees can be 100+ PRs behind origin/main. Run `git log origin/main -- <topic>` before claiming a spec is "not implemented" or "out of scope."
principleTier: core
principleDirection: Run `git log origin/main -- <topic>` against current origin/main before trusting a worktree's spec status; assume the worktree's local view may be stale.
principleDimensionVector: {"evidence_density": 0.9, "schema_grounding": 0.6, "long_term_maintainability": 0.5, "speed_to_value": 0.4}
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

# Sweep main before trusting worktree specs

**Worktrees can be 100+ PRs behind `origin/main`.** A spec or plan
inside a long-lived worktree may describe a "research stub" that was
already implemented + merged three days ago. Before claiming
"not implemented" or "out of scope," run `git log origin/main -- <topic>`
to confirm the worktree's view is current.

## Why this exists

Worktrees in DPF persist for the lifetime of a feature branch. They can
sit idle while:

- The operator travels and the weekly rate limits reset their schedule
- Other concurrent sessions land 30+ PRs to `main` for adjacent work
- The kernel evolves and the worktree's local `docs/founder-kernel/`
  copy goes stale

Trusting the worktree's docs as the current state has produced:

- "Let me write this spec because the topic isn't in the kernel" → it
  was, just merged to main two days ago in a parallel session
- "I'll mark this as not implemented" → there was already a PR for it
  ahead of the worktree
- "The schema doesn't have this column" → it did on main; the worktree
  was on a branch that pre-dated the migration

## What to do

Before believing "X doesn't exist" or "X isn't implemented":

1. **`git fetch origin main`** in the worktree
2. **`git log origin/main --oneline -- <relevant-path>`** for recent
   commits touching the area
3. **`git diff HEAD origin/main -- <relevant-path>`** to see what
   you're missing
4. **If you find work you didn't know about**, rebase the worktree
   onto `origin/main` (per
   [`worktree-base-origin-main`](worktree-base-origin-main.md))
   before continuing
5. **For backlog state**, query the LIVE DB via
   `mcp__dpf__query_backlog` — the worktree's local docs are not the
   source of truth for backlog items

## Anti-pattern

- "I read the spec at `docs/superpowers/specs/...` and it says this is
  a stub" — without checking when that file was last touched on main
- Naming a "new" epic for work that's been an open backlog item for two
  weeks
- Designing a substrate the kernel already has a principle for, because
  the worktree's `docs/founder-kernel/` copy is from before the
  principle was added

## Related principles

- [`worktree-per-session`](worktree-per-session.md) — each concurrent
  session in its own worktree
- [`worktree-base-origin-main`](worktree-base-origin-main.md) — branch
  off `origin/main`, not local `main`
- [`consult-specs-first`](consult-specs-first.md) — but the specs you
  consult must be current
- [`verify-substrate-before-proposing-new`](verify-substrate-before-proposing-new.md) —
  grep the LIVE codebase, not the worktree's copy
