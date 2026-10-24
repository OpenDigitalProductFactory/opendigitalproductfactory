---
title: Failure-analysis closeout recovery
status: binding
date: 2026-09-12
owner: platform
---

# Failure-analysis closeout recovery

## Problem

An immutable semantic-review request can become stale when its governed failure evidence changes before the background worker starts. The worker currently parks that immutable request as `input-required`, while semantic-review single-flight treats the parked run as active. A corrected submission therefore subscribes to a request that cannot become valid, permanently blocking Workroom completion.

## Objectives

- **OBJ-CLOSEOUT-001:** A stale immutable failure-analysis request must reach a truthful terminal state.
- **OBJ-CLOSEOUT-002:** A refreshed request for the same change must be admitted without rerunning or rewriting the stale request.
- **OBJ-CLOSEOUT-003:** Preserve immutable identity, authority, evidence, and exactly-once receipt guarantees.
- **OBJ-CLOSEOUT-004:** A legacy item that is already `done` must be able to reconcile newly available governed completion evidence without falsifying its original completion history.

## Acceptance criteria

| ID | Objectives | Observable proof |
| --- | --- | --- |
| AC-CLOSEOUT-001 | OBJ-CLOSEOUT-001 | Evidence drift before dispatch terminalizes the old TaskRun as failed with a refresh action and performs no reviewer dispatch. |
| AC-CLOSEOUT-002 | OBJ-CLOSEOUT-002 | A later request resolved from current evidence is not subscribed to the terminal stale attempt. |
| AC-CLOSEOUT-003 | OBJ-CLOSEOUT-003 | Revoked authority, uncertain provider outcomes, malformed counters, and concurrent delivery retain their existing fail-closed behavior. |
| AC-CLOSEOUT-004 | OBJ-CLOSEOUT-004 | An evidence-bearing `done` retry uses the canonical terminal transition, while an evidence-free retry remains a no-op. |
| AC-CLOSEOUT-005 | OBJ-CLOSEOUT-004 | Evidence reconciliation preserves the original `completedAt` value and emits no synthetic `done → done` status-change activity. |

## Boundary and recovery

The repair does not mutate an admitted packet, refresh evidence inside it, or infer a review result. The stale request remains auditable. The author submits a new immutable request whose evidence digest contributes to a new gate identity. Existing bounded dispatch, recovery, and receipt publication remain unchanged.

The completion extension is similarly narrow. It does not reopen a delivered item or relax completion policy. A retry that supplies `completionEvidence` re-enters the canonical governed terminal transition so the server can validate and durably reconcile that evidence. The compare-and-set remains bound to `status=done`; historical completion time and status-change history are immutable.
