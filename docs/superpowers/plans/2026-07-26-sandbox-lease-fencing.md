# Sandbox lease heartbeat and fencing implementation plan

**Backlog item:** BI-52500C0D
**Branch:** `fix/sandbox-lease-fencing`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Make the existing singleton `local-integration-ci` sandbox fail closed: a healthy
gate retains ownership with heartbeats, a gate that loses ownership stops its
entire child process tree before any later mutation, and every normal or signal
exit attempts an audited lease release. This PR does not increase sandbox
capacity; BI-CCA0437C remains blocked until this contract is proven.

## Existing substrate

- `scripts/gate-worktree.mjs` owns the Node-native claim/run/evidence/release flow.
- `scripts/gate-worktree.sh` is the POSIX peer selected when a native shell is
  available.
- `renew_nonprod_environment_lease` already enforces owner identity and rejects
  expired, released, or stolen leases.
- `NonProductionEnvironmentLease.activeKey` remains the database exclusivity
  constraint. No schema migration or parallel lease model is needed.
- A Git-common-dir owner fence supplies host PID liveness that PostgreSQL
  cannot observe; its token prevents a stale or competing process from
  heartbeating or releasing another owner's fence.

## Phases

### 1. Test the lease supervisor contract

Add a source-local, dependency-free supervisor module and Node tests that prove:

- heartbeat cadence never exceeds one third of the configured lease TTL;
- renewal loss aborts the active child and returns a fenced outcome;
- normal completion stops heartbeats and releases exactly once;
- thrown commands and termination signals still enter cleanup;
- phase and heartbeat timestamps are available for evidence.

These tests must fail against the initial implementation before production code
is added.

### 2. Integrate the Node-native gate

Replace blocking `spawnSync` execution with an async child process supervised by
the tested heartbeat/fencing contract. Pass the lease identity into the child
environment, renew while all phases run, terminate the Windows/POSIX process
tree on renewal loss or deadline, and release from `finally`.

### 3. Preserve the POSIX gate contract

Update `scripts/gate-worktree.sh` to run its child asynchronously, heartbeat
through the same MCP renewal tool, fail closed on renewal loss, trap exit and
signals, and kill the owned process group. Add structural contract assertions
alongside the functional Node tests.

### 4. Evidence and operational documentation

Record claim, phase, heartbeat, fence-loss, and release timestamps in the local
gate state/evidence. Update the contributor/testing documentation with the
fail-closed behavior and explain that TTL expiry is never permission for a
second process to keep mutating.

### 5. Completion gate

Run targeted supervisor and gate contract tests, the affected script guard
suite, `git diff --check`, and the mandatory shared local-CI gate. Push the
signed commit, open a ready PR only after green evidence, run `pnpm pr:health`,
and use the merge queue.

## Risks and rollback

- **Risk:** killing only the direct child leaves Docker, Bash, pnpm, or Vitest
  descendants alive. **Mitigation:** process-tree termination is part of the
  functional contract and is exercised on Windows and POSIX-compatible paths.
- **Risk:** transient MCP latency falsely fences a healthy run. **Mitigation:**
  renew well before expiry, bound individual renewal calls, and require actual
  owner-loss/expiry evidence before fencing; transport uncertainty stops before
  further mutation rather than permitting overlap.
- **Risk:** signal cleanup races evidence recording. **Mitigation:** cleanup is
  idempotent and lease release is best-effort in one `finally` owner.
- **Rollback:** revert this PR to restore the prior singleton runner. No schema
  or live-data rollback is required.

## Backlog coverage

**Decision:** atomic
**Receipt:** `cms2ag3v501bq01odtq7x2dd8`
**Parent BI:** `BI-52500C0D`

| Deliverable | Backlog item | Depends on |
| --- | --- | --- |
| Fail-closed singleton sandbox lease supervision across Node and POSIX gate surfaces | BI-52500C0D | None |

The phases above are one atomic safety contract: shipping heartbeat without
child fencing, cleanup, and evidence would create false confidence and leave
the observed overlap defect open.
