---
status: draft
---

# S5 preview proposal and receipt readback implementation plan

**Backlog item:** BI-348CC53B · [Canonical design](../specs/2026-11-26-s5-preview-proposal-receipt-design.md) · One Workroom, one branch, one PR.

## Atomic delivery

Deliver `S5-PREVIEW-JOIN` under BI-348CC53B. The proposal and its separately authorized receipt read form one delivery. The proposal alone could leave DPF2 with an unknown effect after restart. The read alone has no served receipt to recover. The paired proof is acceptance of this slice, not a separate feature.

| Objectives and acceptance | Implementation | Verification |
| --- | --- | --- |
| OBJ-S5-PROPOSAL, OBJ-S5-BOUNDARY · AC-1 | `CONTRACT-PREVIEW-PROPOSAL`: dispatch only the exact authenticated preview proposal to `proposeRehearsal`. Verify the signed raw-byte digest and exact locator. Use the proposal-bound room bearer, existing broker, live owner checks and durable receipt. | `VERIFY-UNIT`: valid proposal reaches only the rehearsal broker. In the joined preview, read back one DPF proposal and receipt. |
| OBJ-S5-READBACK, OBJ-S5-BOUNDARY · AC-2 | `CONTRACT-INDEPENDENT-READ`: issue a body-free receipt lookup to `observe`, using the independently authenticated reader and the exact original operation and attempt. | `VERIFY-UNIT`: reject a body, any bearer, a mismatched locator and a missing independent permission. `VERIFY-JOIN`: cold reopen recovers the same receipt. |
| OBJ-S5-PROPOSAL, OBJ-S5-READBACK · AC-3 | `FLOW-ORIGINAL-ATTEMPT`: let the existing receipt owner settle exact replay. Lookup never dispatches a write. A lost or mismatched reply is unknown until independently read back. Do not resend. | `VERIFY-UNIT`: exact replay returns the original identity and unknown readback causes no dispatch. `VERIFY-JOIN`: lose the reply after commit, restart, and observe one effect from a separate read. |
| OBJ-S5-BOUNDARY · AC-4, AC-5 | Bind method, action, transport, preview and receiver before calling the broker. Refuse unproven context. Keep the 15-second proof window distinct from the 120-second attempt deadline. | `VERIFY-UNIT`: altered input and foreign, stale, expired or revoked authority cause no broker effect. `VERIFY-JOIN`: check the same refusals, no provider call, proposal delivery, message, notification or wake. |

## Implementation and gate

1. Review the design amendment on this branch against pinned DPF `4e7b9d86` and FB-2c `2c329ec8`. Ask the S6 and FB-2c owners to confirm the same request and response profile, including proposal token resource separation. Reconcile this plan and the baseline through DPF using only the affected reviews. Do not mount a route before exact implementation admission. Documentation research and review are not implementation or served evidence.
2. Keep the existing S5 broker and receipt store. Wire only the enrolled preview POST and independent GET. Keep the admission resource and proof separate from the single proposal-bound room bearer. Verify the registered peer/action, strict locator and current owner before dispatch. Use exact bounded POST bytes and the signed digest before parsing. Reject any bearer on GET. Account for owner fences, current authorization and the deadline under the existing durable effect boundary. No new grant, credential kind, store, public route or v1 fallback.
3. Share versioned `s5-rehearsal-coordination-profile.v1` vectors with S6 and FB-2c. Red/green the matching source-local suites for both valid actions, purpose/path, changed bytes or locator, foreign preview or receiver, invalid expiry, wrong or revoked authority, GET body/bearer, missing read authority, mismatched reply and lost reply. Verify exact replay carries no additional effect. Run focused tests, affected types, docs/route guards as applicable and preflight before the separate full exact-tree gate.
4. `VERIFY-JOIN` is a separate served test on the exact reviewed commits and trees in the governed Contributor preview. Use the real FB-2c client against both routes. Lose a reply, cold-restart, read the original receipt independently, and count one synthetic proposal with no duplicate, delivery, notification, wake or provider send. Record zero effects for refused authority. No fixture or source-local test counts as joined proof. Do not close BI-348CC53B without this proof.

Keep production, Windows and existing T3 threads untouched. If the transport, reviewed scope or preview lease is unavailable, leave `VERIFY-JOIN` unrun. Preserve original receipts and do not resend an unknown operation.

## Backlog coverage

- Decision: atomic
- Parent: BI-348CC53B
- Receipt: blocked-by: Reconcile coverage on this amended plan blob against the updated baseline. Prior coverage remains historical.
- Rationale: The proposal and readback only deliver a recoverable Workroom effect when shipped and verified together.
- Dependencies: S6 transport (BI-5A866218), preview enrollment (BI-9F7192F9), and DPF2 FB-2c retain their owners.
- `S5-PREVIEW-JOIN` -> BI-348CC53B includes the proposal, independent lookup, restart/replay proof and refusals. Read the current exact-plan coverage receipt on BI-348CC53B before independent plan review or implementation.
