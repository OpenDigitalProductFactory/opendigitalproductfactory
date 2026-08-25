---
status: proposed
---

# Local-CI exhaustive-Vitest stage timeout implementation plan

- **Backlog item:** `BI-F3422349`
- **Workroom:** `WC-B7D92C90`
- **Design:** `docs/superpowers/specs/2026-08-25-local-ci-vitest-stage-timeout-design.md`

## Requirement and contract map

| Ref | Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| `REQ-STAGE-BOUND` | Exhaustive Vitest cannot hold the governed gate indefinitely. | `CONTRACT-OBSERVER-DEADLINE` | `FLOW-DEADLINE-FINALIZE` | `VERIFY-OBSERVER-DEADLINE` |
| `REQ-FAIL-CLOSED` | A deadline is infrastructure runner termination, never a pass or product failure. | `CONTRACT-VITEST-CLASSIFICATION` | `FLOW-RECOVERY-BOUND` | `VERIFY-CLASSIFICATION` |
| `REQ-SCOPE` | Other observed process stages keep current duration behavior. | `CONTRACT-OPT-IN` | `FLOW-VITEST-WIRING` | `VERIFY-OPT-IN` |
| `REQ-EVIDENCE` | Terminal evidence identifies the configured bound and whether it fired. | `CONTRACT-STAGE-RECEIPT` | `FLOW-DEADLINE-FINALIZE` | `VERIFY-EXECUTABLE-RECEIPT` |

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
requests termination. Assert that the promise remains pending until `close`, the
result records `deadlineExceeded=true`, and the termination request occurs once.
Add the normal-close counterexample proving the timer is cleared.

Run the focused test and retain the expected red output before implementation.

## Task 2: Implement the optional observer bound

**Files:**

- Modify `scripts/lib/local-ci-process-observer.mjs`
- Modify `scripts/local-ci-vitest-runner.test.mjs`

Add an optional positive `maxDurationMs` and injectable termination/timer seam to
the observed-process factory. On expiry, sample once, mark the deadline, and
request graceful child termination. Resolve only from the existing `close`
handler and clear both sampling and deadline timers there.

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
`runner-termination`, one lower-worker retry, and terminal
`retryExhausted=true` when both attempts time out. Preserve existing cases that
deny retries for assertion failures and exhausted identities. Run an executable
runner fixture with a very short explicit bound and verify its persisted stage
receipt contains the deadline evidence and infrastructure exit code.

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

- **Decision:** `atomic`
- **Deliverable:** `bounded-exhaustive-vitest-finalization` → `BI-F3422349`
- **Rationale:** deadline, finalization, classification, and durable evidence are
  unsafe or ineffective when shipped separately.
- **Receipt:** pending governed `record_plan_backlog_coverage` after immutable
  provider verification of this plan blob.
- **Blocking condition:** no initiative scope baseline exists for this item.
  Source implementation must not begin until an independent reviewer reads the
  immutable design, persists a passing `spec-approval` receipt/baseline, and the
  atomic coverage writer accepts this plan blob.
