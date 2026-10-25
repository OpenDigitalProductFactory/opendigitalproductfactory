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

Actions outside that reporting authority still pass through the existing permission and approval checks. A completed-work report does not acquire extra authority from this rule. Requests for credentials, changed ownership, or consequential actions retain their existing controls.

When a scheduled Workroom-stage task requests approval for a required action, its next periodic run is parked. The Workroom also waits on that run's recorded approval outcome, including across a new day. It does not create another request simply because no completing evidence has arrived.

A declined, expired, failed, cancelled, or unreadable outcome stays paused for reconciliation. Approval alone is not proof that the action ran. After recorded execution, the ordinary stage checks still require completing evidence before advancing. Transient execution failures retain the existing bounded retry policy.

Recording a blocker does not hide another action in the same run that still needs approval. If you choose **Ask again** for an expired request, work follows that exact replacement while preserving the old request in history. Executing the replacement releases that request's wait; a separate unanswered request still holds the work.

This prevents repeated requests from scheduled Workroom stages. Broader handling of repeated permission denials and changes to the approval-card layout are separate work.
