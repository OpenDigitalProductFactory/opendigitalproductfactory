---
status: active
---

# Durable remote TaskRun request packet plan

**Backlog item:** BI-2014236E  
**Workroom:** WC-42C01441  
**Design:** `docs/superpowers/specs/2026-09-05-durable-remote-task-request-packet-design.md`

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion
gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Atomic delivery

`REMOTE-PACKET` is one atomic repair. The submit path must persist the exact
normalized objective in the existing immutable packet, and the background
worker must select that server-owned value before validating the existing
request digest. Shipping either side alone leaves new TaskRuns unrecoverable or
introduces an unused duplicate field.

## Ordered implementation

1. In `apps/web/lib/mcp-task-submit.test.ts`, reproduce an external request
   whose objective is longer than 1,000 characters and prove the full
   normalized value is not included in the server-owned creation metadata.
2. In `apps/web/lib/mcp-task-background-worker.test.ts`, reproduce the live
   bounded-row/full-digest mismatch. Prove legacy short rows still reconstruct
   and a conflicting durable objective still fails closed.
3. In `apps/web/lib/mcp-task-submit.ts`, persist `requestObjective` from the
   parsed request in the TaskRun's existing `a2aMetadata` transaction.
4. In `apps/web/lib/mcp-task-background-worker.ts`, use a valid durable
   `requestObjective` when present and otherwise retain the legacy bounded-row
   fallback. Keep the canonical digest comparison as the final authority check.
5. Run the colocated worker/submit tests, graph-linked capacity, approval,
   terminal-writer, and readiness-grant suites, web typecheck, style guard, and
   preflight. Record an occupied local immutable lane as inconclusive if
   necessary; never waive deterministic or protected failures.
6. Publish one DCO PR and require protected merge checks. Release and deploy one
   canonical artifact, verify exact served SHA/CAN-TEST, then create one fresh
   immutable BI-801 review identity. Preserve the corrupted historical TaskRun
   as audit evidence.

## Traceability

| Deliverable | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- |
| REMOTE-PACKET | OBJ-REMOTE-PACKET-01, OBJ-REMOTE-PACKET-02, OBJ-REMOTE-PACKET-03 | AC-REMOTE-PACKET-01, AC-REMOTE-PACKET-02, AC-REMOTE-PACKET-03 | steps 1-6 | AC-REMOTE-PACKET-04 |

## Backlog coverage

- Decision: atomic
- Parent: BI-2014236E
- Deliverable: REMOTE-PACKET -> BI-2014236E
- Dependencies: none
- Rationale: persistence and reconstruction are the two sides of one immutable
  packet contract and cannot be deployed independently.
- Receipt: `cmtnut9ww026z01n9wzgyqmvu`

## Rollback

Disable writing `requestObjective` and revert the worker selection. The field
is additive JSON metadata, so rollback needs no schema or data migration and
legacy short-objective reconstruction remains unchanged.
