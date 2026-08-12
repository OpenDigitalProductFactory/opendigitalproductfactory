# Local-CI host-capacity fencing and durable retry exhaustion

**Backlog:** `BI-56CA53FB`  
**Epic:** `EP-0DFF753B`  
**Status:** Planned

## Problem

`BI-872CB1BF` and PR #3915 delivered exact-tree stage receipts, bounded
diagnostics, actor-agnostic external-termination classification, and one
differentiated two-worker recovery. They intentionally did not prevent the
Windows stage host from disappearing.

The defect recurred after PR #3915 and the later queue/liveness corrections.
Manufacturing candidate `39930c837986` first lost a four-worker Vitest host
without an assertion. On exact integration tree
`ff9d749a332388a756c81869a65dcfb52b6d957d`, the prescribed two-worker
recovery also disappeared with status `4294967295`; its last durable heartbeat
showed seven descendants and about 2.4 GiB free. Lease `NPEL-3761C1EB2A` was
recovered and released. Low headroom is evidence for this event, not proof of
the terminating actor or a universal cause.

Two contract gaps turn that condition into repeated blocked delivery:

1. unsafe host pressure contracts the pool to one slot, never zero, so the
   remaining slot can start or continue work below its configured floor; and
2. when the outer wrapper disappears during the already-differentiated run,
   the `running` receipt does not durably say that the two-worker allowance was
   consumed, so a later invocation can repeat it.

## Design grounding

- Existing plans and runbooks reviewed:
  - `docs/superpowers/plans/2026-07-28-local-ci-sandbox-pool-pilot.md`
  - `docs/superpowers/plans/2026-08-01-local-ci-vitest-worker-diagnostics.md`
  - `docs/operations/local-ci-sandbox-slots.md`
  - `docs/testing/pre-pr-gate.md`
- Current substrate reviewed:
  - `apps/web/lib/nonprod/local-ci-pool-policy.ts`
  - `apps/web/lib/nonprod/environment-lease.ts`
  - `scripts/lib/local-ci-host-pressure.mjs`
  - `scripts/lib/lease-supervisor.mjs`
  - `scripts/lib/local-ci-stage-receipt.mjs`
  - `scripts/local-ci-vitest-runner.mjs`
  - `scripts/gate-worktree.mjs`
- Source of truth:
  - the versioned `PlatformConfig["local_ci.sandbox_pool"]` ceilings define
    install-local admission pressure;
  - the durable stage receipt owns attempt/recovery state for one exact
    integration tree;
  - the nonproduction lease remains FIFO authority.
- Decision:
  - permit zero runnable local-CI slots while a valid configured pressure
    ceiling is breached;
  - make a hard pressure loss on renewal fence the active descendant tree;
  - never promote a local-CI waiter on release/reap without a fresh claimant
    pressure observation;
  - persist the selected Vitest execution profile before child launch and make
    a vanished differentiated profile terminal runner evidence.

This extends existing contracts. It does not add a second resource monitor,
lease system, retry ledger, or terminating-actor theory.

## Implementation

### 1. Persist and enforce differentiated retry exhaustion test-first

- Extend `selectVitestRecoveryPlan` to distinguish:
  - ordinary first attempt;
  - first recovery after an externally terminated four-worker receipt; and
  - exhausted recovery after an externally terminated receipt that had already
    persisted the differentiated two-worker execution profile.
- Persist the chosen profile in the stage receipt before spawning Vitest.
- On exhausted recovery, write a terminal `runner-termination` receipt with the
  preserved prior host/heartbeat/profile evidence and exit with the existing
  runner-evidence status `86`; do not spawn another child.

Verification: Node tests prove a wrapper death before the first child
heartbeat still consumes the differentiated allowance, while a fresh
four-worker termination receives exactly one two-worker recovery.

### 2. Represent unsafe configured host pressure as zero runnable capacity

- Refactor host-pressure assessment into one pure policy helper reused for
  singleton and two-slot configurations.
- Preserve the current compatibility fallback when the pool policy is absent
  or malformed: capacity remains one because no install-specific ceiling is
  authoritative.
- When a valid policy exists and its current host observation breaches a
  ceiling or is unsafe/unmeasurable, return `hostSafeCapacity: 0`,
  `effectiveCapacity: 0`, and no runnable slot keys.
- Keep the precise actor-agnostic reason in the policy response.

Verification: policy tests cover capacity zero for memory, CPU, disk, Docker,
convergence, fence, isolation, stale, and unmeasurable observations; safe
requested-singleton and safe capacity-two behavior remain unchanged.

### 3. Preserve FIFO across admission, pressure loss, release, and reap

- Let zero slot keys keep the oldest claimant queued without changing its
  identity or FIFO position.
- During active renewal, inspect the returned current policy. Fence only hard
  execution-safety losses that make continued work unsafe (memory, disk,
  Docker, local fence/evidence integrity); do not evict a healthy owner merely
  because its own workload raises CPU.
- Stop release/reap from blindly promoting a local-CI waiter with a hard-coded
  slot. The waiter polls normally and supplies a fresh pressure observation;
  non-local-CI singleton environments retain immediate promotion.
- Record the pressure reason in lease events and gate evidence.

Verification: lease and gate tests prove low-memory admission queues at
position one, low-memory renewal terminates the active descendant tree,
release preserves the waiter, and the same waiter admits when a later fresh
observation is safe.

### 4. Document and verify the complete recovery contract

- Update the sandbox and pregate runbooks with capacity-zero semantics,
  pressure-loss fencing, bounded retry exhaustion, and the no-blind-promotion
  rule.
- Run focused Node/Vitest contracts from a compile-ready substrate; this
  worktree is currently source-only, so runtime-bound verification routes
  through the governed local-CI sandbox.
- Obtain independent semantic review of the exact committed tree, then run one
  governed pregate and publish through the normal DCO/merge-queue flow.
- After merge, rebase the frozen manufacturing branch using the runbook's
  explicit `--onto` form and run one materially changed exact gate. Success
  requires exhaustive Vitest, production Docker build, and durable evidence.

## Refactoring budget

Approximately 20% of this change is reserved for contract cleanup: extract one
host-safety assessment instead of duplicating threshold logic, give zero
capacity an honest type rather than encoding it as a special error, and make
the stage receipt—not transient observer output—the sole retry-exhaustion
authority.

## Risks and rollback

- **Over-fencing:** CPU can be high because the admitted gate is healthy. CPU
  blocks new admission but is excluded from active hard-loss fencing.
- **Queue stall:** capacity zero is reevaluated on every claimant poll; no
  operator release or claim-key rotation is required.
- **Fresh-install compatibility:** absent/malformed pool config keeps the
  established singleton behavior. Only a valid configured ceiling can reduce
  runnable capacity to zero.
- **False retry exhaustion:** the selected execution profile is persisted
  before child launch and bound to the exact stage identity. A changed
  integration tree starts a fresh recovery budget.
- **Unknown actor:** the change prevents unsafe continuation and retry loops;
  it does not infer who terminated Windows processes.

Rollback is a normal revert. It restores capacity-one fallback and the prior
stale-running recovery behavior without migrations or manual lease edits.

## Backlog coverage

- **Decision:** `atomic`
- **Receipt:** `cmsknldai011g01qplhox8e78`
- **Rationale:** admission, active-loss fencing, and durable retry exhaustion
  are one safety boundary. Shipping only one would either start work under
  unsafe pressure, leave a running child without authority, or preserve the
  cross-wrapper retry loop.
- **Parent:** `BI-56CA53FB`
