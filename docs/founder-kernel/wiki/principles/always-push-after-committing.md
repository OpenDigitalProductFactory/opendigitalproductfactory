---
title: Always Push After Committing
pageKind: principle
status: published
abstract: Local-only commits are invisible to CI and to other agents. Push every commit so the work exists.
principleTier: contextual
principleDirection: Push after every commit; never leave work as local-only.
principleDimensionVector: {"evidence_density": 0.5, "governance_compliance": 0.4, "blast_radius": -0.3}
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
principlePublicRationale: Adopters working in DPF need to know that completion requires pushed evidence — claiming "done" with unpushed commits is a real failure mode the principle prevents.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

After committing, push. Local-only commits are invisible to CI, invisible to reviewers, and invisible to other concurrent sessions — they may as well not exist. Completion claims require pushed evidence, not local-only commits.

## Why

A commit that exists only locally is in a state that looks done to the author but is not done from anyone else's perspective. CI hasn't run; the DCO bot hasn't checked sign-off; reviewers can't see the diff; other concurrent agents can't depend on the change. The window between local commit and push is the window where work can silently vanish — a corrupted disk, a deleted worktree, a forgotten branch. Push closes that window.

## Applies To

In-platform coworkers, external coding agents, and humans running git locally. Symmetric. Applies after every commit. Does NOT apply when the user has explicitly asked for local-only work — but that's the exception, not the default.

## How To Apply

After `git commit`, run `git push` (or `git push -u origin <branch>` for the first push of a new branch). Configure shell aliases or git hooks to make the push the default tail of every commit if local discipline keeps slipping. When claiming work is complete, verify `git status` shows zero unpushed commits before the claim.

## Decision Dimensions

- `evidence_density: 0.5` — pushed commits are verifiable evidence; local-only commits are author-claimed evidence only.
- `governance_compliance: 0.4` — CI / DCO / branch protection only fire on pushed commits.
- `blast_radius: -0.3` — an unpushed commit is one machine failure away from gone; pushing shrinks the blast radius of that loss by replicating the work off the single local disk.

## Examples

- **Positive:** Agent commits five changes locally, runs `git push`, sees CI pick them up, reports "done" only after the push completes.
- **Counterexample:** Agent commits five changes, says "done," and stops. An hour later the operator asks for the PR link; the commits are still local; the agent has to push and re-validate that CI passes before the operator can review.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
