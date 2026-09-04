---
status: active
---

# UX route-baseline main-drift repair plan

| Field | Value |
| --- | --- |
| Backlog item | `BI-91DF9A6B` |
| Workroom | `WC-D77C0C55` |
| Design and research | [`2026-09-04-ux-route-baseline-main-drift-design.md`](../specs/2026-09-04-ux-route-baseline-main-drift-design.md) |
| Delivery shape | Atomic fix |

## Atomic deliverable

### `detect-copy-and-refreeze-tax-baseline`

- Backlog: `BI-91DF9A6B`
- Requirements: `OBJ-1`, `OBJ-2`, `OBJ-3`
- Contracts: static UX-impact classification plus the existing measured route
  baseline; no runtime ratchet or route-inventory change.
- Flow: execute the design's ordered fix sequence from red classification proof
  through two same-SHA freezes, conservative merge, focused checks, and protected
  merge.
- Verification: `AC-1` through `AC-7`.
- Dependencies: none.
- Independently shippable: no. Both halves are required to restore the gate and
  prevent the same drift from being introduced again.

## Backlog coverage

Coverage is recorded atomically because the baseline correction and prevention
guard are one indivisible fix. The server receipt is added after this plan is
frozen at an immutable commit.

## Rollback

Revert the atomic fix commit. No data migration or external state rollback is
required.
