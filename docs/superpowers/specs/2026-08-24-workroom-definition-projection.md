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

## Contract

- Each registered Work Case source has a stable definition key and positive
  version. The source registry remains the authority.
- `WorkroomView` carries the resolved definition identity and a Work Case-derived
  instance identity with primary source, current cycle, and active carrier refs.
- Unknown sources expose no invented definition. Ordinary business rooms require
  no repository, worktree, PR, or CI evidence.
- The existing Workspace Workroom route defaults to Overview. Details reveals
  activity, participants, evidence, receipts, and technical references.
- No schema, migration, route, API, queue, or parallel definition registry is
  introduced.

## Verification

Registry invariants, pure read-model tests, both disclosure states, related
Workroom projections, TypeScript, prose/style guards, served-route UX evidence,
and the exact committed integration gate must pass in the same PR.
