---
status: draft
---

# Squash-safe delivery observation implementation plan

**Backlog item:** `BI-9FF39058`  
**Workroom:** `WC-162C6AAD`  
**Design:** [Squash-safe delivery observation](../specs/2026-09-06-squash-safe-delivery-observation-design.md)

## Scope and coverage

This is one atomic delivery slice from the delivery-closeout program. It changes
only GitHub inventory observation and Workroom liveness/reaping. Durable closeout,
host acknowledgement, acceptance execution, queue cancellation, and cost metrics
remain with their filed backlog items.

| Deliverable | Backlog item | Acceptance |
| --- | --- | --- |
| Immutable authenticated PR observation | BI-9FF39058 | AC-9FF-1 |
| Exact repository/PR/head merge selection | BI-9FF39058 | AC-9FF-2, AC-9FF-3 |
| Fresh-open and outage-safe merged semantics | BI-9FF39058 | AC-9FF-3, AC-9FF-4 |
| Shared classifier/reaper integration and fallback | BI-9FF39058 | AC-9FF-5 |

## TDD sequence

1. Red: prove the reader still requests only open PRs and drops head/merge/provider
   provenance. Green: emit the complete, fingerprinted `state=all` payload.
2. Red: prove URL/number presence falsely keeps a stale room live. Green: require a
   fresh exact-bound `open` observation.
3. Red: prove a source-free squash merge is missed and an older merge can attach to
   a later head. Green: select a matching provider merge only, retaining the latest
   monotonic observation per PR.
4. Regression: mismatched repository/PR/head, legacy/malformed payloads,
   stale-open, closed, duplicate/out-of-order observations, provider outage, and
   local positive ancestry fallback.

## Verification and delivery

Run the affected GitHub reader, liveness, reaper, inventory/read-model and lane
projection tests; run web typecheck, style drift and pregate preflight. Request the
exact-tree local gate only if capacity admits immediately; otherwise record the
operator-authorized infrastructure result as `INCONCLUSIVE`/non-PASS. Commit with
DCO, publish normally, open one protected PR, and require every protected PR and
merge-group check. This slice does not authorize release or live upgrade.
