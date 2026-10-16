---
status: proposed
backlog: BI-B22C8E02
---

# Same-mandate Workroom executor handoffs

This is a successor delivery for the October 15 owner observation on BI-B22C8E02.
It does not amend the frozen evidence or acceptance of PR #6202. Funding and
purpose are shared DPF platform reliability under the owner's explicit direction
to execute the BI. Human ownership remains with the person; executor acceptance
does not transfer ownership or confer access.

## Problem and evidence

The owner-requested Claude-to-Codex handover of WC-8D35443E generated approval
cmva8uv3f19ie01rxozn6u25e. The owner had to find and approve it. That observation
proves interruption, not unchanged authority. On source base
`b338f06e581e6cc7886c334b519f098feb142865`, `work-capsules-pack.ts` assigns
`authority` unconditionally to `reassign_workroom_executor` and its tests require
no call refinement. `reassign-executor-handler.ts` immediately transfers the
lease and can admit a new assistant. There is no receiver acknowledgement.

## Objectives and acceptance

**OBJ-1:** Complete authorized same-mandate executor handoffs without a human approval click.

**OBJ-2:** Preserve ownership, current permissions, sensitivity, shape and concurrent lease boundaries.

**OBJ-3:** Make pending, acknowledged, completed and refused outcomes durable and understandable.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1, OBJ-2 | An owner-authorized request to an already admitted eligible receiver remains pending until that authenticated receiver acknowledges; neither phase creates a fresh approval under valid standing delegation. |
| AC-2 | OBJ-2 | Neither phase changes owners, participant roles, grants, sensitivity, work shape or mandate; missing delegation, restricted/consequential effects, new admission and legacy direct reassignment retain their existing gates. |
| AC-3 | OBJ-2, OBJ-3 | Changed owner, participant eligibility, mandate, executor or lease identity refuses completion; concurrent requests serialize; duplicate commands and acknowledgements cannot execute the transfer twice. |
| AC-4 | OBJ-3 | The existing room timeline and MCP readback distinguish waiting for acknowledgement, completed and failed; a request alone never appears as a completed transfer. |
| AC-5 | OBJ-1, OBJ-2, OBJ-3 | Tests prove classification, actual writer effects, failures, retries and concurrency; exact-source delivery and served DEV evidence remain distinct from local tests. |

## Design grounding

Extend `reassign-executor-handler.ts`, `workroom-lease.ts`, `receipted-tool.ts`,
`command-receipts.ts`, `oauth-workroom-ownership.ts` and
`workroom-agent-access.server.ts`. Reuse the existing consequence refiner and
connection delegation; never change the global escalation policy. Reuse
`WorkroomActivity` for a request and its outcome, and the existing timeline
presenter. The July 11 cross-agent handoff plan explicitly reserved the missing
propose/acknowledge step. BI-A27B903D owns human-ownership continuity;
BI-06AE6833 owns autonomous stalled-PR recovery. This delivery supplies a bounded
handoff primitive without taking either initiative over.

WWMD decision DI-D17E0B08FCAC recommends extending the existing command,
with usable signal and autonomy eligible. Earlier DI-1BC3BF810052 was unusable
because its options lacked scoreable features; it grants nothing.

## Operation contract

Extend the existing tool with an optional handoff phase. Omission preserves the
existing consequential direct reassignment. The new bounded flow is explicit:

1. `request`: requires command identity, expected lease holder, expected executor
   kind/ref, target agent identity, target executor kind/ref and next-action
   manifest. Resolve all principals on the server. Only a currently active human
   owner and their authorized assistant may initiate. Both source and receiver
   must already have action admission to this exact room. No new invitation.
2. Persist the request in the room's existing activity log under the row lock.
   Capture requesting human and assistant, exact receiver, source/target executor,
   lease holder and expiry, room authority/scope/shape, roster, effective
   sensitivity and case policy. Bind a digest to the stored request. Return the
   request identity and `pending-acknowledgement`; change no executor or lease.
