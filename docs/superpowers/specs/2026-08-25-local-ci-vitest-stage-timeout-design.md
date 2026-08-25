---
status: proposed
---

# Bounded exhaustive-Vitest stage termination

- **Backlog item:** `BI-F3422349`
- **Workroom:** `WC-B7D92C90`
- **Incident candidate:** `286b14ef3e70bb55a11f7cbd3b9155cc0949d491`
- **Incident evidence:** `cmt8185by0gfi01mgcyu4jhq0`

## Problem

The governed exact-tree gate can remain `running` forever when the exhaustive
Vitest child remains alive after output and useful work stop. The stage observer
continues sampling the live process, the parent gate keeps renewing its lease, and
neither layer has a maximum stage duration. In the captured incident, the durable
stage heartbeat became stale, the child remained idle, and the lease outlived the
intended bounded gate. The processes later disappeared without a terminal pregate
record, so the stale run had to be reconciled as infrastructure evidence rather
than a product failure.

This is not a reason to weaken the exhaustive suite, shorten the shared lease, or
guess that an idle process is a failed test. It is a missing finalization boundary
for one expensive child stage.

## Existing substrate

The repair extends the existing runner and receipt contracts:

- `scripts/lib/local-ci-process-observer.mjs` owns child spawn, streamed output,
  host samples, and close-result capture.
- `scripts/local-ci-vitest-runner.mjs` owns the exhaustive-Vitest command,
  differentiated recovery, heartbeats, and terminal stage receipt.
- `scripts/lib/local-ci-vitest-supervisor.mjs` already classifies a signal or
  otherwise opaque child exit as `runner-termination`, distinct from a test
  assertion failure.
- `scripts/lib/local-ci-stage-receipt.mjs` already persists the final stage
  classification and exact integration-tree identity.

No new scheduler, database row, lease type, or product-facing status is needed.

## Decision

Add an optional maximum duration to the generic observed-process runner, but
enable it only for the exhaustive-Vitest stage. The Vitest runner supplies a
conservative 30-minute default through
`DPF_LOCAL_CI_VITEST_MAX_DURATION_MS`; a positive explicit value may tune the
host contract without changing product tests.

When the deadline expires:

1. record a final progress sample and a deadline observation;
2. request graceful termination through the child-process API;
3. if the child has not closed within a short bounded grace period, terminate
   the verified child process tree through the existing platform-aware gate
   substrate (`taskkill /T` on Windows and process-group termination on POSIX);
4. wait for the child's normal `close` event so the existing observer/finalizer
   path clears timers, captures signal/status/output/host evidence, and returns;
5. classify the result through the existing `runner-termination` path;
6. allow the existing one differentiated recovery attempt at the lower worker
   count, then persist `retryExhausted=true` if that bounded attempt also ends as
   runner termination.

The deadline does not turn an assertion failure into infrastructure evidence.
If Vitest exits with its normal failed-test summary before the deadline, the
existing test-failure classifier remains authoritative.

## Safety invariants

- The same exhaustive test inventory still runs; no test, shard, reporter, or
  assertion is skipped.
- Only the exhaustive-Vitest runner opts into the duration bound. Typecheck,
  build, and other observed commands keep their existing behavior.
- A timeout is `runner-termination`, never `passed` and never a product red.
- The exact integration-tree identity and existing one-retry budget remain
  unchanged.
- A deadline clears on normal child completion and cannot terminate a later
  process.
- Escalation is bound to the observed child PID and occurs only if that same
  attempt remains open after the grace period; it may not target a discovered
  or caller-supplied unrelated PID.
- The observer waits for `close`; it does not resolve early while descendants or
  pipes may still be active.
- The stage receipt includes the configured maximum duration and whether the
  deadline fired, making the terminal evidence auditable.
- Lease release remains the parent gate's normal `finally` responsibility. The
  runner repair guarantees that the child stage returns to that path.

## Verification

Test-first coverage must prove:

1. an observed child that never closes receives exactly one termination request
   at the configured deadline;
2. a child that ignores the graceful request receives one verified process-tree
   escalation after the grace period, while a child that closes does not;
3. the observer still resolves only after `close`, reports
   `deadlineExceeded=true`, and clears its deadline on normal completion;
4. the Vitest attempt runner passes the configured maximum duration while a
   generic observed process remains unbounded by default;
5. the existing supervisor maps the timed termination to
   `runner-termination`, preserves one differentiated retry, and never retries a
   real failed-test summary;
6. the executable runner persists the terminal receipt and exits through its
   existing infrastructure code after the retry budget is exhausted.

Focused Node tests, pregate preflight, independent semantic review, and a fresh
exact-tree local-CI pass are required before publication.

## Scale and rollback

The deadline adds one timer per opted-in child and constant-size receipt fields.
It adds no polling, database traffic, or retained unbounded output. Thirty minutes
is materially above observed healthy exhaustive-suite durations while bounding
the captured hour-plus stall.

Rollback is a normal revert of the optional deadline wiring. Existing receipts
remain readable because new fields are additive.
