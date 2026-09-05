---
status: active
---

# Pet Rescue exact-served acceptance repair

Backlog item: `BI-24FDCB9D`  
Workroom: `WC-87F57668`  
Design: `docs/superpowers/specs/2026-08-25-pet-rescue-operating-system-and-help-recovery-design.md` §§5.1, 7.1, 7.4, 7.5  
Blocked closeout: `BI-7A38F667` / `WC-16B8E810`

## Objective

Repair the two contradictions observed on exact served commit
`4e48b40a727b9a1bf02b355c69a2c661ab4af275`: the Ward must not lose the
canonical in-care animal roster when housing is unrecorded, and the Rescue
navigation must remain legible without horizontal overflow at 390×844.

## Atomic boundary

This is one release-acceptance repair. Neither half is independently releasable
because `BI-7A38F667` remains unaccepted while either contradiction is live.
`BI-D2A51B36` retains ownership of housing occupancy, and `BI-7A38F667` retains
ownership of the Rescue cockpit. This plan adds no schema, route, write path, or
alternate animal identity.

## Phase 1 — RED and authority boundary

1. Reproduce the Ward failure against the exact served source: the no-housing
   branch passes `animals={[]}` while the same organization has canonical
   `AnimalProfile` rows.
2. Add a failing loader regression that requires the organization-scoped
   `in_care` and `placement_ready` roster even when the Resource query is empty.
3. Add a failing Rescue navigation regression that requires a non-scrolling
   three-column narrow layout, seven explicit 44px targets, and the existing
   desktop row.

Verification: both focused Vitest files fail for the named pre-fix behavior,
not for harness or fixture setup.

## Phase 2 — GREEN and bounded refactor

1. Introduce one Ward workspace read that loads housing and the canonical animal
   roster together. Keep `loadWardBoard` as a compatibility projection over that
   read so the cockpit capacity consumer does not gain a second authority.
2. Make the Ward page use the shared workspace result. When housing is absent,
   keep the truthful no-housing copy and pass the canonical animals to
   `WardOperations`; when housing exists, preserve allocation/resource behavior.
3. Replace the shrinkable, horizontally scrolling narrow navigation row with a
   three-column grid below `sm` and the existing compact flex row from `sm`
   upward. Preserve route order, `aria-current`, focus behavior, and theme tokens.

Verification: the two focused tests pass, then all Ward tests and web typecheck
pass on the exact worktree.

## Phase 3 — guards, protected CI, and live acceptance

1. Run prose-lint and style-drift guard obligations plus deterministic preflight.
2. Freeze a DCO-signed commit and run exact-tree semantic review.
3. If the shared local-CI slot is unavailable under the operator-authorized
   bypass, record that gate `INCONCLUSIVE`; do not infer a pass. Push only with
   the explicit governed override and require all protected CI checks.
4. Merge through the protected PR path. Wait for a release that serves the merge
   commit, obtain `CAN-TEST`, and re-run `/workspace/ward` plus the Rescue
   navigation at desktop and 390×844.
5. Record live acceptance only if the Ward selector matches the canonical roster
   and every navigation label fits a non-overlapping target at least 44px high
   with no horizontal navigation overflow. Only then unblock `BI-7A38F667`.

## Backlog coverage

Decision: `atomic`  
Deliverable: `pet-rescue-served-acceptance-repair` → `BI-24FDCB9D`  
Requirements: `AC-RESCUE-CAPACITY-02`, `AC-RESCUE-HOME-02`  
Dependencies: `BI-D2A51B36`, `BI-7A38F667`  
Coverage receipt: pending the immutable plan commit and
`record_plan_backlog_coverage`.

## Risk and rollback

- Risk: changing the roster authority could hide legacy-only public listings.
  Mitigation: that is intentional under §5.1—`AdoptableAnimal` is not an
  operational identity—and the query is constrained to the canonical in-care
  lifecycle values for one organization.
- Risk: the narrow navigation consumes more vertical space. Mitigation: three
  columns use three rows at 390px and collapse back to the existing one-row
  layout at `sm`, trading a small bounded height increase for readable controls.
- Rollback: revert the single PR. No migration or data rewrite is involved; the
  original exact-served behavior returns and `BI-7A38F667` remains open.
