---
status: draft
---

# S5 preview proposal and receipt readback implementation plan

**Backlog item:** BI-348CC53B · [Approved design](../specs/2026-11-26-s5-preview-proposal-receipt-design.md) · One Workroom, one branch, one PR.

## Atomic delivery

Deliver `S5-PREVIEW-JOIN` under BI-348CC53B. The proposal and its separately authorized receipt read form one delivery. The proposal alone could leave DPF2 with an unknown effect after restart. The read alone has no served receipt to recover. The paired proof is acceptance of this slice, not a separate feature.

| Objectives and acceptance | Implementation | Verification |
| --- | --- | --- |
| OBJ-S5-PROPOSAL, OBJ-S5-BOUNDARY · AC-1 | `CONTRACT-PREVIEW-PROPOSAL`: dispatch only the exact authenticated preview proposal to `proposeRehearsal`. Keep the room credential separate and use the existing S5 broker, live owner checks and durable receipt. | `VERIFY-UNIT`: valid proposal reaches only the rehearsal broker. In the joined preview, read back one DPF proposal and receipt. |
| OBJ-S5-READBACK, OBJ-S5-BOUNDARY · AC-2 | `CONTRACT-INDEPENDENT-READ`: issue a body-free receipt lookup to `observe`, using the independently authenticated reader and the exact original operation and attempt. | `VERIFY-UNIT`: reject a body, a write credential in place of read authority and a mismatched locator. `VERIFY-JOIN`: cold reopen recovers the same receipt. |
| OBJ-S5-PROPOSAL, OBJ-S5-READBACK · AC-3 | `FLOW-ORIGINAL-ATTEMPT`: let the existing receipt owner settle exact replay. Lookup never dispatches a write. A missing or unconfirmed receipt stays unknown. | `VERIFY-UNIT`: exact replay returns the original identity and unknown readback causes no dispatch. `VERIFY-JOIN`: lose the reply after commit, restart, and observe one effect from a separate read. |
| OBJ-S5-BOUNDARY · AC-4, AC-5 | Bind method, action, transport, preview and receiver before calling the broker. Refuse unproven context. Preserve the 120-second bound through the existing attempt deadline. | `VERIFY-UNIT`: altered input and foreign, stale, expired or revoked authority cause no broker effect. `VERIFY-JOIN`: check the same refusals, no provider call, proposal delivery, message, notification or wake. |

## Implementation and gate

1. Claim the exact code and test paths in the existing Workroom. Read the returned impact and guard obligations before Red. Add failing Vitest cases beside the existing broker and wire tests for a protected preview-only receiving adapter and independent lookup. Reuse the existing S5 proposal, observation and receipt validators. Leave the v1 handler and generic MCP unchanged.
2. Implement the smallest server-side preview adapter beside `s5-coordination-wire.server.ts` using `s5-coordination-broker.server.ts`. Require separate typed transport verification for proposal and read. Do not register a permissive substitute or enable a route without the reviewed S6 binding and the existing preview-owner and enrollment checks. Run the new focused tests, adjacent S5 broker/wire/proposal tests, affected validators and web typecheck, then the required guards. Reconcile the impact contract before handoff.
3. `VERIFY-JOIN` uses the governed Contributor preview on exact DPF/S6 and DPF2 FB-2c revisions. Coordinate the scope, lease and receiver with their existing owners. Verify the table against one synthetic attempt with independent effect readback. If the reviewed transport, scope or preview lease is unavailable, record joined proof as unrun. Do not count a fixture as a served receipt. Use the protected exact-tree gate and DCO PR once qualified.

Keep production, Windows and existing T3 threads untouched. If any check fails, withhold the preview wiring or revert this slice. Preserve any existing receipts and never resend to resolve an unknown outcome.

## Backlog coverage

- Decision: atomic
- Parent: BI-348CC53B
- Receipt: blocked-by: The plan must first be provider-readable at its published commit so DPF can issue coverage for these exact bytes and the approved design baseline.
- Rationale: The proposal and readback only deliver a recoverable Workroom effect when shipped and verified together.
- Dependencies: S6 transport (BI-5A866218), preview enrollment (BI-9F7192F9), and DPF2 FB-2c retain their owners.
- `S5-PREVIEW-JOIN` -> BI-348CC53B includes the proposal, independent lookup, restart/replay proof and refusals. Read the current exact-plan coverage receipt on BI-348CC53B before independent plan review or implementation.