3. `acknowledge`: accepts only the stored request identity. The authenticated
   receiver must be the exact target assistant acting for the same human owner;
   it cannot acknowledge on another agent's behalf. Current governed token,
   grant and delegation checks apply independently to both callers.
4. Under the same room lock, reload the request, owner, roster, room mandate,
   policy, sensitivity and lease/executor snapshot. Reject stale or expired
   requests and any changed protected boundary. Recheck both actors' current
   exact-room access. Never trust a caller-supplied unchanged-boundary flag.
5. Record acknowledgement and the existing `executor-changed` event and complete
   the lease transfer in one transaction. The existing human lease principal is
   retained on OAuth handoff, with the receiver identified separately in the
   executor and activity provenance. Admission and roles remain untouched.

The bounded flow is ordinary only after these facts are positively verified.
Static `authority` remains the fallback for unknown input, failed reads, legacy
calls and new admission. Existing `connectionDelegationFor` determines steering;
an environment label is never delegation. Production acquires no DEV exemption:
its current delegation and explicit approval policies continue to govern.

The executor writer must recheck the same predicate after classification. An
ordinary authorization decision is not permission to execute a newly changed
room. Refusal returns a typed stale/boundary result and never falls back to the
legacy immediate writer. Revoked token/grant/consent follows the existing
governor rather than a new exception.

## Durability, concurrency and presentation

Use command receipts for retry identity and the existing room row lock for
serialization. Store the request and terminal outcome on the existing activity
substrate; add no table or migration. A second acknowledgement reads the terminal
outcome and returns it without another transfer. A different payload reusing an
identity is refused. A changed lease must be detected even if the same principal
later holds it again: bind the executor and lease expiry as well as holder.
Normal unrelated timeline entries must not invalidate a request merely because
activitySequence advanced.

The room feed says "Handoff requested; waiting for the receiving assistant",
"Receiving assistant acknowledged; handoff completed", or "Handoff could not
complete: <reason>". Use existing semantic theme styles and feed components.
Pending is informational and does not ask the owner to approve. A real boundary
change gives the existing supported remedy. No timer-driven refresh, separate
chat ledger, decorative dashboard or new approval control.

Refactoring allocation: consolidate the snapshot/predicate shared by consequence
classification and the transactional executor writer. Keep parsing and lifecycle
handling outside the already large tool pack. Do not duplicate room admission,
principal identity or command-receipt logic.

## Research & Benchmarking

- [Temporal message passing](https://docs.temporal.io/encyclopedia/workflow-message-passing):
  tracked updates separate acknowledgement and completion and support validation.
  Adopt explicit outcomes and validation; reject fire-and-forget success for a
  transfer. Reuse DPF's durable log instead of adopting another workflow engine.
- [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/docs/index.md):
  adopt explicit work artifacts and proportional delivery; reject client-only
  process as proof of server authority. It is a benchmark, not a dependency.
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests):
  adopt stable retry identities and preserved results; reject re-executing a
  transfer to recover a lost response. Keep DPF's existing transactional receipts.
- [GitHub environment protections](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments):
  preserve explicit protection and independent decisions at consequential
  boundaries; reject repeating a human review for ordinary bounded execution.

Alignment: existing canonical Principal and Workroom identities; no new service,
dependency, credential, model or authority store. Additive MCP input fields retain
legacy semantics. Existing runtime/install, grant intersection, tenant and PR/DCO
contracts remain authoritative. This changes no industry value-stream ordering.

## Delivery and rollback

One atomic successor delivery under BI-B22C8E02: classification, request/receiver
workflow, transactional boundary checks, readback and regression evidence must
ship together. The plan is [bounded handoffs](../plans/2026-10-15-bounded-workroom-handoffs.md).
Independent review must judge this successor scope, not reuse PR #6202's approval.
Scope overlap on the tool-pack integration is held by WC-1D447592; resolve that
claim before editing the pack. No force override or competing write is authorized.

Rollback removes the new phase inputs/refinement and restores the static
authority floor. Historical activity and receipts stay readable. Pending requests
remain uncompleted; rollback never transfers a lease or changes permissions.
