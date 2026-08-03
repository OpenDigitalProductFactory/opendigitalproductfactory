# Local-CI heavy-stage diagnostics and bounded recovery

**Backlog:** `BI-872CB1BF`
**Epic:** `EP-0DFF753B`
**Status:** Verification

## Problem

The Windows local-CI host can return `-1` (serialized by the outer pregate
record as `4294967295`) during any long-running gate stage, without a terminal
assertion or child-process diagnostic. The first reproductions ended during
exhaustive Vitest. A later exact restaurant run launched from Windows Task
Scheduler passed 2,497 files / 21,411 tests, then the host disappeared during
the Docker production build. Its reconstructed default task settings use a
72-hour execution limit, which rules out the tempting 15-minute Task Scheduler
limit hypothesis but does not prove the terminating actor.

The command executor writes final metadata only after the entire plan. A host
termination therefore loses the last stage, progress, and host evidence and
forces an unchanged gate to repeat already-proven expensive work.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/operations/local-ci-sandbox-slots.md`
  - `docs/testing/pr-health.md`
  - `docs/superpowers/plans/2026-07-28-local-ci-sandbox-pool-pilot.md`
- Current code substrate reviewed:
  - `scripts/lib/local-integration-ci.mjs`
  - `scripts/local-integration-ci.mjs`
  - `scripts/gate-worktree.mjs`
  - `scripts/pregate.mjs`
  - `apps/web/vitest.config.ts`
- Exact-tree receipt work already in flight:
  - `BI-9585E580` attests complete GitHub merge-group evidence for identical
    main-push reuse. This plan does not create another workflow receipt or
    change GitHub gate allocation; it checkpoints interruptible stages inside
    the governed local-CI run.
- Source of truth:
  - the local-integration plan remains the execution authority;
    `dpf-local-ci-metadata.json` and the gate evidence record remain the
    durable evidence surfaces.
- Decision:
  - supervise every expensive stage with an exact-tree durable receipt;
  - preserve the same full Vitest suite, first try with four workers, and permit
    one explicitly classified recovery with two workers only after a runner
    termination with no failed assertion;
  - checkpoint Docker build health, child identity, output tail, and terminal
    result every watchdog sample;
  - reuse a passed stage only when candidate/integration identity is exact and
    its required artifact still exists.

## Implementation

### 1. Define termination and retry semantics test-first

- Add pure classification helpers for `passed`, `test-failure`, and
  `runner-termination`.
- Treat a failed-assertion summary as product/test evidence and never retry it.
- Treat `-1`, missing status, signal/error, or a nonzero exit without a terminal
  Vitest summary as runner termination.
- Allow exactly one differentiated retry at two workers.

Verification: Node tests cover `-1`/`4294967295`, signal, assertion failure,
normal pass, and the one-retry bound.

### 2. Add the streaming Vitest supervisor

- Stream stdout/stderr unchanged so the live lease heartbeat and operator log
  remain useful.
- Keep a bounded output tail and sample the child/descendant process
  tree plus host memory while the suite runs.
- Run Vitest with the verbose reporter so the last completed test is observable.
- Write a structured diagnostics file on every attempt and a terminal summary
  after pass, assertion failure, or repeated runner termination.

Verification: injected child-process tests prove output streaming, bounded tail,
attempt classification, and process/host samples survive a simulated `-1`.

### 3. Add stage-independent receipts and production-build observation

- Write `running` before each heavy child starts, refresh a bounded observation
  tail while it runs, and write one terminal state with exit code and evidence.
- Preserve the prior running receipt when its host PID no longer exists, so a
  later run records `externally-terminated` without naming an unproven actor.
- Let the bounded Docker build reuse a passed receipt only for the same
  integration tree and image tag and only while the tag still resolves to the
  exact image ID recorded by the passed receipt.
- Let Vitest reuse its passed exact-tree receipt when a later stage was the one
  interrupted, avoiding another 21k-test pass.
- When a prior Vitest receipt is still `running` but its host is gone, resume
  the next exact-tree run at the two-worker differentiated profile instead of
  repeating the four-worker profile that already terminated.
- Route web typecheck through the same exact-tree receipt boundary. Record the
  compiler descendant tree, host samples, bounded output, and distinguish a
  real TypeScript exit from the `0xFFFFFFFF` wrapper-loss family observed after
  route generation completed.

Verification: pure receipt tests pin identity matching, external-termination
classification, atomic heartbeat/terminal writes, and transient Windows rename
lock recovery; build integration tests pin receipt publication and
artifact-presence checks.

### 4. Integrate without weakening the gate

- Replace the direct typecheck and Vitest argv in `createLocalIntegrationPlan`
  with supervised stage commands.
- Persist failure metadata before `local-integration-ci.mjs` exits so
  `gate-worktree` can include Vitest and production-build receipts in
  `evidence.content` on red runs.
- Keep migrations, guards, exhaustive coverage, production build,
  freshness, FIFO admission, and lease release unchanged.

Verification: plan-contract tests assert ordering and the four-worker then
two-worker recovery policy; existing pregate recovery tests stay green.

## Risks and rollback

- **Log volume:** verbose Vitest output is streamed, while retained diagnostics
  and build output use bounded tails. Roll back the reporter flag independently
  if output cost proves excessive; do not remove structured diagnostics.
- **False retry:** retry is denied whenever the output contains a terminal
  failed-test summary. Classification tests pin this boundary.
- **Masked product failure:** the second attempt still runs the same exhaustive
  suite and must pass before build. No retry result can convert a failed
  assertion into green.
- **Cross-platform process sampling:** host sampling is best-effort and
  diagnostic only. Failure to sample never changes the test verdict.
- **Stale receipt:** identity includes the synthesized integration tree and
  command/artifact identity. A mismatch reruns the stage. A production build is
  never reused if the image is absent or the mutable tag resolves to a
  different image ID.
- **Unknown terminating actor:** receipts classify the observable condition,
  not a guessed cause. This change improves diagnosis and safe resumption; it
  does not claim to prevent an external Windows termination whose actor has not
  been proven.

Rollback is a normal revert of the wrapper integration; the prior direct
Vitest command remains mechanically recoverable from this plan and its tests.

## Backlog coverage

- **Decision:** `atomic`
- **Receipt:** `cms9ukhpz0ft001luz49u8wkx`
- **Parent:** `BI-872CB1BF`
- **Deliverable:** `heavy-stage-diagnostics-and-recovery` → `BI-872CB1BF`
- **Rationale:** durable stage capture, exact identity, terminal classification,
  and bounded reuse form one safety contract; shipping any part alone either
  preserves opaque later-stage failures or permits an unauditable skip.
