---
status: active
---

# Initiative readiness closed-work-type classification implementation plan

- **Backlog item:** BI-1B5B4CEC
- **Initial delivery:** PR #5035 / WC-421C49DA
- **Closure Workroom:** WC-D9BE05B3
- **Design:** `docs/superpowers/specs/2026-09-03-initiative-readiness-worktype-classification-design.md`
- **Canonical baseline:** `baseline-126c4811-660c-484c-a5c8-18898efc42b5`
- **Delivery decision:** atomic

## Scope

Finish the single authoritative `deriveAuthoritativeReadinessProfile` mapping
delivered by PR #5035: bind every closed backlog work type through a typed
exhaustive record consistent with `deriveBuildProcessType`, and fail closed
when a malformed work type appears beside permissive compatibility aliases.
The typed map, its boundary regressions, the unoverridden exact-tree gate, and
post-release BI-7C1F43E3 / BI-E22C3D75 verification are one deliverable.

## Traceability

| Objective | Acceptance verification |
|---|---|
| OBJ-WTC-001 | AC-WTC-001, AC-WTC-002 |
| OBJ-WTC-002 | AC-WTC-003, AC-WTC-004 |
| OBJ-WTC-003 | AC-WTC-005 |

Contracts exercised by this plan are `deriveAuthoritativeReadinessProfile` and
`deriveBuildProcessType`.

## Implementation sequence

1. Preserve PR #5035's valid-value red/green proof, then confirm a new red for
   malformed work types masked by valid `type`, `source`, and build aliases.
2. Replace work-type parsing with one `Record<BacklogWorkType,
   ReadinessProfile>`; retain generic aliases only for non-work-type signals.
3. Add entry and backlog-terminal regressions for truthful `refactor` work.
4. Run focused and adjacent readiness, MCP-pack, and terminal-transition
   suites, web typecheck, style and diff guards, and preflight.
5. Obtain independent semantic review and pass the governed exact-tree gate
   without an override before pushing the closure PR.
6. Merge through the queue, publish and self-upgrade through the governed path,
   then verify AC-WTC-005 by reading BI-7C1F43E3 and BI-E22C3D75 from the live
   runtime.

## Atomic coverage projection

| Deliverable | Requirements | Contracts | Flow | Verification |
|---|---|---|---|---|
| `closed-worktype-profile-mapping` | OBJ-WTC-001, OBJ-WTC-002, OBJ-WTC-003 | `deriveAuthoritativeReadinessProfile`, `deriveBuildProcessType` | Implementation sequence | AC-WTC-001, AC-WTC-002, AC-WTC-003, AC-WTC-004, AC-WTC-005 |

## Backlog coverage

- Decision: atomic
- Parent: `BI-1B5B4CEC`
- Receipt: `cmtmfkozx0n9c01nv6yvq4dp0`
- Immutable plan artifact: commit
  `f0838e6c7d93334a5d8f9d5667513543b7e66797`, provider blob
  `2e5e20899e6ba80ba9f2ff8e87eb8deaffe4de59`
- Dependencies: none
- Rationale: The mapping, regression proof, and live acceptance alter one
  authoritative readiness contract and are not independently shippable.

## Completion boundary

Completion requires the typed mapping and boundary regressions to pass on the
exact tree without an override, all protected PR and merge-group checks to
pass, the canonical release to be served, and live BI-7C1F43E3 and BI-E22C3D75
to stop reporting `CLASSIFICATION_REQUIRED` solely because their truthful work
type is `refactor`. This repair does not fabricate or waive later evidence
either item genuinely still requires.
