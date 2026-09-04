---
status: active
---

# Initiative readiness closed-work-type classification repair

- **Backlog item:** BI-1B5B4CEC
- **Blocked acceptance:** BI-7C1F43E3 / WC-1B73A988
- **Profile:** fix
- **Canonical parent design:** `docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md`
- **Reproduction ref:** `origin/main` at `ac134727bf3ad312da6452e7433906e2aec39897`

## Problem

`BacklogItem.workType` is a closed seven-value contract, but
`deriveAuthoritativeReadinessProfile` recognizes only `bug`, `feature`, and
`doc`. Valid `chore`, `tool`, `skill`, and `refactor` items therefore project
as unclassified when no stronger historical signal exists. Live BI-7C1F43E3
demonstrates the contradiction: its truthful `workType=refactor` and
`scopeKind=platform` are persisted, yet every readiness target returns
`CLASSIFICATION_REQUIRED` with a fallback `doc-only` profile.

The classification field is not missing. Platform scope deliberately carries
no risk profile, and the item has no baseline whose recorded profile could
mask the omission. The current source mapping is the defect.

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

Unknown, empty, or malformed values remain unclassified. Scope and immutable
recorded profiles remain monotonic strength signals; this change cannot
downgrade an archetype or cross-domain classification.

**OBJ-WTC-001:** Every valid closed backlog work type deterministically derives
a supported initiative-readiness profile.

**OBJ-WTC-002:** Unknown work types remain fail-closed and stronger scope or
historical classifications cannot be downgraded.

**OBJ-WTC-003:** BI-7C1F43E3 can be re-evaluated without changing its truthful
`refactor` work type or `platform` scope.

## Implementation sequence

1. Add a table-driven red test for all seven closed work types and an unknown
   value. The committed Red checkpoint includes the explicit assertion
   `deriveAuthoritativeReadinessProfile({ workType: "unknown-work" }) === null`
   in `initiative-readiness-policy.test.ts`; the four intended failures are
   only `chore`, `tool`, `skill`, and `refactor` receiving `null`.
2. Extend the single profile normalization function with the missing closed
   values; do not add a second mapper.
3. Run the focused readiness suite, adjacent readiness tests, web typecheck,
   style guard, preflight, exact-tree gate, and protected GitHub checks.
4. Publish and deploy canonically, then re-read BI-7C1F43E3 and verify that
   classification passes while its genuine completion evidence requirements
   remain visible.

This is one atomic fix. The test and mapping are not independently shippable.

## Acceptance and traceability

- **AC-WTC-001:** All seven closed work types map deterministically. Verify
  OBJ-WTC-001 with the table in `initiative-readiness-policy.test.ts`.
- **AC-WTC-002:** `refactor`, `tool`, and `skill` map to `feature`; `chore`
  maps to `fix`. Verify OBJ-WTC-001 with the focused readiness test.
- **AC-WTC-003:** Unknown values return no profile. Verify OBJ-WTC-002 with
  the explicit `unknown-work` assertion in the focused readiness test.
- **AC-WTC-004:** Stronger scope and historical profiles remain monotonic.
  Verify OBJ-WTC-002 with the existing strongest-profile tests.
- **AC-WTC-005:** BI-7C1F43E3 no longer reports `CLASSIFICATION_REQUIRED`
  solely for `workType=refactor`. Verify OBJ-WTC-003 with a post-release live
  MCP read.

## Risks and rollback

The change raises feature-shaped work from an accidental unclassified state to
the already-supported `feature` profile, exposing its real design and
completion gates. It does not auto-authorize any transition. Revert the mapping
and table-driven test together to restore the prior fail-closed behavior; no
data migration or receipt rewrite is involved.
