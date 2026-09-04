---
status: active
---

# Initiative readiness closed-work-type classification implementation plan

- **Backlog item:** BI-1B5B4CEC
- **Workroom:** WC-421C49DA
- **Design:** `docs/superpowers/specs/2026-09-03-initiative-readiness-worktype-classification-design.md`
- **Canonical baseline:** `baseline-126c4811-660c-484c-a5c8-18898efc42b5`
- **Delivery decision:** atomic

## Scope

Repair the single authoritative `deriveAuthoritativeReadinessProfile` mapping
so every closed backlog work type is classified consistently with
`deriveBuildProcessType`, while unknown values remain fail-closed. The mapping,
its table-driven regression test, and post-release BI-7C1F43E3 verification are
one deliverable; none is independently safe to ship.

## Traceability

| Objective | Acceptance verification |
|---|---|
| OBJ-WTC-001 | AC-WTC-001, AC-WTC-002 |
| OBJ-WTC-002 | AC-WTC-003, AC-WTC-004 |
| OBJ-WTC-003 | AC-WTC-005 |

Contracts exercised by this plan are `deriveAuthoritativeReadinessProfile` and
`deriveBuildProcessType`.

## Implementation sequence

1. Preserve the committed table-driven Red over all seven closed work types and
   the explicit unknown-value refusal.
2. Extend the existing profile normalization function only: `chore` maps to
   `fix`; `tool`, `skill`, and `refactor` map to `feature`.
3. Run the focused and adjacent readiness suites, web typecheck, style and diff
   guards, preflight, and the exact-tree gate.
4. Deliver through DCO and protected GitHub checks, publish one canonical
   release, upgrade through the governed path, and verify AC-WTC-005 by reading
   BI-7C1F43E3 from the live runtime.

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

Completion requires the mapping and regression test to pass on the exact tree,
all protected PR and merge-group checks to pass, the canonical release to be
served, and live BI-7C1F43E3 to stop reporting `CLASSIFICATION_REQUIRED` solely
because its truthful work type is `refactor`. This repair does not fabricate or
waive any later completion evidence that BI-7C1F43E3 genuinely still requires.
