---
status: active
---

# Workroom definition projection

**Backlog item:** `BI-80BECE1E`

## Purpose

Realize the first Workroom definition/instance slice through the existing Work
Case source registry, read model, and Workspace route. The canonical business
meaning remains in
[`docs/architecture/workroom-vocabulary-boundary.md`](../../architecture/workroom-vocabulary-boundary.md)
and Section 9.5 of the four-portfolio operating standard. This specification
defines only the atomic adapter change required to make that architecture real.

## Objective

1. **OBJ-WORKROOM-IDENTITY-001:** Distinguish a reusable Workroom definition from the occurrence carrying work through the existing Work Case projection and Workspace route, without requiring development evidence or adding a parallel platform surface.

## Acceptance

| Acceptance | Objectives | Requirement | Evidence |
|---|---|---|---|
| AC-WORKROOM-001 | OBJ-WORKROOM-IDENTITY-001 | Every registered Work Case source has a stable definition key and positive version owned by the source registry. | registry invariant test |
| AC-WORKROOM-002 | OBJ-WORKROOM-IDENTITY-001 | `WorkroomView` carries definition identity and an instance trace with its primary source, current cycle, and active carrier references. | read-model tests |
| AC-WORKROOM-003 | OBJ-WORKROOM-IDENTITY-001 | Unknown sources expose no invented definition, and ordinary business rooms require no repository, worktree, PR, or CI evidence. | unknown-source test and architecture contract |
| AC-WORKROOM-004 | OBJ-WORKROOM-IDENTITY-001 | The existing route defaults to Overview; Details reveals activity, participants, evidence, receipts, and technical references. | component and served-route checks |
| AC-WORKROOM-005 | OBJ-WORKROOM-IDENTITY-001 | The change introduces no schema, migration, route, API, queue, or parallel definition registry. | exact-tree integration gate |

## Verification

Registry invariants, pure read-model tests, both disclosure states, related
Workroom projections, TypeScript, prose/style guards, served-route UX evidence,
and the exact committed integration gate must pass in the same PR.
