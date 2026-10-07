---
status: active
backlog: BI-903FB5F9
epic: EP-LOCALCI-ADMITS
workroom: WC-0D5C770A
builds-on: BI-D3BF53A9 (#5708) and docs/superpowers/specs/2026-07-31-local-ci-control-plane-starvation-design.md
---

# Platform-owned local-CI memory: a self-updating builder reserve, and no hand-run host maintenance

## Founder directive

2026-09-25: "The management of these should be entirely encapsulated in how the
platform works, including dealing with problems when they occur like this." This
applies the commandment `platform-function-never-depends-on-a-client` to host
memory. No agent session, and no human re-measurement, may be what keeps
local-CI admitting work.

## Problem

### What sessions did, and why it was wrong

When the local-CI pool closed with `host-build-headroom-low`, agent sessions ran
`sync; echo 3 > /proc/sys/vm/drop_caches` in the Docker VM. The recipe lived only
in agent memory notes.

- **It could not help.** Admission reads the VM's MemAvailable, and the Windows
  probe adds the VM's reclaimable memory back (BI-E129F788). Both already count
  page cache as available. Measured 2026-09-25 18:10Z: cache 16 GB → 2 GB,
  MemAvailable unchanged, pool still closed.
- **It wedged the VM.** `sync(2)` flushes every superblock. A FUSE superblock
  (WSL's virtiofs device) stopped answering FUSE_SYNCFS, so every `sync` blocked
  forever in `fuse_sync_fs`. By 2026-09-25, 14 processes were stuck in
  uninterruptible sleep. `docker kill` could not stop them; only a WSL VM restart
  cleared them.

### What BI-D3BF53A9 fixed, and what it left

#5708 (merged 2026-09-25) did three things:

- It measured three bounded builds by hand: 13.64–13.86 GiB cgroup `memory.peak`.
- It checked in `builderPolicy.admissionCalibration`, highest peak (14,876,745,728)
  plus a 1 GiB margin, which gives a 14.86 GiB reserve instead of the 16 GiB
  ceiling.
- It made every bounded build record `controlPlane.builderMemory` and every
  headroom closure print its arithmetic.

It left two things:

1. **The reserve is a snapshot.** It is correct for the tree measured on
   2026-09-25. When the portal build grows, the reserve under-reserves until
   someone notices OOM kills. When the build shrinks, it over-reserves and the
   pool closes on memory the build no longer needs. Both repairs need a person to
   re-measure and edit JSON, the pattern the directive rules out. The per-gate
   measurement it added is recorded and then never read.
2. **Nothing stops the recipe coming back.** The pool-closed text now says not to
   drop caches, but nothing prevents a checked-in script, runbook or skill from
   carrying it again.

## Research & Benchmarking

| Source | What it does | DPF adopts / rejects |
| --- | --- | --- |
| Kubernetes resource management ([requests vs limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)) | The scheduler admits on the *request* (expected use). The *limit* is enforced only by OOM kill. | **Already adopted** by #5708: admit on a reserve, and keep 16 GiB as the cgroup limit. |
| Kubernetes Vertical Pod Autoscaler ([recommender flags](https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/docs/flags.md)) | Recommends continuously from a window of observed peaks (p90 of daily peaks, 15% margin), and raises the recommendation after an OOM. | **Adopt** the continuous window and the OOM response. **Reject** the percentile and 15% margin: the measured peak sits within about 2 GiB of the limit, so p90 × 1.15 would reserve the ceiling. The window's maximum plus the checked-in 1 GiB margin keeps #5708's formula. |
| kubelet node-pressure eviction ([docs](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)) | `memory.available` excludes reclaimable `inactive_file`. | **Already true.** Admission reads MemAvailable, so page cache needs no manual reclaim. |
| Linux `vm.drop_caches` ([sysctl docs](https://docs.kernel.org/admin-guide/sysctl/vm.html)) | "Use outside of a testing or debugging environment is not recommended." | **Reject** as an operating lever, and enforce that with a guard. |

The standard followed is a VPA-style continuous recommendation from a bounded
window of measured peaks. The formula deviates from VPA as stated above, because
the peak sits close to the limit.

## Scope manifest

**OBJ-1:** The builder admission reserve stays equal to the builder's measured need as the build changes, with no person re-measuring or editing the calibration.

**OBJ-2:** The measurement loop runs inside the platform on every leased gate run, and falls back to the checked-in calibration when evidence is thin and to the hard ceiling when a build in the window was OOM-killed.

**OBJ-3:** No checked-in script, runbook, skill or doc carries a recipe that drops the VM page cache by hand.

| AC | OBJ | Statement |
| --- | --- | --- |
| AC-2 | OBJ-2 | Recording a leased local-CI gate result folds that run's measured builder peak (`controlPlane.builderMemory`, status `measured`) into a 20-run window in the `local_ci.builder_memory_calibration` PlatformConfig row under optimistic concurrency; unmeasured or unleased runs are ignored, and a store failure never blocks the verdict. |
| AC-3 | OBJ-1 | With at least 5 measured peaks and no OOM kill in the window, the reserve is the window's highest peak plus the checked-in safety margin, capped at the hard ceiling; five peaks equal to #5708's measurements reproduce the checked-in reserve exactly. |
| AC-4 | OBJ-2 | With fewer than 5 peaks, no row, an invalid row, or peaks measured under a different ceiling, the reserve is the checked-in calibration; with any OOM kill in the window it is the hard ceiling. |
| AC-5 | OBJ-1 | The canonical pool resolver applies that reserve and reports it as `builderReserve { bytes, source: measured / checked-in / ceiling, reason, sampleCount }`. |
| AC-7 | OBJ-3 | `scripts/check-no-manual-vm-cache-drop.mjs`, run by the repo guard loop, fails on any tracked line that writes the drop-caches knob or pairs it with a `sync` command, and passes prose that names it. |

(AC-1 and AC-6 of the first draft, the measurement and the pool-closed text,
shipped in #5708 and are not repeated here.)

## Design

1. **Persist.** `recordLocalIntegrationResult` already runs the capacity circuit
   breaker. For leased gate runs it now also calls
   `recordLocalCiBuilderMemorySample`.
   - That folds `controlPlane.builderMemory.peakBytes` / `oomKills` /
     `memoryLimitBytes` into the row.
   - It uses the circuit breaker's `updatedAt` retry loop, and creates the row on
     the first run.
   - A change of `memoryLimitBytes` resets the window.
   - The outcome is recorded as `builderMemoryCalibration` on the evidence.
2. **Decide.** `measuredBuilderReserve` is a pure function, applied in this order:
   - Any OOM kill in the window: the hard ceiling.
   - Fewer than 5 peaks, no row, an invalid row, or a different ceiling: the
     checked-in `admissionReserveBytes`.
   - Otherwise: `min(ceiling, max(peaks) + admissionCalibration.safetyMarginBytes)`.

   `resolveNonprodPoolPolicy` loads the row next to the pool config and passes
   the result as `builderReserveBytes` to `resolveLocalCiPoolPolicy`. There,
   `localCiBuilderAdmissionReserveBytes` still caps it at the ceiling.
3. **Guard.** The new guard is auto-discovered by `scripts/check-guards.mjs`, and
   its self-test is inventoried in `scripts/lib/ci-policy-guards.mjs`. Design
   history under `docs/superpowers/specs/` is exempt.

A peak whose scope is `container-lifetime` (the builder was not cooled down) may
include an earlier build, so it can only overstate. It is kept: over-reserving
is the safe error.

## Later slices (separate PRs under BI-903FB5F9)

- **B: install budget.**
  - `config/install-resource-budgets.json` names the local-CI reserve.
  - `check-compose-resource-budgets.mjs` asserts that the WSL budget holds the
    always-on stack, the reserve and the floor.
  - The installer uses the platform default `autoMemoryReclaim` and reports when
    local-CI cannot run on a host.
  - The founder's position in BI-D3BF53A9 ("providing more memory … is
    fundamentally wrong") governs any VM-size change. The measured need decides,
    not a guess.
- **C: substrate reconciler (BI-4D08C53C, as built).** The Inngest cron
  `ops/substrate-reconciler` runs every 5 minutes at offset :04, is gated by
  quiescence, and appears in the scheduled-jobs catalog. The logic lives in
  `apps/web/lib/platform-runtime/substrate-reconciler.ts` with injected I/O.
  - **Restart.** It starts an exited compose-project container when both of
    these hold:
    - its service is required by the enabled runtime capabilities
      (`loadOperationalCapabilityState().serviceRequirements`);
    - its restart policy is `always` or `unless-stopped`.

    One-shot init containers, optional services and disabled services are never
    started. When the required set cannot be read, nothing is restarted. Each
    restart opens a warn MonitorIssue `substrate:service-restarted:<service>`,
    or an error if the start fails. The issue resolves once the container is
    running. A repeat means something keeps stopping the service; the caller
    is tracked on BI-547B788D.
  - **Wedge detection.** It reads every running container's processes through
    the Engine `top` endpoint, where ps runs inside the VM. Any process in
    D state for 10 minutes or more raises one error MonitorIssue,
    `substrate:docker-vm-wedged`. The issue names the processes and says that
    only a VM restart clears them, which also stops the portal, every
    container and running gates. It resolves when every `top` is readable and
    clean.
  - **Deferred, then delivered in E3.** Executing the VM restart needs a host
    executor, which the portal container does not have. WWMD DI-46E06C5441CF chose detect-and-report
    now and an operator-approved restart through a designed host executor later.
    Detaching helpers from Docker's view is dropped: the reconciler reports the
    wedge, and the cache-drop guard from slice A prevents the helpers.
- **D: slot substrate (BI-D2402DAB, child of BI-277ECBDB).** Slot Postgres is
  provisioned with `--restart unless-stopped`. On reuse, the runner applies
  `docker update --restart unless-stopped` before `docker start`, so existing
  containers converge on their next gate. The ensure-start (`docker start` and
  then `pg_isready`) already existed. After the 2026-09-25 WSL restart,
  `dpf-local-ci-postgres-0` stayed exited (255).
- **Installer reclaim key (BI-7371D444).** `install-dpf.ps1` writes
  `autoMemoryReclaim=gradual` under `[experimental]`, the only section where WSL
  reads it (WWMD DI-BC3B38A641C7).

- **E: the remaining substrate outcomes (one PR, 2026-10-07).**
  - **E1, local-CI substrate visibility (BI-277ECBDB parts A–C).**
    - *Precondition before claiming:* `scripts/lib/local-ci-slot-substrate.mjs`
      probes every slot's PostgreSQL container before the gate claims a lease,
      and starts a stopped one itself. It refuses to claim only when no slot's
      container can run, with gate status `blocked_slot_substrate_unavailable`
      and exit 9.
    - *Distinct states:* `pregate:status` reads `queued behind N other claims`
      for a queue, and `BLOCKED — slot substrate unavailable: <container> is
      <state>` for a dead substrate. The blocked state names Docker's refusal as
      the remedy instead of advising a re-run.
    - *Runner:* a slot database that never becomes ready now exits as
      infrastructure. Before, the run continued against a placeholder URL and
      could fail as if the diff were at fault.
    - *Pool liveness:* `apps/web/lib/nonprod/local-ci-pool-liveness.ts` counts
      leases admitted within 90 minutes that ended without a recorded result.
      The substrate reconciler raises `local-ci:pool-admissions-without-results`
      when at least three did and none completed, and resolves it on the next
      recorded result.
  - **E2, self-upgrade leaves the sandbox running (BI-547B788D AC-1, AC-3).**
    Step 7b of `scripts/promote.sh` reads the recreated sandbox back. It must
    be running on the image the service now resolves to. A failed or stale
    refresh adds `sandbox` to the durable service-reconcile outcome as degraded,
    instead of leaving only a stderr warning that dies with the promoter. The
    functional harness covers the failed-recreate, exited and stale-image
    branches. The reconciler's restart condition now records when the stopped
    container exited, and with what code, so the external stopper can be matched
    against host process audit. The repository holds no code that stops the
    main sandbox with a 3-second grace.
  - **E3, the operator-approved Docker VM restart (BI-F8F8C383; WWMD
    DI-46E06C5441CF, placement DI-877D45C6C0CC).**
    - *Executor:* the native Windows Edge agent is the only DPF process outside
      the VM. It already polls the signed, machine-bound remote-action channel,
      so the restart is a new privileged action type,
      `substrate.docker-vm.restart`, rather than new substrate.
    - *Gating:* the action needs high risk, machine binding, an approved
      ChangeRequest that is re-checked at claim, and a per-node allowlist entry.
      Its only parameter is the issue key it clears.
    - *Operator surface:* the portal Health tab shows a control only while
      `substrate:docker-vm-wedged` is open. The control asks for one danger-tone
      confirmation that states the impact, including running gates. The server
      action records the approved change, drains the platform through
      quiescence (trigger `docker-vm-restart`), and then queues the action.
      Nothing queues it automatically.
    - *Host procedure* (`internal/action/docker_vm_restart.go`):
      1. Stop Docker Desktop.
      2. Run `wsl.exe --shutdown`.
      3. Move the orphaned IPC socket directories aside (BI-DDA569D9).
      4. Start Docker Desktop and wait for the engine.
      5. Run the DPF autostart task.

      Its commands go through an allowlist of `taskkill`, `wsl.exe`, `docker`
      and `schtasks`, so a host reboot cannot be issued.
    - *Reporting back:* the runner keeps a terminal report the portal could not
      take and delivers it before the next claim. The VM restart has a 30-minute
      claim timeout.
    - *Availability:* the channel stays off unless the install enables remote
      action dispatch and the node allowlists the type. Without a native agent,
      the control says so instead of offering a shell.

## Out of scope

Changing the 16 GiB hard ceiling, the 4 GiB floor, or host-stage calibration.
