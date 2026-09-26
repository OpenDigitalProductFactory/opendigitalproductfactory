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
- **C: wedge detection and containment.**
  - Detect processes in D-state in FUSE/9p waits past a threshold.
  - Raise one platform condition with evidence.
  - Detach platform-labelled helpers from Docker's view.
  - A VM restart is operator-approved through the portal only.
- **D: slot substrate.** Slot Postgres needs a restart policy and an
  ensure-start (BI-277ECBDB). After the 2026-09-25 WSL restart,
  `dpf-local-ci-postgres-0` stayed exited (255).

## Out of scope

Changing the 16 GiB hard ceiling, the 4 GiB floor, or host-stage calibration.
