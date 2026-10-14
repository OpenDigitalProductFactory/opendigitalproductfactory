---
status: draft
---

# Complete PR follow-through on the existing Workroom plane

Backlog: BI-ED7CD0DD. Workroom: WC-BA0FB550. Canonical design:
[PR follow-through](../specs/2026-10-01-pr-follow-through-workroom-duty-design.md).
This continues the remaining slices split from BI-88341B5D. It does not replace
the existing decision engine, recovery budget, Workroom, queue or runtime.

## Observed boundary

Source inspected at `cf2c5bb700a03663ce0bbd2f17b446152bb99147`:
`build-pr-delivery-reconciler.ts` defaults to shadow; its queue function deliberately
omits `dispatchRepair`. `startExternalWorkTool` registers a Workroom and does not
execute work. `runtime-request-policy.ts` holds remote pushes for a room decision.
The sandbox supervisor launches an agent in a supplied workspace; that alone
does not prove a workspace is bound to the PR's branch or authorize publication.
Fresh engine probes found four available CLIs, but no active Build Studio build.
No successful external-branch repair or autonomous pilot is claimed.

## Delivery sequence

Each deliverable remains covered by the already-filed continuation BI-ED7CD0DD.
Keep independently revertible boundaries; do not open documentation-only parking
PRs. The earlier decision/shadow slices remain covered by BI-88341B5D.

| Key | Requirement | Contract | Flow | Verification | Dependency |
| --- | --- | --- | --- | --- | --- |
| events | AC-1 | CT-EVENT-IDENTITY | FLOW-SIGNED-CI-INTAKE | VC-DUPLICATE-AND-STALE | none |
| repair | AC-2 | CT-EXACT-BRANCH-REPAIR | FLOW-BOUNDED-REPAIR | VC-OWNERSHIP-AND-PUBLISH | events |
| readback | AC-3 | CT-ROOM-READBACK | FLOW-ALARM-TO-ROOM | VC-ONE-ATTENTION | events |
| enablement | AC-4 | CT-SHADOW-SOAK | FLOW-ENABLE-AFTER-PROOF | VC-AUTONOMOUS-PILOT | repair, readback |

1. **Signed CI events.** Extend `git-promotion-intake.ts` and the existing
   `build-pr-delivery-reconcile` event handler, using the existing signature,
   delivery-ID dedupe and durable emit-pending/redelivery behavior. Accept the
   relevant completed check-suite/workflow-run and supported merge-group actions.
   Bind by repository and exact observed PR head. A merge-group integration SHA
   is not the authored PR SHA; resolve its member PRs and verify current heads.
   Missing, stale, foreign-repository and ambiguous identities never trigger a
   repair. Retain the five-minute safety net. Test invalid signatures, redelivery
   after emit failure, duplicate events and absent/fork PR arrays. Event payload
   contracts follow [GitHub's official reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

2. **Governed repair publication.** Resolve design section 8 with a controlled,
   owned disposable repair branch before wiring a real dispatcher. Reuse the
   Workroom runtime and existing sandbox workspace preparation. Prove the fetched
   repository, branch, expected head, clean workspace and owner lease match the
   packet. The runtime performs scoped source repair; publication remains a
   separate governed action with fresh grant and room-posture checks. Never
   automatically accept a generic outward-command permission request.
   Re-read the remote head and reject concurrent movement before a normal DCO
   push. Preserve the recovery cap of two and one dispatch per judged head using
   durable reservation before enqueue, including crash/redelivery cases. An
   unavailable worker spends no attempt. Restrict edits to the prior PR scope;
   forbid force-push, check dismissal, test weakening and merge actions. Validate
   scoped tests and independent changed-code review, then delegate final
   integration to protected GitHub checks. Bind publication evidence to the new
   head honestly; never relabel an old local pass as covering changed bytes.
   Test foreign ownership, stale head, grant refusal, duplicate dispatch, crash
   resume, exhausted budget and successful publication. Record the controlled
   probe's actual outcomes before replacing the existing unavailable-worker path.

3. **Room readback.** Route the three existing alarm scripts to canonical room
   evidence and existing attention dedupe. Extend `get_workroom` and heartbeat
   readback with the persisted repair decision; client hooks accelerate it.
   Verify one attention per unchanged failure and identical behavior for every
   executor. Do not create another ten-minute model monitor.

4. **Enable after measured soak.** Inspect actual live configuration rather than
   assuming the source default is the deployed mode. Record a shadow comparison
   for representative green, red-defect, infrastructure, stale and conflict PRs.
   Enable through the existing authorized configuration route only after those
   decisions and the controlled repair publication are verified. Run one bounded
   Build Studio pilot from existing ready work through source change, scoped
   verification, ready PR and protected merge. Admission, installed binaries and
   queued tasks are not pilot success. Canonical upgrades use request_self_upgrade;
   an existing admin_write refusal has no shell or browser alternative.

## Verification and stop conditions

Resolve graph-linked and colocated tests after exact code-path scope claims.
Reuse valid stage evidence; execute only changed-surface checks and mandatory
publication gates. Test deterministic identity and dedupe without live inference.
Reserve runtime inference for the single controlled capability probe and pilot.
Capture wall time, actual model calls, dispatch attempts, CI waits and final PR
outcome. No token or dollar savings are inferred from tool-call counts alone.

Stop a particular effect on foreign ownership, missing grant, ambiguous head or
unchanged provider failure; preserve its durable checkpoint and continue unrelated
authorized work. Infrastructure uncertainty is unrun/inconclusive, never pass.

## Risk and rollback

The material risks are duplicate repair execution, pushing over another author's
head, broadening runtime authority and enabling a dispatcher without proof.
Contain them with existing ownership and grants, exact-head checks, durable
per-head reservations and the unchanged protected merge queue. Disable the existing
reconciler mode through its authorized configuration route and revert the specific
concern through DCO PR if its evidence fails. Preserve outstanding room records and
attempts rather than deleting them. Plan coverage and review are required before
source implementation; this draft is not an approval or successful pilot receipt.
