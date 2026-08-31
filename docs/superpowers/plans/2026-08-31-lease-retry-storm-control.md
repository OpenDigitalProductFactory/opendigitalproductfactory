---
status: draft
---

# Plan: bounded nonproduction lease retries

**Backlog:** BI-MCP-EFF-CD5F744B
**Spec:** `docs/superpowers/specs/2026-08-31-lease-retry-storm-control.md`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Ordered deliverables

1. **Response contract (independently shippable):** Make terminal lease/evidence failures carry typed `retryable: false` remediation and make queued responses explicitly durable-waiting. Touch only the existing nonprod lease MCP handler and its focused tests. Verify the 102-retry fixture and unchanged-argument behavior.
2. **Caller guidance (independently shippable):** Update `dpf-use-shared-nonprod-environment` with event-first waiting, one bounded reconciliation fallback, and stop-on-terminal-error wording. Verify skill metadata/lint and the no-blind-retry examples.
3. **Telemetry and regression coverage (internal sequencing):** Add or extend existing lease/queue telemetry assertions for suppressed duplicate claims and terminal reasons. Verify admission safety, FIFO behavior, and existing synchronous flows remain unchanged.

## RED → GREEN sequence

1. Reproduce the 102 fail→retry storm with a deterministic handler fixture; assert the current response lacks a terminal retry classification.
2. Add the smallest typed response metadata and remediation text; make the fixture pass without changing admission or pressure policy.
3. Add queued-wait and same-claim-key idempotency assertions; fail closed for invalid evidence, owner mismatch, and terminal leases.
4. Update the shared-environment skill and lint it. Confirm the instructions never recommend repeated claim calls while queued.
5. Run proportional focused tests and type/style checks. If local dependencies or the shared runtime are unavailable, record them as inconclusive and use the governed convergence lane; do not claim PASS.

## Completion gate

- Independent reviewer baseline and live plan-coverage receipt for BI-MCP-EFF-CD5F744B.
- Focused handler/skill tests, adjacent nonprod lease tests, and protected CI green.
- DCO-signed commit, protected PR/merge queue, and no duplicate lease identity in the 102-retry fixture.
- Runtime verification shows a queued caller remains dormant and a terminal failure stops without creating a sibling lease.

## Backlog coverage

This plan has three deliverables. Deliverables 1 and 2 are independently shippable but both belong to BI-MCP-EFF-CD5F744B because they are one contract correction with no safe standalone user value. Deliverable 3 is internal sequencing. A live `record_plan_backlog_coverage` receipt must be copied here before implementation completion.
