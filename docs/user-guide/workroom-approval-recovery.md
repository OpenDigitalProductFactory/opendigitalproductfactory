---
title: Workroom reports and approval waits
description: What coworkers can report themselves and how work waits for a decision.
relatedCode:
  - apps/web/lib/work-management/room-stage-mandate.ts
  - apps/web/lib/work-management/writeback-latch.ts
  - apps/web/lib/queue/functions/workroom-drive-stage-run.ts
  - apps/web/lib/actions/agent-task-scheduler.ts
  - apps/web/lib/tak/scheduled-task-runs.ts
---

# Workroom reports and approval waits

A coworker assigned to a scheduled Workroom stage can report that its own stage is blocked without asking you to approve the report. The report must name the same room and stage, use an evidence kind declared by that stage, and include a summary. It records the obstacle; it does not complete the stage or authorize the action that is blocked. Coworkers configured to require approval for every action retain that policy.

An author stage admitted under the existing standing authorization and funding can also record its declared completion evidence without another approval. This applies to the current assigned run and its own room and stage, while its membership and tool permissions remain valid. Explicit advice, proposal, and always-review policies retain their restrictions.

If that completion authority expires, is revoked, or is replaced by a later dispatch, the run can still report a blocker. It can reuse an exact approval that is already valid, and a retry returns an existing recorded outcome. It does not create another approval request for the withheld dispatch.

Other actions still pass through the existing permission and approval checks. Requests for external-provider consent, new spending authority, changed ownership, or consequential actions retain their existing controls.

When a scheduled Workroom-stage task requests approval for a required action, its next periodic run is parked. The Workroom also waits on that run's recorded approval outcome, including across a new day. It does not create another request simply because no completing evidence has arrived.

A declined, expired, failed, cancelled, or unreadable outcome stays paused for reconciliation. Approval alone is not proof that the action ran. After recorded execution, the ordinary stage checks still require completing evidence before advancing. Transient execution failures retain the existing bounded retry policy.

Recording a blocker does not hide another action in the same run that still needs approval. If you choose **Ask again** for an expired request, work follows that exact replacement while preserving the old request in history. Executing the replacement releases that request's wait; a separate unanswered request still holds the work.

## Qualification research when implementation is not yet admitted

When initiative readiness refuses implementation because research is missing, the recovery packet can offer a signed qualification admission for the named Workroom. This is not implementation authority and does not satisfy research by itself.

The admission has two separate one-start phases:

1. **Prepare** may read the pinned source and write only the exact named test or test-helper paths. It cannot run the tests. It records an exact candidate whose production bytes are unchanged.
2. An independent semantic review must accept that exact candidate head and diff. The server can then issue **Verify**, which may run the exact qualification test but cannot edit files or use auto-fix.

Each phase is bound to the item, Workroom, repository, base and head, protocol blob, installation, accountable principal, authority decision, stage, allowed paths, allowed tools, expiry, duration, and one start. A changed or previously used binding is refused. The stage's ordinary tool mandate is narrowed to this signed set; it is never widened by the recovery.

Only settled positive Verify evidence for the exact binding can satisfy the research lane. Negative, inconclusive, blocked, expired, conflicting, or incomplete evidence remains visible and keeps readiness closed. The design author must still record the ordinary governed research receipt before implementation can proceed.

This prevents repeated requests from scheduled Workroom stages. Broader handling of repeated permission denials and changes to the approval-card layout are separate work.
