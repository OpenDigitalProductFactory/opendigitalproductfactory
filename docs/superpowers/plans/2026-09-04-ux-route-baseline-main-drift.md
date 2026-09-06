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
- Contracts:
  - `CONTRACT-COPY-CLASSIFICATION`: static UX-impact classification.
  - `CONTRACT-MEASURED-ROUTE-BASELINE`: the existing measured route baseline.
  - `CONTRACT-NO-RUNTIME-RATCHET`: no runtime-ratchet change.
  - `CONTRACT-NO-ROUTE-INVENTORY-CHANGE`: no route-inventory change.
- Flow:
  - `FLOW-1`: red classification proof.
  - `FLOW-2`: first same-SHA freeze (`33842857763`).
  - `FLOW-3`: second same-SHA freeze (`33843669436`).
  - `FLOW-4`: conservative merge of only independently reproducible rows.
  - `FLOW-5`: focused checks.
  - `FLOW-6`: protected merge.
- Verification: `AC-1`, `AC-2`, `AC-3`, `AC-4`, `AC-5`, `AC-6`, and
  `AC-7`.
- Calibration evidence: protected runs `33842857763` and `33843669436` at the
  same SHA both produced the exact 686-word tax record. The whole-file merge
  refusal for five unrelated nondeterministic routes is retained; only the
  reproducible affected row is eligible for this atomic patch.
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
