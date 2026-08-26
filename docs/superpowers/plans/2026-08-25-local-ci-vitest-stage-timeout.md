---
status: active
---

# Local-CI exhaustive-Vitest stage timeout implementation plan

- **Backlog item:** `BI-F3422349`
- **Workroom:** `WC-B7D92C90`
- **Design:** `docs/superpowers/specs/2026-08-25-local-ci-vitest-stage-timeout-design.md`

## Research evidence

- Frozen candidate `286b14ef3` under lease `NPEL-79E8B0C233` stopped emitting
  exhaustive-unit output at 01:16:40Z and stopped its stage-receipt heartbeat at
  01:20:48Z, while the Vitest worker and singleton lease remained alive beyond
  one hour. The process later disappeared without a terminal gate record.
- Source inspection shows `local-ci-vitest-runner.mjs` delegates every attempt to
  `createObservedProcessRunner` and forwards progress to the stage receipt, but
  the observer has no duration/finalization input. The gate therefore keeps
  renewing while the child PID stays alive even after useful progress stops.
- The smallest boundary is the Vitest attempt runner: add an opt-in duration to
  the shared observer, close the verified process tree through its finalizer,
  classify that close as runner infrastructure, and keep the existing single
  reduced-worker retry. Other stages remain unbounded and all tests still run.

## Requirement and contract map

| Ref | Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| `REQ-STAGE-BOUND` | Exhaustive Vitest cannot hold the governed gate indefinitely. | `CONTRACT-OBSERVER-DEADLINE` | `FLOW-DEADLINE-FINALIZE` | `VERIFY-OBSERVER-DEADLINE` |
| `REQ-FAIL-CLOSED` | A deadline is infrastructure runner termination, never a pass or product failure. | `CONTRACT-VITEST-CLASSIFICATION` | `FLOW-RECOVERY-BOUND` | `VERIFY-CLASSIFICATION` |
| `REQ-SCOPE` | Other observed process stages keep current duration behavior. | `CONTRACT-OPT-IN` | `FLOW-VITEST-WIRING` | `VERIFY-OPT-IN` |
| `REQ-EVIDENCE` | Terminal evidence identifies the configured bound and whether it fired. | `CONTRACT-STAGE-RECEIPT` | `FLOW-DEADLINE-FINALIZE` | `VERIFY-EXECUTABLE-RECEIPT` |

Canonical baseline mapping: `OBJ-BOUND` → `AC-VITEST-ONLY`; `OBJ-FINALIZE` →
`AC-TREE-CLOSE`, `AC-NON-PASS`; `OBJ-EVIDENCE` → `AC-RETRY-RECEIPT`.

## Atomic delivery

The observer deadline, Vitest opt-in, classification, and receipt evidence form
one safety boundary. Shipping only the timer could strand a child without a
terminal receipt; shipping only receipt fields would leave the indefinite hold;
shipping only classification would not make the child return. The work is one
atomic deliverable under `BI-F3422349`.

## Task 1: Pin the observer deadline red

**Files:**

- Modify `scripts/local-ci-vitest-runner.test.mjs`
- Modify `scripts/lib/local-ci-process-observer.mjs`

Add injected-child tests for `CONTRACT-OBSERVER-DEADLINE`. The first test keeps a
fake child open past a short injected deadline and must fail until the observer
sets `deadlineExceeded=true` and requests graceful process-tree termination once.
Add red cases where the child ignores the request: after the first 10-second
grace the observer force-terminates the same PID-bound tree, and after a second
10-second grace it returns `close-timeout` rather than waiting forever. Cover
Windows `/T` then `/T /F`, POSIX group `SIGTERM` then `SIGKILL`, a late zero exit,
termination errors, and the normal-close counterexample that clears every timer.

Run the focused test and retain the expected red output before implementation.

## Task 2: Implement the optional observer bound

**Files:**

- Modify `scripts/lib/local-ci-process-observer.mjs`
- Modify `scripts/local-ci-vitest-runner.test.mjs`

Add an optional positive `maxDurationMs`, bounded termination grace, and
injectable timer/process-tree seams to the observed-process factory. On expiry,
sample once, mark the deadline, and request graceful child termination. If the
same child remains open after the grace period, invoke the platform-aware
process-tree terminator for its verified PID. If the tree still does not close,
return a synthetic `close-timeout` after the final grace. The observer owns this
shared finalizer; it records stop/force/close outcomes and clears sampling,
deadline, escalation, and close timers on every terminal path.

Run `VERIFY-OBSERVER-DEADLINE` until green.

## Task 3: Wire the exhaustive-Vitest policy red/green

**Files:**

- Modify `scripts/local-ci-vitest-runner.mjs`
- Modify `scripts/local-ci-vitest-runner.test.mjs`

Add a failing contract test proving `createAttemptRunner` passes the configured
maximum duration. Parse `DPF_LOCAL_CI_VITEST_MAX_DURATION_MS` as a positive
integer with a 30-minute default. Include the value in attempt observations and
therefore in heartbeats/terminal receipt evidence. Do not change worker counts,
the command, reporter, or recovery budget.

Run `VERIFY-OPT-IN` until green.

## Task 4: Prove fail-closed recovery and executable evidence

**Files:**

- Modify `scripts/local-ci-vitest-runner.test.mjs`
- Verify `scripts/lib/local-ci-vitest-supervisor.mjs`

Exercise a timed child close through the real supervisor. Assert
`runner-termination` for deadlines, termination errors, `close-timeout`, and a
zero status observed after the deadline; allow one lower-worker retry and assert
terminal `retryExhausted=true` plus infrastructure exit 86 when both attempts
terminate. Preserve existing cases that deny retries for assertion failures and
exhausted identities. Run an executable runner fixture with a short explicit
bound and verify its stage receipt records configured duration, deadline, both
termination attempts, close/error outcome, PID/status/signal, samples, attempt
history, recovery disposition, exhaustion, and lease release from `finally`.

## Task 5: Review and ship

1. Run the focused Node suites for the observer, runner, supervisor, and stage
   receipt contracts.
2. Run `pnpm run pregate:preflight` and regenerate the doc index if required.
3. Commit with DCO sign-off and reconcile the Workroom to the immutable head.
4. Obtain independent exact-tree semantic review.
5. Run one governed exact-tree local-CI gate on the runner repair.
6. Publish a DCO PR, read bot findings and `pnpm pr:health`, and enter the
   protected merge queue.
7. Merge current main into the preserved self-upgrade branch only after this
   repair reaches `origin/main`; then run the self-upgrade candidate once under
   the repaired bounded runner.

## Backlog coverage

- Decision: atomic
- Parent: `BI-F3422349`
- Receipt: `cmt8b0pm10nku01mg49c9d6j9`
- Dependencies: none
- Deliverable: `bounded-exhaustive-vitest-finalization` → `BI-F3422349`
- Rationale: deadline, finalization, classification, and durable evidence are
  unsafe or ineffective when shipped separately.
- **Design gate:** passing receipt
  `initiative-58eb4c0f-3f4a-45ce-9e94-210b6ca25d9f` and canonical baseline
  `baseline-5fcad4ed-b99c-423b-9faa-ecc58be3977c` bind the immutable design.
- **Blocking condition:** source implementation must not begin until the atomic
  coverage writer accepts this immutable plan blob.
