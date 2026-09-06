---
status: active
---

# Dispatched self-upgrade retry — BI-54284E21

The canonical ordered fix sequence is in
[Completed dispatched failures](../specs/2026-08-30-self-upgrade-exact-target-recovery-design.md#completed-dispatched-failures--bi-54284e21).
This coverage locator maps its one atomic deliverable to BI-54284E21.

| Deliverable | Requirements | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| Shared recovery eligibility and manual retry | AC-SUA-015, AC-SUA-016 | SelfUpgradeAdmissionRepository.admit; triggerSelfUpgrade | /ops/self-upgrade | promotions.self-upgrade.test.ts; run-store.test.ts; typecheck; live fresh admission |

No phase is independently shippable: the caller and store must use the same
eligibility rule. Normal authority, target selection, active-run exclusion and
the safety drain remain in force. The design owns scope, sequence and rollback.

## Backlog coverage

Atomic mapping: retry-contract → BI-54284E21. No internal dependencies.
The immutable coverage receipt is recorded in the live backlog.
