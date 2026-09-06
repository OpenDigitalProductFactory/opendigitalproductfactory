---
status: draft
---

# Provider-outage same-TaskRun replay plan

**Backlog item:** `BI-A50F6B7B`
**Tracking parent:** `BI-F6AD1E18`
**Delivery Workroom:** `WC-99420804`
**Parent evidence Workroom:** `WC-08FF9F3D`
**Design:** `docs/superpowers/specs/2026-09-05-provider-outage-same-taskrun-replay-design.md`

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion
gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Delivery boundary

`OUTAGE-SAME-RUN` is one atomic child repair. Classification without scheduled
recovery still strands a persisted wait when the ordinary async rollback flag
is off. Recovery without classification never receives the network outage as a
wait. Both changes reuse one existing state machine and must ship together.

The `BI-41EB722B` provider-transport change is protected-merged in the branch
ancestry. This child implementation then protected-merged through PR `#5088`
at `c081b6f69a7a4941ade6ae8a2aa21573ec033e29`. Its original exact research
TaskRun resumed after the terminal-writer repair and wrote receipt
`initiative-a62dd305-8953-4723-9187-4c50035d8783`. Independent spec approval
wrote receipt `initiative-a9d65966-7e92-45d4-8733-cb507643e832` and canonical
baseline `baseline-65b33c6d-4c95-4f82-a8d9-ece912c4abeb`. These durable
receipts, rather than model prose, establish the governed readiness state.

## Ordered implementation

1. Merge/rebase the protected BI-41 transport result normally. Confirm its raw
   aggregate failure shape and that no candidate edit path overlaps its owned
   inference/routing files.
2. In `apps/web/lib/tak/inference-dead-ends.test.ts`, add the exact red fixture
   `All endpoints failed ... Network error ... fetch failed`. Prove it is
   transient busy, while model inventory, credentials, policy/capability,
   sensitivity, context overflow, and an unrecognized aggregate are unchanged.
3. Implement the ordered narrow classifier in
   `apps/web/lib/tak/inference-dead-ends.ts`. Structural branches precede the
   transient aggregate matcher.
4. In `apps/web/lib/mcp-task-background-dispatch.test.ts`, add the red fixture
   for a stale submitted external-MCP TaskRun with a valid version-1
   `resourceWait` while `includeOrdinary` is false. Require one deterministic
   same-TaskRun queue event. Add invalid/raced wait negatives.
5. Extend `reconcilePersistedRemoteTaskDispatches` in
   `apps/web/lib/mcp-task-background-dispatch.ts` with a separate resource-wait
   database candidate and exact post-scan parser check. Reuse the existing CAS,
   event-id, and outbox code.
6. Add or extend a linked execution test proving the classified zero-tool
   outcome persists `status = submitted`, `completedAt = null`, and
   `resumeMode = same-taskrun`; a post-tool failure remains fail closed.
7. Run focused tests for inference dead ends, agentic loop, TaskRun execution,
   capacity resume, background dispatch/worker, and queue reconciliation. Run
   web typecheck, style/diff guards, and exact-tree local CI if admitted. Record
   unavailable local capacity as inconclusive/non-PASS; never waive a test or
   protected failure.
8. Publish one DCO PR after the BI-41 merge and require all protected PR and
   merge-group checks. Release/deploy only under coordinator authority. Live
   acceptance must exercise one controlled zero-tool provider outage, verify
   the same TaskRun stays submitted across restart, and observe automatic
   same-run recovery after service returns.

## Traceability

| Deliverable | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- |
| OUTAGE-SAME-RUN | OBJ-OUTAGE-REPLAY-1, OBJ-OUTAGE-REPLAY-2, OBJ-OUTAGE-REPLAY-3 | `resourceWait`; `resumeMode = same-taskrun`; deterministic same-TaskRun event identity | steps 1-8 | AC-OUTAGE-REPLAY-1, AC-OUTAGE-REPLAY-2, AC-OUTAGE-REPLAY-3, AC-OUTAGE-REPLAY-4, AC-OUTAGE-REPLAY-5, AC-OUTAGE-REPLAY-6 |

## Backlog coverage

- Decision: atomic
- Parent: `BI-A50F6B7B`
- Tracking umbrella: `BI-F6AD1E18`
- Deliverable: `OUTAGE-SAME-RUN` -> `BI-A50F6B7B`
- Dependencies: `BI-41EB722B` (protected-merged before implementation integration)
- Rationale: classifier and recovery selection are inseparable halves of the
  same already-persisted TaskRun wait contract; neither is useful alone.
- Research receipt: `initiative-a62dd305-8953-4723-9187-4c50035d8783`.
- Scope baseline: `baseline-65b33c6d-4c95-4f82-a8d9-ece912c4abeb`, approved by
  receipt `initiative-a9d65966-7e92-45d4-8733-cb507643e832`.
- Coverage receipt: recorded server-side against this immutable plan revision;
  the database activity is authoritative and the plan does not self-assert a
  receipt before the immutable revision exists.

## Source-only TDD evidence

- RED on the reconciled provider-transport ancestry: the exact all-endpoint
  network aggregate remained `unknown`, and a valid persisted resource wait was
  not selected when `includeOrdinary` was false.
- GREEN: focused classifier and dispatch tests pass, and linked TaskRun
  execution/capacity-resume tests confirm the existing zero-tool wait projection,
  immutable same-TaskRun replay, and post-tool fail-closed boundary.
- This is implementation evidence only. It is not a research receipt, scope
  baseline, plan-coverage receipt, semantic review, or promotion authority.

## Risks

- **Over-classification:** a structural aggregate could retry forever. Mitigate
  with ordered structural checks and explicit negative tests; unknown stays
  terminal.
- **Feature-flag surprise:** a rollback operator may expect no new background
  work. The exception is limited to work already persisted as a resumable wait;
  document and test it.
- **Retry churn during a long outage:** the scheduled fallback may wake once per
  reconciliation interval. It does not mint identities or duplicate writers;
  later parent children can add provider recovery-signal timing and telemetry.
- **Transport integration drift:** merge after BI-41 and test its real aggregate
  error shape rather than hardcoding the pre-repair stack text.

## Rollback

Revert the classifier and resource-wait candidate in one PR. No database or
TaskRun migration is required; version-1 waits remain manually resumable under
the existing trusted same-TaskRun recovery contract.
