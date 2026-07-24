---
title: One Thread = One Branch + One Git Worktree
pageKind: principle
status: published
abstract: Concurrent sessions need separate worktrees for source-control isolation — index, branch, staged files. Functional verification of runtime-bound behavior still happens against the canonical install; a worktree is not a runtime clone.
principleTier: core
principleDirection: Each concurrent agent or human session operates in its own git worktree on its own branch.
principleDimensionVector: {"blast_radius": -0.7, "evidence_density": 0.4, "governance_compliance": 0.4}
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
principlePublicRationale: Documents the worktree discipline DPF requires for concurrent agent runs — adopters running multiple agents in parallel need to know this before they collide.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Each concurrent session — agent or human — operates in its own git worktree on its own topic branch. Create with `git worktree add ../DPF-<topic> -b <prefix>/<topic>`. Never share a working tree across sessions; doing so causes index/HEAD collisions and cross-thread file sweeps where one session's staged files land in another's commit.

## Why

Multiple sessions writing to the same working tree at the same time produces silent corruption: session A stages `a.ts`, session B stages `b.ts` and runs `git commit`, which sweeps in `a.ts` too. Session A's PR description says "fixes a.ts" but the diff includes `b.ts` from session B's unfinished work. The corruption is invisible until the PR is reviewed and the reviewer asks "why is b.ts in this PR?" By then session A has pushed; the audit chain is broken; the rollback path is messy. Worktrees give each session its own isolated working tree on its own branch, eliminating the entire class of cross-session collision.

## Applies To

In-platform coworkers running concurrent operations, external coding agents (multiple Claude / Codex sessions), and humans running multiple terminals. Symmetric. Applies any time more than one session is committing to the same repo simultaneously.

## How To Apply

When starting a new concurrent session, create a worktree: `git worktree add ../DPF-<topic> -b <prefix>/<topic>`. The new working tree is isolated; `git status`, `git add`, and `git commit` in it only see its own state. After the worktree is created, seed its MCP config (`.mcp.json` is gitignored and doesn't transfer): run `scripts/seed-worktree-mcp.ps1` or `scripts/seed-worktree-mcp.sh` from inside the new worktree. Keep the root clone read-only for merges and releases; topic worktrees go alongside (`d:\DPF-<topic>` on Windows, `~/dpf-worktrees/<topic>` on macOS/Linux).

## Decision Dimensions

- `blast_radius: -0.7` — isolation contains failures to one session's worktree; shared trees propagate corruption silently.
- `evidence_density: 0.4` — each worktree's git history is a clean evidence chain; cross-session mixing destroys that chain.
- `governance_compliance: 0.4` — PR review and DCO sign-off both rely on a clean per-session history.

## Examples

- **Positive:** A Claude session works in `D:\DPF\.claude\worktrees\principles-batch-4b-core` on `doc/principles-batch-4b-core` while a Codex session works in `D:\DPF\.codex\worktrees\unrelated-fix` on `fix/unrelated`. Neither can see or stage the other's files. Each commits cleanly to its own branch.
- **Counterexample:** Two agents share `D:\DPF` (the root clone). Both stage files; one runs `git commit -a`; the resulting commit mixes both agents' work. The PR description is wrong; reviewer can't tell which agent did what; rollback options are limited.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)

## Scope: Source Control Only

This principle covers the *source-control* side of concurrent work. The *runtime* side — where functional verification happens — is governed by [`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md). Together they say: each thread gets its own working tree; verification against the running platform happens on the canonical install (or a governed shared nonprod environment), not inside the worktree.
