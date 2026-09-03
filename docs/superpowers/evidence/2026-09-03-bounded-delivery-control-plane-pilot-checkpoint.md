---
status: active
---

# Bounded Delivery Control Plane — Pilot Checkpoint

Backlog: `BI-7C1F43E3`  
Design: `docs/superpowers/specs/2026-08-30-bounded-delivery-control-plane-design.md`  
Plan: `docs/superpowers/plans/2026-08-30-bounded-delivery-control-plane.md`  
Checkpoint opened: 2026-09-03  
Measurement owner: `WC-1B73A988`

## Decision

Keep the delivered gate identity, evidence lanes, durable lease wait, resource
lanes, and liveness projection enabled. Do not close `BI-7C1F43E3` yet. The
current implementation still leaves one local client polling quiescence, and
the efficiency analyzer reports healthy machine cadence as thrash. This branch
repairs those two measurement and waiting defects. The required seven-day
post-deployment acceptance window starts only after that repair is protected,
released, and live.

## Delivered rollout slices

| Capability | Carrier | Protected delivery |
| --- | --- | --- |
| Proportional evidence lanes before heavyweight admission | `BI-B2E9FC9D` | PR #4647 |
| Immutable gate identity and coalescing | `BI-6A5AB570` | PR #4652 |
| Durable lease waits, event wake, and truthful Workroom projection | `BI-MCP-EFF-0285909C` | PR #4885 |
| Resource-class lanes | `BI-30EDD4B0` | PR #4659 |
| WIP and liveness projection | `BI-114C1F40` | PR #4885 |
| Bounded nonproduction retry contract | `BI-MCP-EFF-CD5F744B` | PR #4899 |
| Typed impacted-test discovery guidance | `BI-MCP-EFF-7AFED9F2` | PR #4901 |
| Typed plan-coverage guidance | `BI-MCP-EFF-B5F7D216` | PR #4902 |

The source changes are present on current protected `main`. Several historical
carrier statuses remain open because their independent scope baselines and
acceptance receipts were never persisted. That is governance debt, not evidence
that the merged source is absent; it must not be converted into inferred PASS.

## Pre-repair live checkpoint

`analyze_mcp_call_efficiency` was run read-only on 2026-09-03 after the live
portal returned from a governed upgrade.

| Window | Calls | Success | Wait-related observations |
| --- | ---: | ---: | --- |
| 1 hour | 137 | 98.54% | 11 quiescence reads; no lease claim/list in the top tools |
| 12 hours | 2,243 | 99.64% | 815 quiescence reads, 14 claims, 14 lists, 182 lease renewals |
| 24 hours | 5,000 (ledger cap) | 94.94% | 1,349 quiescence reads, 79 claims, 90 lists, 345 renewals |

The 12-hour ledger is below the cap and is the usable comparison window. It
proves that lease admission polling fell sharply, but quiescence polling still
dominates and therefore the complete ≥95% wait-call target is not yet met.

The queue snapshot at 2026-09-03T20:07Z reported the local-integration lane as
healthy with depth 0, WIP 0, 39 arrivals, 29 completions, wait p50 5 ms, wait
p95 35 minutes, cycle p50 15 minutes, cycle p95 47 minutes, first-pass yield
100%, and abandonment 13%. Protected `main` recorded two merged PRs in the
preceding 12 hours (0.17 PR/hour), below the pilot target of 3 PR/hour.

## Corrective slice on this branch

1. `gate-worktree.mjs` reads authoritative quiescence once. When writes are
   refused it records `blocked_quiescence`, emits the machine-readable
   `local_ci_quiescence_wait` result, claims no lease, runs no CI, and exits 75.
   The caller resumes after the server-owned coordinator completion instead of
   keeping a polling process alive.
2. `analyzeCallEfficiency` applies the existing contractual cadence policy to
   both high-volume and per-principal thrash findings. A 60-second edge
   heartbeat or ≥30-second active-lease renewal remains visible in totals but is
   not mislabeled as waste. Faster-than-contract cadence still produces a
   finding.

## Verification at this checkpoint

- Analyzer regression: 13/13 tests passed.
- Pregate recovery regression: 14/14 tests passed.
- Gate/pregate adjacent contracts: 69 tests, 67 passed and 2 platform-specific
  skips; zero failures.
- Web type generation completed. The TypeScript compiler process completed
  without diagnostic output; the final protected gate remains authoritative.
- No production migration and no material user-facing UI change are in scope.

## Seven-day acceptance window

The post-live window must publish all of the following before closure:

| Metric | Target | Current disposition |
| --- | ---: | --- |
| Wait-only claim/list/quiescence calls | ≥95% reduction | Not yet proven |
| Duplicate gate executions per immutable key | 0 | Source contract delivered; pilot proof pending |
| Event wake p95 | <15 seconds | Pilot proof pending |
| Missed-event reconciliation | <5 minutes | Source contract delivered; pilot proof pending |
| Waiting queue CPU p95 | <1 second/minute | Pilot proof pending |
| Workroom without transition/blocker | none >30 minutes | Pilot proof pending |
| Throughput | ≥3 PR/hour | Current 12-hour checkpoint: 0.17 PR/hour |
| Protected-check and first-pass quality | unchanged | Local queue snapshot first-pass yield 100%; seven-day proof pending |

If a target misses after this corrective slice is live, disable only the
affected polling consumer or lane, preserve every evidence row, and continue
from the durable wait identity. Do not roll back by replaying an immutable gate
or deleting failed history.
