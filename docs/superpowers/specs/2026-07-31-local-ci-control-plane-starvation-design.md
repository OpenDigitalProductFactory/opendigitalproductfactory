---
status: active
---

# Local-CI Control-Plane Starvation Prevention

## Owned-job observation diagnostics: BI-1A4CC847 (2026-10-30)

This Medium/low successor extends the existing Windows cancellation fixture;
`BI-BFDB98B6` remains delivered. Workroom `WC-5E3531E3` owns this scope.
The item-body outcome is: Windows cancellation verification either observes
natural closure of its owned job or reports the precise failing observation
without losing cleanup provenance or fabricating a pass.

On source `68d68ef805317a0e53da01ae842a294a901b27b2`, the existing
`query-failure` and `identity-failure` probes both report only "The handle is
invalid". Their source-local assertions pass because they require a failure,
not its provenance. An additional assertion requiring the membership query's
operation fails with `undefined`; no operation or native code is persisted.
Retained fixtures are `dpf-job-drain-uJKF8g` and `dpf-job-drain-Mjntl7` in the
host temporary directory. Both complete their owned cleanup. These observations
prove lost diagnostics, not the cause of the historical g0XmMA cancellation
failure ("The parameter is incorrect" after three member identities).

### Ordered repair and acceptance

1. Extend the existing query/identity failure probes to require the exact API,
   native error and available member PID/creation identity in persisted snapshots.
   Preserve the human-readable failure and distinguish a native API failure from
   a fixture invariant. The new assertions must fail on the named baseline.
2. Refactor only the existing observation boundary to capture native errors
   immediately after the failing call. Preserve a primary observation failure
   if handle cleanup also fails; retain cleanup failure separately. Allocate
   approximately 20% of this repair to the shared diagnostic representation and
   its propagation through the existing snapshot writer. No new runner or table.
3. Exercise an owned member exiting between enumeration and identity acquisition
   using the existing bounded probe. Record the actual operation and code. Do
   not interpret a missing PID as natural job closure or change cleanup policy
   without evidence. Genuine unreadable membership/identity remains inconclusive.
4. Re-run the existing empty, short-lived, persistent, query-failure,
   identity-failure, missing-job and driver-failure cases, plus the actual Windows
   cancellation cases. Preserve the ten-second observation budget, owned Job
   containment, unrelated sentinel and original failure outcomes. Complete
   applicable protected verification and independent assessment before publication.

Acceptance: exact diagnostic provenance is persisted, genuine observation
failures never become a pass, natural closure still requires zero job accounting
and members, and cleanup cannot replace an earlier observation error. Source
fixture verification is distinct from a canonical gate or deployed verification.
The original historical cause remains unknown unless a matching reproduction
establishes it. A revert retains fail-closed observation and containment.

This is one atomic diagnostic repair: tests, native capture and persisted fields
must ship together. Plan coverage belongs to `BI-1A4CC847`; documentation does
not deliver a separate implementation item. Hydration `BI-E96C5778`, identity
`BI-CAP-437F7745` and role/room `BI-56E9CEC2` keep their existing ownership.

Microsoft's [process handle contract](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers)
distinguishes PID lifetime from retained-handle lifetime. The
[job process list](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list)
is a membership snapshot with explicit returned-count bounds. These justify a
controlled disappearing-member probe, not a conclusion about the old failure.
## Supervisor-loss repair: BI-BFDB98B6 (2026-09-13)

Implementation owner: `BI-BFDB98B6`, Workroom `WC-B78D15F5`, branch
`fix/gate-supervisor-recovery`. This extends the existing process supervision,
queue-observer identity and pending-evidence contracts. Implementation admitted
2026-09-27 after the normal research receipt and operator executor approval.
Independent verification and operational qualification remain outstanding.

### Reproduction and boundaries

On source `c40d1df994c` the injected `createProcessTreeTracker` reproduction
remembers child PID 200 beneath root 100, then sees unrelated PID 200 beneath
parent 999 with a later creation time. The assertion that no unrelated process
is targeted fails: the injected termination function receives 200. No real
process is terminated by this reproduction. Earlier evidence
`cmtywa6kv0idc01tako7vuo6w` records the same defect and an ancestor-cycle case.

