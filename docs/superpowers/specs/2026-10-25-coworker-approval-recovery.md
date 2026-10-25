---
title: Stop repeated approvals for scheduled Workroom blockers
status: active
backlog: BI-E458A9CB
date: 2026-10-25
---

# Stop repeated approvals for scheduled Workroom blockers

## Objective and scope

**OBJ-REPORT:** An assigned coworker can report that its own non-governed Workroom stage is blocked without asking the operator to approve the report.
**OBJ-WAIT:** A scheduled Workroom that has already requested a real approval waits for that outcome instead of generating another attempt.

This is the bounded scheduled-Workroom repair under BI-E458A9CB. It reuses the stage mandate, approval envelope, scheduled task, and writeback latch. No new table, tool, grant, or autonomous trust level is introduced. Generic non-Workroom denial parking remains tracked by the existing item until separately verified; this repair must not be presented as proof of every external caller's recovery.

## Reproduction and research

The operator's production inbox had 206 unique pending approvals on 2026-10-25. Of these, 200 were record_workroom_evidence calls: 194 blocked reports and six completed reports. Release-readiness room WC-C9320161 contributed 135 requests. The card rationale was the propose boundary. This is observation of proposed content, not verification that the blockers described are all still present.

Source at cfc3fd2592804133c796e04f14053676953a59e0 already provides scheduled mandates in room-stage-mandate.ts and the propose interceptor honors them. Ordinary operating shapes do not declare the evidence write. A new regression in room-stage-mandate.test.ts returned an empty mandate for the assigned release coworker's blocked report. Separately, writeback-latch-run.test.ts showed an unanswered proposal being counted as a failure and released for retry on the next cycle. Both tests executed and failed for their intended behavior in this worktree before implementation.

Prior designs: 2026-10-07-approval-convergence-on-envelope-design.md, 2026-09-25-decision-escalation-rule-table-design.md, and docs/architecture/workroom-cycle-continuity.md. Relevant delivered work: BI-C1781121 (scheduled room mandates), BI-E0D23FD5 (blocked evidence cannot complete a stage), and BI-62DB6C03 (mandatory writer visibility). BI-B22C8E02 covers delegated DEV maintenance; it is not permission to widen a production coworker's authority. BI-DAC3F63B retains stage precondition/read-grant repair. No new feature or dependency is proposed, so benchmarking is replaced by reproduction of the existing contracts.

## Contracts

CONTRACT-REPORT: A default reporting mandate applies only to record_workroom_evidence with outcome blocked, a nonempty summary, this scheduled run's room, a real non-governed stage, its declared evidence kind, and its assigned agent. Missing identity, room, stage, malformed inputs, other tools, completed outcomes, archived/terminal rooms, or governed decisions receive no new mandate. Existing explicitly declared stage mandates retain their contract. The monitor continues checking current grants, room admission, sensitivity, consequential actions, and explicit operator approval policy.

CONTRACT-WAIT: For a task carrying the server's Workroom-stage assignment, the scheduler records a proposed outcome without rearming its cron. Other cadences retain their existing scheduling policy. The drive observes the durable proposal state and holds without increasing failure counts or releasing merely because a daily cycle changed. A matching completed stage receipt still advances normally. Approval expiry, denial, or failure must remain visible; no old request is silently approved, replayed, or deleted. Normal bounded transient retries remain unchanged.

CONTRACT-EVIDENCE: A blocked record never earns a completing receipt. This repair cannot certify a success, accept a release, create credentials, change membership, spend money, or send externally.

## Ordered repair

1. Keep the two first-failing regression tests and extend the report matrix across wrong room, wrong agent, wrong kind/stage, governed stage, completed outcome, and missing run context. Resolve graph-linked tests before implementation.
2. Extend the existing mandate resolver and both existing consumers with exact-call context. Persist the current TaskRun on the scheduled task before the coworker executes. Permit only the CONTRACT-REPORT class, using server-read TaskRun source, current task assignment and room definition; do not add a tool-wide harmless flag or change shape grants.
3. Preserve the scheduler's proposed state as a wait: do not rearm the periodic task. Teach the existing drive latch to distinguish approval waiting from failed execution. Reconcile the linked envelope's terminal outcome before allowing a later attempt; retain no-outcome as a hold.
4. Run affected scheduler, interceptor, authority, stage receipt, latch, and drive tests plus web typecheck. Run style/module-size and documentation guards from the impact contract.
5. Run the governed exact-tree gate and independent semantic review, publish through DCO and the protected merge queue, and request the canonical upgrade through its normal authority boundary. Verify a real bounded blocked report writes evidence without an approval and cannot advance a stage; verify one genuine pending approval remains one request across repeated ticks.
6. Only after the producer is repaired, reconcile existing obsolete envelopes using supported owner-scoped lifecycle actions. Preserve the credential and Workroom authority requests for a current decision. Do not bulk-authorize the inbox.

## Acceptance and traceability

The existing BI criteria remain quoted verbatim; they are broader than the bounded repair and cannot be claimed complete from the narrow tests alone:

- A repeated call with unchanged facts writes no new authority row while parked.
- A deterministic deny files one capability need, not thousands.
- A pending approval is re-raised only when its facts change or it expires.

| ID | Objective | Observable result |
| --- | --- | --- |
| AC-REPORT | OBJ-REPORT | The exact assigned blocked report reaches the existing evidence writer without a human envelope; every boundary counterexample retains its normal gate. |
| AC-WAIT | OBJ-WAIT | An unanswered proposal is not rearmed by the scheduler or retried by the drive, including on the next cycle; terminal outcomes have an explicit reconciliation path. |
| AC-NOPASS | OBJ-REPORT | A blocked report cannot create a completing receipt or advance the stage. |
| AC-VERIFY | OBJ-WAIT | Source tests, typecheck, protected verification, and live behavior are recorded separately; no unrun check is reported passed. |

FLOW-REPORT: scheduled TaskRun -> exact own-stage report -> mandate -> governed evidence writer -> blocked evidence, no completion.
FLOW-WAIT: proposal -> durable wait -> envelope observation -> unchanged hold or supported terminal recovery.
VERIFY-REPORT: mandate/interceptor/authority negative matrix and stage-evidence-receipts tests.
VERIFY-WAIT: scheduler/drive repeated-tick tests and canonical runtime observation.

## Risk, rollback, and compatibility

The risk is accidentally treating an arbitrary evidence write as delegated work. Bound the new default to blocked reports on the assigned room/stage, and keep completed and consequential writes out. The other risk is parking forever after an approval settles; read the bound outcome and retain the existing recovery path. Existing rows and explicit mandates remain readable. No migration or install data patch is needed. Reverting the source restores prior escalation and retry behavior; it never changes recorded approval decisions.

## Backlog coverage

The initial published design received atomic coverage under BI-E458A9CB (receipt cmvo6vxrf5dko01qb5nsa83nw). The operator selected Medium repair within the existing process. This document is a repair design, not passing implementation evidence. The reporting and waiting changes form one scheduled-stage approval recovery boundary; neither permits a completion or a wider action. Broader denial parking and stage prerequisite repairs retain their existing live backlog records.

