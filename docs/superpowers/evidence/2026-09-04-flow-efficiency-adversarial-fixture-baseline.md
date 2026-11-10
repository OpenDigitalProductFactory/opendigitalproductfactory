---
status: active
---

# Flow-efficiency adversarial fixture baseline

- **Backlog item:** `BI-7C1F43E3`
- **Scorecard consumer:** `BI-69803ACC`
- **Design:** `docs/superpowers/specs/2026-09-04-flow-efficiency-adversarial-fixtures-design.md`
- **Plan:** `docs/superpowers/plans/2026-09-04-flow-efficiency-adversarial-fixtures.md`
- **Measurement kind:** deterministic fixture baseline; not a completed pilot window

## Decision

Use the fixture identities and logical counters below as the reproducible Phase 1
safety baseline. Use
`docs/superpowers/evidence/2026-09-03-bounded-delivery-control-plane-pilot-checkpoint.md`
for the observed pre-repair throughput and MCP-call baseline. Do not combine the two
into a claimed seven-day result: that observation window remains open until the
corrective runtime is released and has served the full duration.

## Deterministic fixture ledger

| Acceptance | Vitest file and fixture identity | Deterministic baseline |
|---|---|---|
| AC-FEAF-001 | `lib/work-capsules/worktree-binding-recovery.test.ts` — `makes partial create cleanup idempotent and path-verified` | unverified path = `recovery-required`; compensated create = `retryable`; duplicate execution count = 0 |
| AC-FEAF-002 | `lib/work-capsules/worktree-binding-recovery.test.ts` — `fences the old writer before replacement after delete` and `after loss` | cleanup before fence = refused; replacement before fence = refused; fenced replacement = permitted; lost Git evidence = terminal; duplicate execution count = 0 |
| AC-FEAF-003 | `lib/work-capsules/liveness.test.ts` — the three `AC-FEAF-003` fixtures; `lib/work-capsules/liveness-inventory.test.ts` — `loads the linked TaskRun independently...` | terminal turn = `execution-terminal`; nonterminal durable wait = `durable-wait`; terminal turn plus durable wait = `recovery-required` |
| AC-FEAF-004 | `lib/work-capsules/activity-stream.test.ts` — the four `AC-FEAF-004` fixtures | 19 replaceable progress events coalesced; 2 fairness partitions retained; four-event batch ceiling honored; a two-event batch gives each active partition one slot; the deferred queue rotates to a third partition that missed the prior ceiling; consequential overflow is deferred without coalescing and keeps per-partition order |
| AC-FEAF-005 | `lib/work-capsules/activity-stream.test.ts` — the two `AC-FEAF-005` fixtures | verified three-entry gap advances cursor 4 → 7 with one snapshot recovery; incomplete or repeated recovery = refused; recovery attempt count ≤1 |
| AC-FEAF-006 | `lib/tak/thread-checkpoint.test.ts` — the four `AC-FEAF-006` fixtures | oversize history = metadata-only; oversize evidence metadata = handoff-required; smallest supported payload = 2 UTF-8 bytes; payload downgrade count = 1 |

The counters are logical outcomes from injected observations, cursors, and byte
budgets. Wall-clock duration is intentionally excluded because it would make this
unit-fixture baseline nondeterministic. Runtime event-wake and queue timing remain
seven-day pilot measures rather than inferred fixture results.

## Local verification checkpoint

The current implementation checkpoint passes five focused Vitest files with 53
tests and passes the web TypeScript check. The authoritative result remains the
protected PR and merge-group evidence for the immutable implementation tree.

## Observed pilot baseline carried forward

The existing live checkpoint records the usable pre-repair 12-hour comparison:
2,243 MCP calls, including 815 quiescence reads, 14 claims, 14 lists, and 182 lease
renewals; two protected PRs, or 0.17 PR/hour. These are observed values, not targets
or post-change results. The scorecard must compare a completed post-live window to
that recorded baseline and keep the ≥95% wait-call reduction and ≥3 PR/hour targets
explicit.
