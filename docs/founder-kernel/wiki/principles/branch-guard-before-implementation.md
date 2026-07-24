---
title: Branch Guard Before Implementation
pageKind: principle
status: published
abstract: Abort before serious work if on main or detached HEAD. Completion requires a pushed branch or PR.
principleTier: core
principleDirection: Verify branch state before implementation and before claiming completion.
principleDimensionVector: {"governance_compliance": 0.7, "blast_radius": -0.5, "evidence_density": 0.4}
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
principlePublicRationale: Adopters need to know that DPF agents check branch state before committing — local-only commits and accidental main-branch work are real failure modes the principle prevents.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Before any serious implementation, verify branch state: `git status --short --branch` must not report `HEAD (no branch)` (detached) and `git branch --show-current` must not return `main`. If either condition holds, abort and create or switch to a topic branch first. Do not claim work is complete while commits are local-only — completion requires a pushed branch or open PR unless the user explicitly asked not to publish.

## Why

Two failure modes get caught by this guard. First: an agent that accidentally starts work on `main` and commits directly bypasses branch protection on the local side, then pushes either successfully (compromising the PR contract) or unsuccessfully (leaving the work stranded in local commits no one else can see). Second: an agent that finishes work and reports "done" while the commits are still local — the user thinks the work shipped but CI never ran, no PR was opened, no review happened. The guard is a one-second check that prevents both.

## Applies To

In-platform coworkers, external coding agents, and humans working in the repo. Symmetric. Applies before serious implementation and before any "I'm done" claim.

## How To Apply

The pre-implementation check: `git branch --show-current`. If it returns `main`, run `git checkout -b <prefix>/<topic>` before continuing. If it returns nothing (detached), figure out what branch you should be on and switch. The pre-completion check: have you pushed? If `git status` shows commits ahead of origin, you haven't shared the work yet. The user expecting a PR cannot see local-only commits; saying "done" while in that state is wrong.

## Decision Dimensions

- `governance_compliance: 0.7` — branch protection plus the guard together enforce that every change goes through PR review.
- `blast_radius: -0.5` — work-on-main commits can pollute history; local-only-commits look done but aren't; the guard contains both.
- `evidence_density: 0.4` — a pushed branch is durable evidence the work exists and is reviewable; a local-only commit is invisible.

## Examples

- **Positive:** Agent runs `git branch --show-current`, sees `main`, runs `git checkout -b feat/new-feature`, then proceeds. At the end, runs `git status` to confirm no unpushed commits before reporting "done."
- **Counterexample:** Agent commits ten changes to `main` locally without checking the branch. Push fails because of branch protection. The agent realizes mid-push, has to spend twenty minutes rebasing onto a new topic branch. Or worse: agent reports "done" while ten commits sit unpushed for an hour before the user notices.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
