---
status: draft
---

# DPF preview Workroom proposal and receipt readback

**Backlog item:** BI-348CC53B · **Epic:** EP-INPLATFORM-CODING
**Parent:** [DPF-to-DPF2 convergence, §5.3](2026-11-22-dpf-to-dpf2-convergence-export-and-cutover-readiness.md) and [S5 Workroom-bound toolsets](2026-11-25-workroom-bound-toolset-design.md).
**Scope brief SHA-256:** `102ae846114b4036b0e012fbce9cdbb622b2f2465d18f80e9014941b7eedf4f7`.

DPF2 can recover a fixture receipt after restart. This design lets an admitted, isolated Contributor preview record exactly one synthetic Workroom proposal in DPF and lets DPF2 read back the original receipt. It is a design for independent review, not implementation admission, test evidence, or runtime authorization.

## Objectives

**OBJ-S5-PROPOSAL:** Record one quiet synthetic Workroom proposal through the existing DPF broker and authoritative receipt store.

**OBJ-S5-READBACK:** Recover the original receipt after restart through an independent, body-free read of the exact operation and attempt.

**OBJ-S5-BOUNDARY:** Preserve current authority, isolation, and compatibility. A refusal or unknown result never widens the scope or starts another effect.

## Acceptance

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-S5-PROPOSAL, OBJ-S5-BOUNDARY | On pinned DPF and DPF2 candidate revisions, an admitted Contributor preview records one proposal and one durable receipt for the original synthetic Workroom attempt. Transport authentication is separate from the room credential. The server fixes the rehearsal mode and checks the exact subject, lease, Workroom, stage and attempt. |
| AC-2 | OBJ-S5-READBACK, OBJ-S5-BOUNDARY | After a cold reopen, the body-free lookup returns the same operation and receipt to an independently authorized reader. It neither reads the proposal body nor accepts the proposal credential as a substitute for read authority. |
| AC-3 | OBJ-S5-PROPOSAL, OBJ-S5-READBACK | Exact replay records no second effect. A lost reply without a verified receipt remains unknown and does not trigger a resend. |
| AC-4 | OBJ-S5-BOUNDARY | Altered input or foreign, stale, expired or revoked authority is refused without writes. Positive, stale, expired and revoked cases use the exact reviewed S6 transport and current authority. |
| AC-5 | OBJ-S5-BOUNDARY | The joined attempt preserves the 120-second Workroom bound and produces no provider request, proposal delivery, message, notification, or wake. Existing enrollment and lease prerequisites still apply to the installed preview. |

## Design

- S5 registers a protected preview request for the existing `proposeRehearsal` broker method. The request binds the approved transport, receiver and payload to the original operation. S5 owns the proposal boundary and reuses the current DPF receipt. No new store or writable authority is introduced.
- The separate protected `observe` lookup binds independently proven read authority to the original immutable operation and attempt. It does not dispatch a proposal or read its body. An owner status read is evidence only and cannot authorize either action.
- S6 owns peer and receiver authentication, exact request framing and fresh authority. Bind the joined test to its exact reviewed implementation, not its plan or an earlier fixture. DPF2 FB-2c consumes the approved transport and the S5 receipt. Verify `s5-route-handoff@0.1.0` on the exact admitted S5/S6 commit and tree and the matching DPF2 receiver. Leave broader regression runs to the later integration checks.

## Non-goals

No change to v1 launch, existing previews, generic MCP, runtime ownership, production activation, or live data. No provider request, guest execution, or recipient wake. Do not use the contract-only BI-588688A7 as an implementation claim or reopen a completed S5 carrier. The Windows path and migration of existing T3 threads are outside this slice.
