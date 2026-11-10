---
status: active
---

# Dispatched self-upgrade retry — BI-54284E21

The canonical ordered fix sequence is in
[Completed dispatched failures](../specs/2026-08-30-self-upgrade-exact-target-recovery-design.md#completed-dispatched-failures--bi-54284e21).
This coverage locator maps its one atomic deliverable to BI-54284E21.

| Deliverable | Requirements | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| Shared recovery eligibility and manual retry | OBJ-SUA-002, OBJ-SUA-003, OBJ-SUA-004, OBJ-SUA-006, OBJ-SUA-007 | SelfUpgradeAdmissionRepository.admit; triggerSelfUpgrade | /ops/self-upgrade | AC-SUA-010, AC-SUA-011, AC-SUA-012, AC-SUA-013, AC-SUA-014, AC-SUA-015, AC-SUA-016 |

Retain the baseline's existing exact-target, duplicate-worker, live-observation
and registration recovery tests (AC-SUA-010 through AC-SUA-014). Add the manual
dispatch-evidence regressions and preserve typed recovery (AC-SUA-015 and
AC-SUA-016). Run action and run-store tests, typecheck and live fresh admission.

No phase is independently shippable: the caller and store must use the same
eligibility rule. Normal authority, target selection, active-run exclusion and
the safety drain remain in force. The design owns scope, sequence and rollback.

## Backlog coverage

Atomic mapping: retry-contract → BI-54284E21. No internal dependencies.
The immutable coverage receipt is recorded in the live backlog.
