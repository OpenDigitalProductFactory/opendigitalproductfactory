---
status: active
---

# Self-upgrade interruption durability — BI-41D7A057

The design owns scope, sequence and rollback:
[Self-Upgrade Interruption Durability](../specs/2026-09-06-self-upgrade-interruption-durability-design.md).
This coverage locator maps its one atomic deliverable to BI-41D7A057.

| Deliverable | Requirements | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| Durable promoter step trail and recorded interruption verdict | OBJ-SUI-001, OBJ-SUI-002, OBJ-SUI-003 | promote.sh emit_step; resolveRecoveryPredecessor; SelfUpgradeRun.completionEvidence | /ops/self-upgrade | AC-SUI-001, AC-SUI-002, AC-SUI-003, AC-SUI-004, AC-SUI-005, AC-SUI-006 |

One atomic change: a trail nobody reads is dead weight, and a reader with no
trail can only ever answer "unknown". The writer and the reader ship together.

Recovery eligibility, admission authority, the quiescence drain and the
operator's next action are unchanged. AC-SUA-015 and AC-SUA-016 from the
exact-target recovery design remain in force and are re-asserted by regression,
because the tempting version of this change breaks them.

Run the self-upgrade and action suites, the shell harness for `_persist_step`,
typecheck and the guard loop. Live acceptance is one self-upgrade whose trail is
present on the state mount afterwards.

## Backlog coverage

Atomic mapping: interruption-durability → BI-41D7A057. No internal dependencies.
The immutable coverage receipt is recorded in the live backlog.
