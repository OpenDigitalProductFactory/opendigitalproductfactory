---
title: Keep the Root Clone as the Merge/Release Worktree
pageKind: principle
status: published
abstract: Treat the root clone as read-only for active feature work. Topic worktrees go alongside.
principleTier: contextual
principleDirection: Reserve the root clone for merges and releases; do feature work in dedicated worktrees.
principleDimensionVector: {"blast_radius": 0.5, "long_term_maintainability": 0.3, "governance_compliance": 0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: route-domain-specific
principleConsumerContexts:
  - engineering-flow
principlePublic: true
principlePublicRationale: Documents DPF's worktree layout convention so contributors don't accidentally turn the root clone into a feature workspace.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Treat the root clone (`d:\DPF` on Windows, `~/dpf` on macOS/Linux) as read-only for active feature work. Topic worktrees live alongside: `d:\DPF-<topic>` or `~/dpf-worktrees/<topic>`. The root clone is reserved for merges, releases, and verifying that the latest main state is operational.

## Why

The root clone is what every concurrent agent and every release script expects to find at the canonical path. If the root has uncommitted feature work, switching to main for a merge requires stashing first; if the stash gets lost or applied wrong, work disappears. Keeping the root clean — always on main, always synced to origin — eliminates that whole failure mode. Topic worktrees give each feature its own isolated working tree without contaminating the root.

## Applies To

Humans and AI agents running git locally. Symmetric. Applies to every feature, fix, doc, or chore branch. Does NOT apply to small one-off operational tasks (running `pnpm install`, viewing release notes) that don't involve commits.

## How To Apply

When starting a new piece of feature work, create a worktree: `git worktree add ../DPF-<topic> -b <prefix>/<topic>`. Do the work there. Push from there. Open the PR from there. Return to the root clone only for `git pull` on main and for occasional inspection of the canonical state. When a worktree is no longer needed (PR merged, branch deleted), run `git worktree remove ../DPF-<topic>` to clean up.

## Decision Dimensions

- `blast_radius: 0.5` — keeping the root clean prevents cross-task contamination at the canonical clone.
- `long_term_maintainability: 0.3` — discipline compounds: a year of clean-root habit makes every merge / release / inspection cheaper.
- `governance_compliance: 0.3` — release scripts that target the root clone work reliably when the root is in a known state.

## Examples

- **Positive:** Three concurrent agents work in `D:\DPF-feature-a`, `D:\DPF-feature-b`, `D:\DPF-feature-c`. `D:\DPF` stays on `main` synced to origin. Mark runs a release script from `D:\DPF` and everything just works.
- **Counterexample:** An agent does feature work directly in the root clone, leaves uncommitted changes, and Mark's release script picks up the half-finished state. The release ships partially-completed feature code by accident.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
