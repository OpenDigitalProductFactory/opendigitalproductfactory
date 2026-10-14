---
status: active
---

# Bounded host claim recovery

Backlog: BI-091A2DCF. Workroom: WC-39EE813D.
Successor to [bounded host verification](2026-10-13-bounded-host-verification-design.md).

## Problem and evidence

The host-resource runner passes a connection without `timeoutMs` to its claim
call. The shared MCP client defaults to 10 seconds. Local-CI already uses the
separate 60-second `leaseQueueCallOptions` contract, introduced under BI-46B03CAE.
The global timeout is deliberately shorter and must remain unchanged.
Coordinator reports of 10-second claim timeouts are reproduction leads. They
do not prove an authorization denial, absent server admission or a compiler
failure. The host entrypoint currently catches inventory failures only; a
claim transport exception or child spawn error can escape that unrun boundary.

## Existing architecture and research

Reuse `host-resource-attempt.mjs` for source, environment, credential and
invocation fingerprints; server claim-key uniqueness and environment locking
remain authoritative. Reuse the existing lease listing, resume validation,
supervisor and durable resumer. Extend the existing pin format for an explicitly
uncertain initial claim; do not introduce an attempt table or a second ledger.

Extract the existing lease-call budget resolver to a shared utility and retain
the gate-worktree export for its callers. Use `resolveHostCommandInvocation`
for Windows package-manager shims; other executables retain shell-free argv.
This consolidation supplies at least 20% of the implementation effort.

[RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)
permits retry of a non-idempotent method only when the operation is known to
have idempotent semantics or the first request was never applied. DPF's stable
claim key supplies that contract; timeout alone supplies neither absence nor
permission to mint a new key. The same section discourages repeating a failed
automatic retry. Allow at most one replacement call inside a finite deadline.

[Node child-process events](https://nodejs.org/api/child_process.html#event-error)
distinguish spawn errors from exits and warn that both handlers may fire. Track
the spawn event and settle once, so a missing executable is unrun and an actual
child's nonzero exit remains its code result. No new package is required.

## Objectives and acceptance

**OBJ-CLAIM-001:** Bound host claim allowance without weakening global probe deadlines.

**OBJ-CLAIM-002:** Preserve uncertain admission identity across response loss and recovery.

**OBJ-CLAIM-003:** Report transport uncertainty and command launch failure as truthful non-success.

**OBJ-CLAIM-004:** Preserve source, ownership, process and terminal admission fences.

| Acceptance ID | Objective IDs | Statement | Verification |
| --- | --- | --- | --- |
| AC-CLAIM-001 | OBJ-CLAIM-001 | The host uses the existing lease-call budget; a delayed mock response within it succeeds, and a deadline or late response cannot start the wrapped command. | Delayed response and deadline fixtures. |
| AC-CLAIM-002 | OBJ-CLAIM-002 | Response loss after admission reconciles the exact key and lease without a second row; any replacement uses the same immutable key after reconciliation. | Response-loss server and resume fixtures. |
| AC-CLAIM-003 | OBJ-CLAIM-003 | Transport uncertainty and child spawn failure return redacted unrun88 with accurate execution state; a real child failure retains its code result. | Timeout, ENOENT and nonzero-child controls. |
| AC-CLAIM-004 | OBJ-CLAIM-004 | Foreign owner, changed source/credential/invocation, conflicting identity, terminal lease and authoritative refusal never start work or scan replacement keys. | Refusal and drift fixtures. |

## Recovery contract

Resolve one immutable attempt before the first claim. Claim transport uses the
existing queue-call budget. On a timeout, perform one bounded authoritative
lease listing and match the full claim key plus environment, provider, session,
worktree, branch and resource class. A malformed, ambiguous or foreign match
stops recovery. Absence is an observation, not proof the original request was
never committed; a permitted replacement still uses exactly the same key.

Only a known timeout receives that one same-key recovery. Returned tool refusals
stop immediately. Other transport exceptions remain unrun, not retry advice.
The whole sequence has a finite elapsed deadline and each call receives only
its remaining allowance. A second timeout stops; it never mints another key.

An uncertain outcome exposes an explicit existing-format resume pin bound to
the same source/invocation fingerprint. Resuming it must reconcile first and
must retain server ownership/process/terminal refusal semantics. A listed
lease is not itself admission authority; the normal governed claim response
still decides whether execution may start. Do not scan replacement keys.

Command spawning attaches listeners immediately and records whether spawn
actually occurred. The existing supervisor owns release; failed cleanup must
not turn a failed command into success. No grant, approval or force-release
changes are part of this repair.

## Ordered implementation and coverage

One atomic host admission/execution boundary is owned by BI-091A2DCF.
Flow FLOW-HOST-CLAIM uses contracts CT-HOST-ATTEMPT, CT-LEASE-CALL-BUDGET
and CT-LEASE-SUPERVISOR; these are references to the existing modules, not new
platform types or records.
Requirements OBJ-CLAIM-001 through OBJ-CLAIM-004 map to AC-CLAIM-001 through
AC-CLAIM-004 and the existing host runner, shared MCP client, attempt pin,
lease supervisor and command resolver. None is independently safe to publish
as a claim-recovery promise without the identity and truthful-outcome controls.

1. Add failing delayed-claim, response-loss, timeout, refusal and Windows spawn
   fixtures. Keep them mock-only and assert command invocation count.
2. Extract the existing queue-call options, retaining its public gate wrapper.
3. Extend host attempt reconciliation and typed entrypoint outcomes. Preserve
   the server's serialized claim and process-transfer fences.
4. Run affected tests and appropriate publication checks; obtain exact-source
   independent assessment. Publish through a signed protected PR and queue.
5. Record source delivery separately from canonical deployed verification.

## Boundaries and dependencies

No migration, new service, model-profile change, global API timeout change,
resource-profile reduction or runtime edit is required. The canonical publisher
continues to own deployment. BI-6DE5A3B6 / PR6361 is merged source groundwork.
BI-46B03CAE's remaining expiry error wording, BI-DC9CA20D's local-CI read
reconciliation, BI-9324F783's preview dead-owner storms and BI-25CB699C's
refresh/reuse work retain their separate acceptance. HOST cleanup consequence
refinement and the ingestion clone/service fixture deadlines are not repaired
by this item. Identity BI-CAP-437F7745 and role/room BI-56E9CEC2 remain separate.
