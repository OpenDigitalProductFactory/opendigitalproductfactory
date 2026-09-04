---
status: active
---

# Initiative readiness closed-work-type classification repair

- **Backlog item:** BI-1B5B4CEC
- **Blocked acceptance:** BI-7C1F43E3 / WC-1B73A988 and BI-E22C3D75 / WC-1BB2A6D1
- **Profile:** fix
- **Canonical parent design:** `docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md`
- **Reproduction ref:** `origin/main` at `ac134727bf3ad312da6452e7433906e2aec39897`
- **Initial delivery:** PR #5035; closure hardening continues in WC-D9BE05B3

## Problem

`BacklogItem.workType` is a closed seven-value contract. Before PR #5035,
`deriveAuthoritativeReadinessProfile` recognized only `bug`, `feature`, and
`doc`, so valid `chore`, `tool`, `skill`, and `refactor` items projected as
unclassified when no stronger historical signal existed. PR #5035 closed that
immediate symptom, and the live runtime now classifies truthful `refactor`
items such as BI-E22C3D75.

The closure audit found one remaining contract gap: closed work types still
shared the permissive parser used for historical aliases. A malformed stored
work type could therefore be ignored or normalized and then masked by `type`,
`source`, or build-kind signals. That is not fail-closed behavior, and the
plain string lists do not make a future enum addition a compile-time error.

## Existing substrate and decision

This repair adds no table, enum, tool, route, or client-side policy. The
authoritative mapping remains in `initiative-readiness/profiles.ts` and aligns
with the existing closed work-type contract and Build Studio's
`deriveBuildProcessType` grouping:

| Backlog work type | Readiness profile | Rationale |
|---|---|---|
| `bug` | `fix` | Defect-repair lifecycle. |
| `doc` | `doc-only` | Documentation-only lifecycle. |
| `chore` | `fix` | Small maintenance lifecycle; unlike docs, it may change executable assets. |
| `feature`, `tool`, `skill`, `refactor` | `feature` | Feature-shaped delivery requiring design, plan, implementation, and acceptance evidence. |

The mapping is a typed `Record<BacklogWorkType, ReadinessProfile>` keyed by
`BACKLOG_WORK_TYPE_VALUES`. Generic aliases remain available only for
non-work-type signals and historical profiles. A non-null work type must match
the closed enum exactly; unknown, empty, case-shifted, or whitespace-padded
values return `classification-required` before another signal can mask them.
Scope and immutable recorded profiles remain monotonic strength signals; this
change cannot downgrade an archetype or cross-domain classification.

**OBJ-WTC-001:** Every valid closed backlog work type deterministically derives
a supported initiative-readiness profile.

**OBJ-WTC-002:** Unknown work types remain fail-closed and stronger scope or
historical classifications cannot be downgraded.

**OBJ-WTC-003:** BI-7C1F43E3 and BI-E22C3D75 can be re-evaluated without
changing their truthful `refactor` work type or `platform` scope.

## Implementation sequence

1. Preserve PR #5035's committed red proof for the four omitted valid values.
   Add a new red proving malformed work types are currently masked by otherwise
   valid aliases.
2. Extract the seven valid values into one typed exhaustive map. Keep the
   permissive parser only for non-work-type compatibility signals.
3. Add entry and terminal-transition regressions proving `refactor` remains
   governed feature work and cannot pass through the advisory `doc-only` path.
4. Run the focused and adjacent readiness, MCP-pack, and terminal-transition
   suites, web typecheck, style guard, preflight, an unoverridden exact-tree
   gate, and protected GitHub checks.
5. Publish and deploy canonically, then re-read BI-7C1F43E3 and BI-E22C3D75.
   Classification must pass while genuine later evidence requirements remain
   visible.

This is one atomic fix. The test and mapping are not independently shippable.

## Acceptance and traceability

| Acceptance ID | Objective links | Statement and verification |
|---|---|---|
| AC-WTC-001 | OBJ-WTC-001 | All seven closed work types map deterministically; verify with the table in `initiative-readiness-policy.test.ts`. |
| AC-WTC-002 | OBJ-WTC-001 | `refactor`, `tool`, and `skill` map to `feature`, while `chore` maps to `fix`; verify with the focused readiness test. |
| AC-WTC-003 | OBJ-WTC-002 | Unknown and malformed values return no profile even when permissive aliases are present; verify with the table-driven focused readiness test. |
| AC-WTC-004 | OBJ-WTC-002 | Stronger scope and historical profiles remain monotonic; verify with the existing strongest-profile tests. |
| AC-WTC-005 | OBJ-WTC-003 | BI-7C1F43E3 and BI-E22C3D75 no longer report `CLASSIFICATION_REQUIRED` solely for `workType=refactor`; verify with post-release live MCP reads. |

## Risks and rollback

The initial change raised feature-shaped work from an accidental unclassified
state to the already-supported `feature` profile. The closure hardening rejects
only malformed persisted values that were previously masked; it does not
auto-authorize any transition. Revert the typed mapping and its boundary tests
together to restore PR #5035 behavior; no data migration or receipt rewrite is
involved.