This proves a cleanup defect, not the historical cause of either lost executor.
The preserved profile run completed all twelve commands but lacks the canonical
receipt; an expired lease alone does not establish authority to publish a pass.
Existing `local-queue-observer.mjs` already reads process creation times, but its
cached snapshot and ten-second liveness tolerance are unsuitable for destructive
cleanup. Reuse the platform parsing boundary while requiring fresh exact identity
for termination. No new table, scheduler, runtime, grant or lease status is needed.

### Ordered implementation and acceptance

1. Add failing tests for PID reuse, stale parentage, ancestor cycles, missing
   creation identity, unreadable process inventory and a genuine owned descendant.
   Capture the root identity and controller ancestry before execution. Track each
   descendant as PID plus creation identity; accept a parent relationship only
   when its creation ordering is possible. Unknown ownership forbids termination.
2. Refactor process inspection and identity comparison into the existing shared
   process boundary. Allocate at least 20% of implementation effort to that shared
   refactoring. Do not reuse the observer's permissive liveness tolerance for kill
   authority. Revalidate immediately before terminating each process; avoid an
   unchecked recursive taskkill that can expand beyond validated identities.
   Document residual platform race limits rather than claiming atomicity from two
   separate process-table reads. Journal intent before invoking termination.
3. Persist an execution-completed checkpoint before descendant cleanup and lease
   release. Bind it to the original gate key, owner, lease, candidate, integration
   tree, evidence-plan and toolchain digests, command outcomes, artifact and
   completion time. Write atomically and retain failures as failures. A local
   checkpoint is recovery material, not a canonical pass receipt. Product pass/failure
   outcomes require the validated packet; typed infrastructure exits retain their
   shared classification without claiming a completed product execution. Cleanup
   uncertainty still fences either path. Contract success fixtures must supply
   complete synthetic provenance and exercise real supervision, not bare exit zero.
4. Extend the existing finalizer with explicit recovery validation. Authenticate
   the caller and original ownership; require complete immutable evidence and
   valid freshness, reject conflicting prior receipts and incomplete or mismatched
   packets, and make replay idempotent. Retain the original execution history.
   Do not simply change the recorder to accept every expired lease. If old material
   cannot satisfy these checks, return an explicit inconclusive outcome and permit
   one governed rerun with the repaired supervisor instead of fabricating approval.
5. Exercise supervisor loss before completion, after checkpoint, during cleanup,
   and after server publication but before local acknowledgement. Prove both normal
   completion and recovery, wrong-owner rejection, changed-tree rejection and
   duplicate suppression. Run affected source tests and required publication gates.
6. Recover the preserved profile result only if it qualifies under the verified
   contract; otherwise run its gate once with the repaired controller. Then obtain
   its independent review and publish the profile PR under ordinary protections.

No schema migration or product UI is proposed. Existing gate status and recovery
output must distinguish completed execution, cleanup uncertainty, pending evidence
and canonical receipt. Update the build-gate runbook and platform support watchlist
with the verified recovery procedure in the implementation change. Protected PR
checks, DCO, token grants and canonical runtime release remain mandatory. A revert
must leave unsafe cleanup disabled or gates explicitly blocked, never restore an
operational instruction to kill unchecked PIDs.

- **Status:** accepted for implementation
- **Date:** 2026-07-31
- **Backlog item:** `BI-CE6E2882`
- **Epic:** `EP-0DFF753B`
- **Work Capsule:** `WC-BD87F076`
- **WWMD decision:** `DI-EBA2C9239C5C`

## Decision

Keep the canonical Docker production artifact, but run its build in a slot-scoped
`docker-container` BuildKit builder with explicit CPU, memory, and BuildKit
parallelism ceilings. While the build runs, independently probe the installed
portal, MCP endpoint, Docker Engine, and PostgreSQL over its host port. A sustained
control-plane breach terminates the build, records a distinct
`blocked_control_plane_starvation` infrastructure outcome tied to branch, SHA, and
slot, and prevents capacity expansion.

