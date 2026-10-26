---
title: Preserve same-family initiative review capacity continuation
date: 2026-10-25
backlog: BI-A5E13FD9
status: implementation-plan
---

# Preserve same-family initiative review capacity continuation

**Backlog item:** BI-A5E13FD9
**Implementation parent:** BI-A5E13FD9. One atomic repair; no independently shippable child.

## Problem and design grounding

At source `a9f0cce354698ab51237864b998b5f14f69b8ce5`, `issueOriginalReviewRecoveryTarget` in `apps/web/lib/mcp-task-review-recovery.ts` authenticates the original request, human and coworker, then requires an `input-required` terminal-writer checkpoint before checking whether the caller already owns the same OAuth task family. A submitted provider-capacity wait therefore receives the historical original-execution-proof refusal. `authorizeCoworkerRequest` in `apps/web/lib/mcp/independent-review-request.ts` rejects the otherwise exact issued request before the existing capacity resumer can handle it.

The observed stakeholder architecture TaskRun ending `34F7A7025220` is submitted with resource-wait attempt 1, due at 2026-10-26T02:03:33.275Z, unchanged since 02:02:33.287Z. It has no recorded execution-uncertainty marker or canonical architecture verdict. Admission is not approval or evidence that an earlier native process had no effects.

Reuse BI-42CE2CE7's existing capacity lifecycle and CAS reservation. BI-7906C73E retains historical proof qualification; BI-F646BC4E retains writer fencing. BI-7CCCA696 and BI-8ECEC429 concern the separate semantic-review lifecycle. Mirrored BI-4C4F7139 remains peer-owned. The reliability owner was contacted before path claims; exact claims were admitted without override. PR6591's distinct transaction handoff repair remains separately owned.

## Contract and boundary

CONTRACT-ORIGINAL: authenticate the immutable original request digest, deterministic TaskRun identity, caller human/coworker and current native packet before changing any lifecycle admission. Preserve all existing checks and original metadata.

CONTRACT-CAPACITY: recognize only an untransferred, same-family submitted resource wait parsed by the existing capacity contract. Require no execution uncertainty or terminal-writer escalation, an open recorded recovery window, a due backoff and a remaining capacity-attempt budget. Other states retain the existing original-task recovery contract. A capacity wait cannot authorize another OAuth family to take over the task.

FLOW-CONTINUE: bounded recovery read → unchanged native request authorization → existing same-TaskRun submit/reservation → existing execution budget and canonical writer. The issuer only makes the existing request reachable; it performs no dispatch, reservation, receipt or settlement write itself.

Unknown execution, malformed/ambiguous originals, changed request/source, different owner/coworker, authority transfer, expired deadline and exhausted budget remain held. Existing terminal-writer recovery remains unchanged. A genuine existing receipt remains the canonical result; there is no author-written PASS.

## Acceptance criteria

- AC-RC-1: A current authorized same-family exact request for a valid submitted capacity wait passes recovery issuance and request admission into the existing TaskRun lifecycle without creating a replacement review.
- AC-RC-2: The existing resumer preserves original immutable identity, review binding, counters, backoff, deadline and CAS reservation; before-due, exhausted and concurrent continuation follow existing bounded behavior.
- AC-RC-3: Uncertain execution, ambiguous originals, changed request/source, wrong human/coworker, unauthorized or expired authority and cross-family capacity takeover remain refused. Terminal-writer recovery retains its existing contract.
- AC-RC-4: Behavioral regression exercises get_backlog_item recovery and authorizeCoworkerRequest with a recorded capacity wait, then the existing continuation seam; no canonical receipt or historical closure is inferred from admission.
- AC-RC-5: Focused tests, affected typechecks, exact-tree integration, protected DCO PR/merge and canonical live readback of the original stakeholder review establish recovery behavior. Any remaining inference/provider outcome is reported separately.

## Ordered implementation and verification

1. Freeze this proportional fix design, record author research and atomic coverage against its immutable repository blob, then claim implementation under the server-derived shape. No implementation under the stakeholder xlarge parent.
2. VERIFY-ISSUER: add a first-failing regression to `mcp-task-review-recovery.test.ts` for a due, untransferred, same-family capacity wait. Add negative cases for uncertainty, wrong family, transferred authority, future backoff, expiry, malformed wait, exhausted attempts, mismatched owner/digest and ambiguous originals. No mutation should occur in issuance.
3. VERIFY-ROUNDTRIP: extend `mcp/independent-review-packet-roundtrip.test.ts` through the real bounded recovery reader and request authorizer; assert the exact packet and original identity are preserved. Keep the uncertain-original refusal tests.
4. Repair the existing issuer predicate using the shared resource-wait parser, backoff and attempt constants. Keep validation single-homed and leave lifecycle/authority-transfer/effect-writer behavior unchanged. Run RED/GREEN and relevant existing capacity/CAS and request-authority suites.
5. VERIFY-GATE: run both affected web TypeScript programs, the resolved graph-linked/colocated tests, style-drift guard, documentation/index/links and the canonical shared integration gate. The start-of-work graph returned the exact recovery test; source inspection additionally identified round-trip, independent-request, capacity-resume and background-dispatch tests. Missing advice expands verification.
6. Publish a DCO-signed ready PR through protected CI/queue. Deploy only through canonical self-upgrade, then VERIFY-SERVED: read the unchanged original stakeholder review, submit only a current server-issued packet if eligible, observe the same task and counters, and separately verify a genuine architecture receipt or truthful remaining wait/refusal.

The worktree is source-control isolation; no parallel runtime, direct DB update, new review key, provider override or model configuration change belongs to this repair. New source-local evidence does not establish deployment. No UI renderer or database migration changes are planned.

## Risks and rollback

The principal risk is making an unsafe original replay reachable. Keep the positive predicate narrow and exercise all explicit hold/authority/budget exclusions. Do not infer safety from absent tool rows, process exit, a generic capacity message or TaskRun completion. A stored resource wait still passes the existing execution and writer checks; no historical unknown is cleared.

Revert only the admission-predicate change if needed, retaining existing TaskRun identities, receipts, counters, evidence and canonical writer fences. Reverting may restore the original hold; it must never mint a replacement task or remove an active effect safeguard. Live provider/routing failures remain separately attributable after admission is repaired.

## Backlog coverage

- Decision: atomic
- Parent: BI-A5E13FD9
- Receipt: blocked-by: this initial proportional fix design must be committed and pushed before the canonical coverage writer can bind its immutable repository artifact.
- Rationale: issuer and read/authorize round-trip behavior constitute one existing contract repair; the tests and predicate have no useful independent delivery boundary.
- Mapping: capacity-admission -> BI-A5E13FD9
- Requirements: AC-RC-1, AC-RC-2, AC-RC-3, AC-RC-4, AC-RC-5
- Contracts: CONTRACT-ORIGINAL, CONTRACT-CAPACITY
- Flow: FLOW-CONTINUE
- Verification: VERIFY-ISSUER, VERIFY-ROUNDTRIP, VERIFY-GATE, VERIFY-SERVED
