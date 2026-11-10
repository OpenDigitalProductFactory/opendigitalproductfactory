---
title: Local-CI queue worker — implementation plan
slug: 2026-09-22-local-ci-queue-worker
status: draft
authoredAt: 2026-09-22
spec: docs/superpowers/specs/2026-09-22-local-ci-queue-worker-design.md
backlogItem: BI-A6DC9847
---

# Local-CI queue worker — implementation plan

Design: [The local-CI queue needs a worker, not a waiting room](../specs/2026-09-22-local-ci-queue-worker-design.md).

The sequencing matters more than the code here. The hazard is a host running
both the old per-session resumers and the new worker, double-executing a claim.
So the worker is built and proven to be capable of running a claim **before**
anything stops spawning resumers, and the resumer is removed only once the
worker is demonstrably taking turns.

## Phase 1 — Claim dispatch, read-only (BI to file)

Give the portal a way to answer "what is the next claim admitted to this host,
and where does it live". Read-only: no execution, no behaviour change, nothing
removed.

- An MCP read that returns the admitted claim for a host: `leaseId`,
  `branchName`, `worktreePath`, `claimKey`, `gateIdentity`.
- Host identity: a claim must be attributable to the host that may run it, so
  two machines sharing an organisation never take each other's turns.
- Tests: a claim admitted elsewhere is not returned; an expired claim is not
  returned; a claim with no worktree path is reported rather than skipped
  silently.

Shippable alone. Nothing consumes it yet.

## Phase 2 — The worker, alongside the resumer (BI to file)

Build the resident host worker and prove it can run a claim end to end. The
resumer keeps working and remains the path in use.

- `scripts/local-ci-queue-worker.mjs`: single-instance, polls the Phase 1 read,
  runs the gate in the named worktree, releases, repeats.
- **Single-instance ownership** enforced by a host lock, not convention
  (AC-QW-002). A second worker must refuse to start and say why.
- The worker writes NO verdict. It re-invokes the gate exactly as a first run
  does, so the gate's own state file stays the single source (AC-QW-005).
- **No console window** (AC-QW-004). This is the defect BI-69178E02 is fixing
  for the resumer; the worker must be born without it rather than inherit it.
- Liveness: the worker records a heartbeat so a dead worker is visible
  (AC-QW-008).
- Run it manually against a real queued claim and confirm the gate runs and the
  verdict lands.

Still no removal. A host with both running could double-execute, so during this
phase the worker is started by hand, never automatically.

## Phase 3 — Cut over (BI to file)

Make the worker the only executor, in one atomic change per host.

- `pregate` stops spawning the detached resumer on exit 75. It records the claim
  and exits (AC-QW-001).
- The worker becomes a managed host service, started by the install hygiene
  script that already registers the worktree janitor.
- Both halves land together. A `pregate` that no longer spawns a resumer, on a
  host with no worker running, is a queue that never drains — this is the
  sequencing hazard and the reason the two are one change.
- Verify: queue several claims from different worktrees, confirm each runs in
  turn with no session process alive and no console window.

## Phase 4 — Remove what the waiting required (BI to file)

Only once Phase 3 is proven on this host.

- Delete `scripts/local-ci-durable-wait-resumer.mjs` and
  `scripts/lib/durable-wait-resumer.mjs`.
- Remove `scripts/lib/local-queue-observer.mjs` — PID start-time comparison,
  recycled-PID detection and the 12-hour TTL exist solely to track waiting
  clients, and there are none (AC-QW-006). If any part is still needed, say why
  in the removal commit rather than leaving it unexplained.
- Resolve or withdraw the six symptom items with the reason recorded on each:
  BI-69178E02, BI-3C0A2D88, BI-D35B85BF, BI-EB864226, BI-31556F50, BI-91B1C23D.
  BI-D35B85BF deserves particular care: it added the resumer in good faith to
  keep a promise exit 75 was making, and it is being superseded rather than
  reverted.

## Phase 5 — Capacity, separately (BI to file)

Deliberately last and deliberately separate, because it is a different fix and
would otherwise mask whether Phases 1 to 4 worked.

- Establish why the pool offers one usable slot when two are configured.
- Revisit the `host-cpu-high` fence now that ~20 polling processes no longer
  contribute to host CPU. The threshold may be correct and the load may simply
  have been self-inflicted.

## What this plan does not do

It does not change admission policy, the gate key, the evidence contract, or
what `pregate:status` reports. It moves execution, not authority.

It does not attempt a portal-side runner. The gate needs the host toolchain and
the real worktrees; that constraint is in the design and rules it out.

## Coverage

Each phase files its own backlog item before implementation, per
`record_plan_backlog_coverage`. Phases 1 and 2 are independently shippable.
Phase 3 is the cutover and cannot be split. Phase 4 is removal only. Phase 5 is
separable and may be scheduled independently.