The gate does not restart Docker Desktop, the portal, or PostgreSQL. A shared-service
restart remains an intentional governed recovery action. A TCP listener without a
valid application response is unhealthy.

## Incident boundary

The evidence establishes two separate events:

1. Lease `NPEL-E5F0F81B36` ran an unconstrained daemon-side `docker build`. The
   production build compiled, reached TypeScript, then stopped progressing while
   portal HTTP/MCP, Docker Engine API, and independent PostgreSQL access became
   unavailable.
2. Later, a separate process explicitly called Docker Desktop `/app/quit`. That was
   not the initiating build pressure and must not be represented as natural or
   automatic recovery; the restart extended the outage while the engine bridge
   failed to return.

Prevention and evidence address the first event. Governed recovery semantics address
the second. The implementation must not conflate them.

## Existing substrate to extend

| Concern | Source of truth | Extension |
| --- | --- | --- |
| Slot identity | `local-ci-slot-resources.json`, `local-ci-slot-manifest.mjs` | Add deterministic builder identity and resource policy |
| Build orchestration | `local-integration-ci.mjs` | Replace plain Windows `docker build` with the bounded wrapper |
| Gate evidence | `gate-worktree.mjs`, `local-integration.ts` | Add control-plane samples and reserved status |
| Infrastructure classification | `sandbox-freshness.mjs`, MCP evidence pack | Map a reserved exit code without charging product failure |
| Capacity rollback | `local-ci-pool-circuit-breaker.ts`, pilot report | Treat any starvation signal as binding rollback evidence |

No new table, scheduler, lease type, or runtime is justified.

## Resource boundary

Each slot owns one named Buildx builder. The builder uses Docker's
`docker-container` driver so its BuildKit daemon has enforceable container resource
limits. The checked-in slot policy supplies:

- a 16 GiB memory ceiling, empirically raised from 12 GiB after the bounded
  representative build reached page-data collection but BuildKit correctly
  terminated it with `ResourceExhausted`; this leaves substantial host headroom
  while accommodating the proven 8 GiB Node heap plus Next worker memory;
- an eight-CPU quota with a 100 ms period;
- BuildKit `max-parallelism = 4`;
- `default-load=true`, preserving the image-inspection and artifact identity path.

Provisioning is idempotent and fail closed. An absent builder may be created. An
existing builder whose driver or effective HostConfig does not match the declared
policy is drift, not permission to run unbounded. The gate reports the mismatch and
stops; it does not silently recreate or resize shared infrastructure.

## Control-plane watchdog

The bounded build wrapper starts the Buildx build and samples every five seconds:

- `GET http://127.0.0.1:3000/api/health`, requiring HTTP 200 and an identifiable
  healthy payload;
- a read-only MCP request, requiring a valid protocol response;
- `docker info`, with a short process timeout;
- `SELECT 1` over `127.0.0.1:5432`, independently of `docker exec`.

The wrapper resolves the installed PostgreSQL container's live credentials once
before the build, retains the connection URL only in process memory, and never
serializes it. Subsequent database samples use the host port directly, so they
remain independent if Docker Engine becomes unresponsive.

Every probe has an individual timeout. Two consecutive unhealthy sample rounds form
a sustained breach. This avoids one transient packet becoming a false rollback while
bounding detection to approximately ten seconds. The wrapper then terminates the
complete build client process tree, emits a versioned JSON evidence record, and exits
with reserved code 5.

The record contains branch, candidate SHA, integration tree SHA when available, slot,
builder policy, timestamps, every probe result, breach reason, and termination result.
Secrets and connection strings are never serialized.

## Outcome semantics

Exit code 5 maps to `blocked_control_plane_starvation`. It is:

- an infrastructure/control-plane failure, not a product build failure;
- a binding circuit-breaker input for any slot and especially slot 1;
- a binding rollback blocker in the capacity pilot report;
- never convertible to `failed` merely because an older portal does not yet know the
  enum—the pending evidence remains explicit and is finalized after deployment.

