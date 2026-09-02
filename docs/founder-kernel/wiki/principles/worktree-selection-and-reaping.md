---
title: Worktree Selection and Reaping
slug: worktree-selection-and-reaping
pageKind: principle
status: published
abstract: The two interactive host surfaces (Claude Code, Codex) share ONE canonical worktree location — the dedicated sibling dir D:/DPF-worktrees/<topic>, not .claude/worktrees/ nesting. Every worktree is born governed (topic branch off origin/main, MCP seeded, workroom claim) and is reaped when idle or done.
principleTier: contextual
principleDirection: Create host-surface worktrees only at the canonical sibling location D:/DPF-worktrees/<topic>, born governed (topic branch off origin/main, MCP config seeded, compose project isolated, workroom claimed); reap idle/done worktrees, their branches, their CI images, and any stray compose project so the count stays bounded.
principleDimensionVector: {"long_term_maintainability": 0.8, "governance_compliance": 0.6, "blast_radius": -0.5, "capacity_utilization": 0.5}
principleAppliesTo:
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
---

## Rule

The two interactive **host** surfaces (Claude Code, Codex) share **one canonical worktree location**: the dedicated sibling directory `D:/DPF-worktrees/<topic>`. The tool-native `.claude/worktrees/<name>` nesting inside the root clone is **not** the convention — a worktree created there is non-canonical. Build Studio is legitimately containerized and has no host worktree; it is not forced onto this path. What is mandatory for **all three** surfaces is *governance* sameness: every work location is registered and claimed in the MCP coordination plane.

Every worktree is **born governed**:

- Created with a topic branch off `origin/main`.
- MCP config + agent toolchain seeded (`dpf-bootstrap-agent-toolchain`), `COMPOSE_PROJECT_NAME=dpf-<topic>` set, readiness marker written.
- A worktree without a `WorkCapsule` claim is an **orphan** by definition.

Every worktree has a lifecycle — `active` (claimed workroom, live heartbeat), `idle` (no heartbeat past threshold), or `done` (branch merged/abandoned) — and the janitor reaps `idle`/`done` worktrees, their branches, their per-branch CI images, and any stray compose project. The target is a **bounded** worktree count, not the 119 observed on 2026-06-05.

**Where the reaper runs is settled by [`platform-function-never-depends-on-a-client`](platform-function-never-depends-on-a-client.md) (commandment, 2026-09-02), and this page no longer decides it.** Reaping was implemented as a Claude Code `SessionEnd` hook with the portal sweeper default-off, so an install with no AI client reaped nothing. This page said "bounded" on 2026-06-05 at 119 worktrees; on 2026-09-02 the same install held 193, growing 17.6 per day. The lifecycle definition above still stands. The obligation to run it server-side, on every install, with no client present, comes from the commandment.

## Why

On 2026-06-05 the live install carried 119 worktrees in two conflicting conventions (43 nested `.claude/worktrees/`, ~75 sibling `D:/DPF-<topic>`), none reaped — because the doctrine and the tools disagreed about placement *and* nothing governed lifecycle. The kernel decided the canonical location with the most decisive margin of the five delivery decisions (margin 3.12): a worktree is **source-control, not runtime** ([`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md)), and there must be a **single source of truth** ([`single-source-of-truth`](single-source-of-truth.md)) for where it lives. Nesting work inside the root clone confuses the source-control boundary; a dedicated sibling dir keeps it clean. The sprawl came from the registration-and-reaping gap, not the path difference — so both halves are binding: one canonical path, and every worktree governed and reaped.

## How To Apply

- Create host-surface worktrees at `D:/DPF-worktrees/<topic>` with a topic branch off `origin/main`. Treat the nested `.claude/worktrees/` form as a hard error to be migrated, not a second valid convention.
- Configure both clients (Claude Code worktree base, Codex worktree trust base) to point at the canonical sibling location.
- Seed MCP + toolchain immediately after creation; claim a workroom before doing work.
- Let the worktree/runtime janitor reap `idle`/`done` worktrees, branches, CI images, and stray compose projects. Do not hoard worktrees "for reference."
- The `active` liveness signal is a real, gitignored session heartbeat (`.dpf-session-heartbeat.json`, refreshed every turn), and it **outranks** reap eligibility: the janitor keeps any worktree with a fresh heartbeat even when it is otherwise merged+clean (Tier-A) — never reap a worktree out from under a live session. A worktree mid-merge (`MERGE_HEAD`) with no live heartbeat is quarantined and flagged, not silently left or reaped.
- Keep the shared **root clone** fast-forwarded to `origin/main` (the `root-clone-freshness` SessionStart hook does this, ff-only): a stale root blocks every junctioned worktree's pregate, so root freshness is fleet hygiene, not a per-worktree concern.

## Decision Dimensions

- `long_term_maintainability: 0.8` — bounded, uniformly-located worktrees stay maintainable; 119 in two conventions do not.
- `governance_compliance: 0.6` — born-governed + reaped is the enforceable lifecycle.
- `blast_radius: -0.5` — nesting runtime/source-control concerns inside the root clone risks the canonical state.
- `capacity_utilization: 0.5` — reaping reclaims disk, branches, and orphaned CI images.

## Related

- [`worktree-is-source-control-not-runtime`](worktree-is-source-control-not-runtime.md) — why the worktree is source-control, not a second runtime.
- [`keep-root-clone-as-merge-worktree`](keep-root-clone-as-merge-worktree.md) — the root clone stays clean; topic worktrees live alongside.
- [`worktree-per-session`](worktree-per-session.md) — one thread, one branch, one worktree.
- [`single-source-of-truth`](single-source-of-truth.md) — one canonical location, not two.
- [`mcp-is-the-coordination-plane`](mcp-is-the-coordination-plane.md) — every worktree registers its claim.
- [`platform-function-never-depends-on-a-client`](platform-function-never-depends-on-a-client.md) — the reaper is platform function, not client behaviour.
- [AGENTS.md §17](../../../../AGENTS.md) — operational summary.
- [Unified Delivery Surfaces spec §4.1, §7 Q1](../../../superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — design context and the canonical-location decision.

## Origin

Unified Delivery Surfaces spec, 2026-06-05 (WWMD-ratified, Q1 — kernel high confidence, margin 3.12). Janitor tracked as BI-DBF3F426.
