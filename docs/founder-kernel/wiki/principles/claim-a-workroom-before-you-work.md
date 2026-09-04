---
title: Claim a Workroom Before You Work
slug: claim-a-workroom-before-you-work
pageKind: principle
status: published
abstract: The unit of WIP is the Workroom, not the Build Studio build. Every surface — Claude Code, Codex CLI, Grok and the embedded Build Studio — claims one before working, because a build is one surface's execution while the Workroom is the durable claim that holds the lease, the branch and the evidence.
principleTier: rule
principleDirection: Claim a Workroom before starting work on any surface, including the external CLIs; work that advances without a claim holds no lease, names no backlog item, and is invisible to coordination.
principleDimensionVector: {"governance_compliance": 0.9, "evidence_density": 0.7, "long_term_maintainability": 0.5, "blast_radius": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - external-coordination
principleConsumerArchetype: universal
principleConsumerContexts:
  - build-studio
  - engineering-flow
  - mcp
---

## Rule

The unit of WIP is the **Workroom**, not the Build Studio build. Claim one before
you work, on every surface, including the external CLIs.

Founder-directed 2026-06-26.

## Why the unit is the Workroom and not the build

A build is one surface's execution of work. The Workroom is the durable claim: it
names the backlog item, holds the lease, records the branch and worktree, and
carries the evidence a gate later reads. Anchoring WIP to a build would make work
invisible whenever it ran anywhere else — which is most of it, since the four
surfaces are peers and no surface is mandatory.

## The name

Renamed from **WorkCapsule** to **Workroom**, founder-directed 2026-08-15: the
canonical name for what we claim and how we work. This was a convergence, not a
relabel — a `WorkRoom` view layer over `WorkCase` already existed, and the record
and the room are one concept rather than two. Governed by `EP-WORK-CONVERGENCE`
(umbrella `BI-D2D190BF`).

A branch has exactly ONE durable workroom identity, and it is keyed on
`(repositoryFullName, headBranch)`. That is why `create_workroom` and
`plan_workroom_worktree` always stamp a repository — a workroom born without one
cannot be matched by that key, so the next `claim_backlog_item_for_work` on the
same branch forks a SECOND live capsule instead of late-binding, leaving the
objective and scope claims on one row and the backlog item on the other, with
both calls reporting success (BI-F83CF689). Adopting a branch that already
carries a live repo-less workroom binds the repository to it; a live workroom
bound to a different backlog item refuses with `branch_occupied` rather than
forking. If you ever see two non-archived workrooms on one branch, that is the
defect, not a supported shape.

⟦runtime: the MCP tools are now named `create_workroom`, `claim_workroom_scope`,
`heartbeat_workroom` and so on; the legacy `*_capsule_*` names remain callable but
unadvertised for the alias window. The Prisma field vocabulary (`workCapsuleId`,
`capsuleId`, the `WC-*` keys) is still unchanged on disk under `@@map`. Prefer the
Workroom vocabulary everywhere; expect the old names only at the column boundary
and from clients that have not migrated.⟧

## What this rule does not yet enforce

Claiming is doctrine, not enforcement. Measured 2026-08-15: of 62 pushed remote
branches that never became a PR, only 3 carried a claim, and 146 of 148 live
claims pointed at a branch that no longer existed. Tracked as `BI-2641F34A`. Treat
an unclaimed branch as a finding, not as normal.

## Related

- [MCP is the coordination plane](mcp-is-the-coordination-plane.md)
- [Worktree selection and reaping](worktree-selection-and-reaping.md)
- [One common process, three surfaces](one-common-process-three-surfaces.md)