Normal Docker build errors remain `failed`. Dependency drift remains
`blocked_sandbox_drift`. The statuses are intentionally disjoint.

## Queue observer records must be self-healing (BI-2C7F51BA)

The admission queue is shared by every concurrent session on the host, so a leaked
liveness record throttles the whole fleet, not just the session that leaked it.
`.git/dpf-local-ci-queue-observers` was observed holding 192 records, 185 with dead
pids and the oldest six days old; a pregate sat at "queued at position 3" for ~30
minutes and reported position 1 the moment they were swept by hand.

Three properties are binding:

1. **Sweep on every gate startup.** The reaper was previously wired only into
   pregate's interrupted/revival recovery paths, which are themselves skipped when
   the worktree path cannot be resolved — i.e. on exactly the failure the cleanup
   exists for. `gate-worktree.mjs` now sweeps before its first claim, so one crashed
   run is reclaimed by the next launch rather than leaking permanently.
2. **The sweep is cross-session by design.** Its branch/sha/session filters stay
   EMPTY: the session that leaked a record is by definition no longer around to clean
   it up. Records still backing a lease the queue knows about are retained, because a
   record is the liveness PROOF that lets a dead waiter's lease be cancelled —
   sweeping it first would trade a leaked file for a leaked slot.
3. **Liveness may not rest on `process.kill(pid, 0)` alone.** Windows recycles pids,
   so a reassigned pid reads as alive forever. Records carry the observer process's
   start time — `(pid, start time)` is unique, so reuse is provable — and a 12h TTL
   bounds any record whose start time cannot be established (older records, or a host
   that will not answer the process-table query). Every "dead" verdict must be
   proven; an unreadable process table yields "unknown", never "dead".

## Recovery and rollout

The watchdog may stop only its admitted build process tree. It may not restart or
stop shared DPF services. If the control plane remains unavailable after termination,
the gate records `recovery_required` with the failed probes and the operator-visible
next action. A Docker Desktop or shared-service restart requires explicit authority
and must be auditable.

Requested capacity remains one. A future pilot can request two only after repeated
bounded-build evidence proves the control plane healthy throughout representative
builds. The prior rollback remains binding until that new evidence exists.

## Verification contract

- unit tests prove builder command/limit validation, timeout handling, sustained
  breach classification, process-tree termination, status mapping, and pilot rollback;
- a representative harness runs a controlled long build with all four probes healthy;
- a fault-injection harness makes each probe fail and proves exit 5 plus evidence;
- the exact local-CI pregate proves the Docker artifact still builds and records the
  bounded policy;
- portal/MCP/PostgreSQL/Docker health is sampled before, during, and after the gate.

## 2026-09-12 amendment: page-worker and admission memory budgets

BI-06AE6833 / WC-3064DEE4 extends this design to repair the infrastructure failure
preventing reviewer-recovery visibility verification. The visibility candidate
at `0ac23a372279bb4a5062025e36b0eef3bcb92a51` compiled with Next 16.3.3, then ran
11 page-data/static-generation workers. After 75 of 151 pages, the log recorded
SIGKILL and BuildKit ResourceExhausted (`cannot allocate memory`). The builder
ceiling was 16 GiB; Docker reported 23.47 GiB total. The child-process peak and
whether the exhausted boundary was the container or VM remain unmeasured.

Withdraw the earlier 8 GiB high-water plus 2 GiB margin admission calibration.
Reserve the full existing 16 GiB builder ceiling pending representative new
measurements. Apply the configured safety floor to Docker available memory as
well as host memory through the existing pool policy. Existing builder usage is
deducted from each remaining reservation; running jobs do not reserve their
memory a second time. No new scheduler or resource registry is introduced.

