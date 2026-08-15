# Claim a workroom before you work

**Tier:** rule
**Applies to:** every delivery surface — Claude Code, Codex CLI, Grok, and the
embedded Build Studio.

## The rule

The unit of WIP is the **Workroom**, not the Build Studio build. Claim one before
you work, on every surface, including the external CLIs.

Founder-directed 2026-06-26.

## Why the unit is the workroom and not the build

A build is one surface's execution of work. The workroom is the durable claim: it
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

⟦runtime: the MCP tools still carry their original `*_capsule_*` names behind an
alias window, and the Prisma field vocabulary (`workCapsuleId`, `capsuleId`, the
`WC-*` keys) is unchanged — `BI-0702869B` and `BI-C2C16582` retire those. Prefer
the workroom vocabulary in prose; expect the old names at the tool and column
boundary until those ship.⟧

## What this rule does not yet enforce

Claiming is doctrine, not enforcement. Measured 2026-08-15: of 62 pushed remote
branches that never became a PR, only 3 carried a claim, and 146 of 148 live
claims pointed at a branch that no longer existed. Tracked as `BI-2641F34A`. Treat
an unclaimed branch as a finding, not as normal.

## Related

- [MCP is the coordination plane](mcp-is-the-coordination-plane.md)
- [Worktree selection and reaping](worktree-selection-and-reaping.md)
- [One common process, three surfaces](one-common-process-three-surfaces.md)
