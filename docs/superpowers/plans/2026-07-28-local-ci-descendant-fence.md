# Local-CI Descendant Fence Hardening

**Backlog item:** `BI-91036F21`
**Work capsule:** `WC-CA057502`
**Branch:** `fix/local-ci-descendant-fence`
**Date:** 2026-07-28

## Goal

Prevent local-CI from releasing the governed lease and local process fence while child, grandchild, or tool-spawned build/test processes from the gated command are still alive. A later branch must not be able to claim the shared `local-integration-ci` lane until the prior command tree is fully quiescent or has been terminated.

## Current Evidence

- Live process state on 2026-07-28 showed an active `feat/marketing-operating-snapshot` local-CI lease while older `fix/ux-artifact-terminal-producer-wait` `local-ci-runner.sh`, `local-integration-ci.mjs`, and `docker build --target build` processes were still running.
- The root `D:\DPF\.git\dpf-local-ci-owner.json` fence file was absent while those older descendants remained alive.
- Earlier action-envelope verification was intentionally stopped because evidence from a run started in that state would have been contaminated.
- Refined evidence on 2026-07-30 showed renderer lease `NPEL-326EC39C30` renewing normally until its host fence vanished. The next lease was admitted only after renderer released and acquired a new fence later, ruling out successor overwrite. The high-confidence cause is a surviving cleanup/descendant from the prior two-slot pilot deleting a later owner's fence (`cms78s2lk012501po8lxt2lod`).
- Current main has the lease/fence substrate from PR #3638 (`scripts/lib/local-sandbox-fence.mjs`, `scripts/lib/lease-supervisor.mjs`, `scripts/gate-worktree.mjs`, `scripts/gate-worktree.sh`), so this is a boundary-hardening fix, not new substrate.

## Scope

- Add regression tests for descendant process tracking and pregate's canonical Node routing contract.
- Extend the Node gate command wrapper so release is delayed until remembered child, grandchild, and tool-spawned descendants have exited or been terminated.
- Before launching the canonical shared-sandbox runner, refuse to proceed while a legacy runner, integration process, or orphan still referencing the `.local-ci-runner` workspace is alive, even when the predecessor's host fence is already absent.
- Make the POSIX compatibility entry point delegate to the Node gate by default so lease/fence safety does not drift between implementations.
- Keep the shell path as a compatibility adapter only; it immediately execs the Node gate.
- Update the local pre-PR gate documentation with the invariant.

Out of scope:

- Building a multi-slot sandbox pool (`BI-CCA0437C`).
- Replacing polling with durable FIFO admission (`BI-69728276`).
- Changing the nonproduction lease database schema.

## Implementation

- In the Node gate, sample the process table while the command is running, remember observed descendants, and perform a post-run quiescence/termination step before `release_nonprod_environment_lease` and `releaseLocalSandboxFence`.
- In `pregate.mjs`, route to `scripts/gate-worktree.mjs` by default; use the shell path only under explicit `DPF_PREGATE_FORCE_SH=1`.
- In the shell gate, delegate immediately to the Node gate, so POSIX and Windows hosts share one long-lived fence-owner process.
- Use a slower default process-table scan cadence on Windows because WMI/CIM snapshots are heavyweight host operations; keep explicit env overrides for focused debugging.
- Write `admitted` and `running` gate state before the expensive command starts, then let `pregate` recover that state if the child wrapper exits before terminal evidence is recorded.
- Preserve existing heartbeat behavior and lease-loss termination.
- Keep durable FIFO authority while waiting for legacy mutators to drain, but release a tentatively acquired host-fence token before retrying so a waiting owner never publishes a false process-ownership record.

## Verification

- Source-local regression test: `node --test scripts/gate-worktree-lease.test.mjs scripts/lib/local-sandbox-fence.test.mjs scripts/lib/lease-supervisor.test.mjs scripts/pregate.test.mjs scripts/lib/local-ci-gate-state.test.mjs`.
- Contract check for shell entry point text/behavior where practical from Node tests.
- No migration required.
- No UX verification required; this is CI/process infrastructure only.
- Full local-CI gate should be rerun after this fix is merged or available in the gated branch; current live local-CI evidence is intentionally not trusted while this defect is present.

## Risks And Rollback

- Risk: over-aggressive process cleanup could terminate a process outside the local-CI command tree. Mitigation: scope termination to the command PID/process group and record tests for late descendant mutation.
- Risk: Windows process re-parenting can hide grandchildren after the immediate child exits. Mitigation: the fix should wait/terminate before release while the supervisor still has a live root or explicit tracked child handle.
- Risk: globally treating every Docker process as local-CI would block unrelated work. Mitigation: admission matches canonical runner/integration commands or the slot workspace path, then includes only their descendants.
- Rollback: revert this branch; local-CI returns to current behavior, with `BI-91036F21` reopened as the active blocker.

## Backlog Coverage

- Decision: atomic
- Parent: `BI-91036F21`
- Receipt: `cms51i54604ix01mx0bkkt6oy`
- Dependencies: none
- Rationale: this is one process-boundary bug fix; the regression test, process supervisor change, shell/Node gate wiring, and documentation update are not independently useful if split because partial delivery would still allow contaminated local-CI evidence.

Deliverables:

- Canonical local-CI command descendants cannot outlive lease/fence release once the gate has observed them.
- A successor cannot launch into an already-mutating shared workspace merely because a mixed-version predecessor removed or lost its host fence.
- Pregate uses the Node-native gate by default so Node and POSIX behavior cannot silently diverge.
- Pregate recovers an interrupted `running` gate state by releasing the recorded lease and marking the gate failed.
- Regression coverage for process-tree descendant tracking, pregate routing, POSIX native fence-owner contract, crash recovery, and cleanup ordering.
- Pre-PR gate documentation names the invariant.