The canonical Next config uses one shared page-build budget: at most two workers,
one concurrent page per worker, and one worker when memory or CPU evidence is
missing or insufficient. Available and constrained process memory bound the host
memory input. The 8 GiB allowance per worker is a conservative planning budget,
not a measured peak or hard heap limit. This may lengthen page generation; it does
not establish that an upstream memory-retention defect is fixed. The existing
16 GiB boundary and watchdog remain authoritative.

Next documents [static-generation concurrency controls](https://nextjs.org/docs/app/api-reference/config/next-config-js/staticGeneration)
and [build memory investigation](https://nextjs.org/docs/app/guides/memory-usage).
The installed worker selector consumes `experimental.cpus`; its alternative
memory-based selector has a minimum of four workers and cannot meet this budget.

Acceptance requires source tests for unknown/small/large memory, safety-floor
boundaries and slot isolation, followed by a canonical build recording worker
count, peak memory and control-plane health. Unit tests alone do not establish
runtime recovery or completion of BI-06AE6833.

## 2026-09-25 amendment: the builder reserve comes from a measured peak (BI-D3BF53A9)

The 2026-09-12 amendment reserved the whole 16 GiB builder ceiling "pending
representative new measurements". Nobody took them. Every gate record's
`builderMemoryUsageBytes` was `[0, 0]` because it is sampled at admission,
before the build runs. With the 4 GiB safety floor, a gate therefore needed
20 GiB free in the Docker VM before it could start. The DEV host's VM (24.6 GB,
about 4.4 GB used by the always-on stack) had 19.0 to 19.3 GiB, so the pool sat
closed while gates from three sessions queued.

**Measurement.** On 2026-09-25 the gate's production build (`buildx build
--target build`, tree 987adaa1fc2) ran three times on a dedicated builder with
the gate's exact limits (16 GiB, 8 CPUs, `local-ci-buildkitd.toml`). Each run
started from a freshly started builder, so each cgroup `memory.peak` belongs to
that build alone. No gate was active, and no cache drop or `sync` was run.

| run | cgroup `memory.peak` | sampled max anon | sampled max file | `next-build` RSS | workers | OOM kills |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 14,853,529,600 (13.83 GiB) | 11.72 GiB | 2.19 GiB | ≈11 GiB | 2 | 0 |
| 2 | 14,644,989,952 (13.64 GiB) | 12.03 GiB | 2.00 GiB | 11.0 GiB | 2 | 0 |
| 3 | 14,876,745,728 (13.86 GiB) | 11.91 GiB | 2.04 GiB | 11.0 GiB | 2 | 0 |

The peak comes from the Turbopack compile. The `next-build` process alone
reaches about 11 GiB RSS, which is more than its 8 GiB V8 heap, so most of the
excess is native compiler memory. The two page-data workers come after the
compile peak and add little. The 2026-09-12 worker bound is doing its job. What
drives memory now is the compile of the whole portal, not page generation.

**Calibration.** `builderPolicy.admissionCalibration` records
`observedHighWaterBytes` = 14,876,745,728 (the highest of the three) plus
`safetyMarginBytes` = 1 GiB, so `admissionReserveBytes` = 15,950,487,552
(14.86 GiB). The margin is more than four times the spread between runs
(0.22 GiB). The high-water already includes about 2 GiB of page cache charged
to the builder, which the kernel reclaims inside the cgroup before it
OOM-kills, so non-reclaimable demand sits about 3 GiB under the reserve. The
16 GiB `memoryBytes` stays the hard cgroup limit. If a build exceeds the reserve,
it is bounded by its own cgroup and reported as `builder:resource-exhausted`
infrastructure. It cannot eat the VM's floor. Admission now needs 18.86 GiB
available, not 20, and the DEV host admits one gate. Two slots need 33.7 GiB and
stay out of reach on a 24 GB VM. That is correct.

**Instrumentation.** `scripts/local-ci-bounded-build.mjs` samples the
builder's cgroup every 5 s while it builds (`memory.current`, `memory.stat`
anon/file, `memory.events` oom_kill, and the RSS of `node`/`next-*`
processes). After the build it reads `memory.peak` once more, before cool-down
stops the builder and discards its cgroup
(`scripts/lib/local-ci-builder-memory.mjs`). Every gate record then carries
`evidence.builderMemory`: `peakBytes`, `peakScope` (`this-build`, or
`container-lifetime` when the builder was already running before the build),
the sampled maxima and the worker count. A gate that ran no build records
`status: unmeasured` with a reason, never a zero. To recalibrate, read
`builderMemory.peakBytes` across recent gate records whose `peakScope` is
`this-build`, and move `observedHighWaterBytes` in this file's record and the
JSON together. The guard in `scripts/local-ci-pool-policy.test.mjs` requires
reserve = high-water + margin ≤ ceiling.

**Message.** A headroom closure now carries its arithmetic
(`poolPolicy.headroom`: which machine was measured, available memory, floor,
reserve and shortfall). The waiting line names the shortfall and says that no
session action changes it: page cache already counts as available, so dropping
caches cannot help, and `sync` wedges the VM (BI-903FB5F9).

**Decided 2026-09-26: the merge queue owns the production build
(BI-3A14308C).** The reserve protects only the Docker build stage, which the
local gate reached only after several minutes of typecheck and vitest while the
reserve sat idle. Four options went through `principle_decide` (WWMD,
DI-ED547297DC9F):
- cloud owns the heavy build: 11.72;
- keep the measured reserve and recalibrate: 9.21;
- reuse the build when untouched: 8.85;
- late builder reservation: 8.64.

The verdict was proceed, confidence high, margin 2.5, which applies AGENTS.md
§4: "the heavy build runs once, in the cloud". The merge queue's required
`pnpm --filter web build` job (`.github/workflows/ci.yml`, `merge_group`) is
already the binding production-build evidence.

- The local plan's default build strategy is `merge-queue`
  (`scripts/lib/local-integration-ci.mjs`), so it ends at vitest and builds no
  image. `DPF_LOCAL_CI_BUILD_STRATEGY=local` (or `docker-build` / `host-next`)
  opts one run back into a local build, for example to measure the builder or
  to reproduce a Dockerfile-only failure.
- The strategy is part of the toolchain fingerprint, so a delegated run never
  reuses a verdict from a run that built, or the reverse.
- The claim declares `productionBuild: "delegated"`. The pool then waives only
  the builder reserve (`reserveBuilderHeadroom: false`) and still applies the
  host-stage reserve and every other rollback. An older portal ignores the
  field and keeps reserving, so the client can ship first.
- The gate record says `evidence.productionBuild: { owner: "merge-queue",
  status: "delegated" }`, and `builderMemory` reads `unmeasured` /
  `production-build-delegated-to-merge-queue`. A build that did not run is
  never reported as passed.
- What a delegated gate no longer catches locally: a failure that only the
  Docker image build shows. The Dockerfile build-context guard
  (`dockerfile-build-context.guard.test.ts`) still runs, and the merge queue
  and the post-merge image publish still build the image.
- Builder calibration (BI-903FB5F9, #5755) keeps learning from the runs that
  still build locally.

## Dependency readiness for the bounded build


Explicitly deny the existing `@parcel/watcher` install hook in `allowBuilds`.
Version 2.6.0 loads a platform-specific optional prebuilt binary before trying
a local build. Its [install hook](https://github.com/parcel-bundler/watcher/blob/v2.6.0/scripts/build-from-source.js)
only invokes node-gyp when `npm_config_build_from_source=true`. Locked prebuilds
cover DPF's Windows x64 host, macOS arm64 host, and Linux x64/arm64 glibc/musl
build targets. Keep optional dependencies enabled; do not silently fall back to
source compilation on a target without a prebuild. Such a target needs a separate
compatibility decision. No dependency version or integrity pin changes.

This classifies an already-denied script, rather than authorizing additional
install execution. A fresh managed install recorded the hook as unclassified,
while an older sibling install had no watcher entry at all. The recorded policy
makes readiness independent of that installation history. Verify managed
readiness and exercise the Windows prebuilt watcher's snapshot operation;
Linux loading and the production build remain canonical-build checks.
