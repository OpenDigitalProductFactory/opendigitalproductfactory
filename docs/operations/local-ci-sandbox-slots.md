# Local-CI sandbox slots

The contributor pregate uses durable `local-integration-ci` lease admission and
a versioned slot manifest. The lease decides who may run; the manifest decides
which physical resources that admitted owner may mutate. These are separate
safety layers.

## Host-wide heavyweight resource admission

The local-CI slots are not the only processes capable of exhausting a
developer host. Canonical TypeScript, Vitest, Next build, Docker build,
preview, inference, and semantic-review entry points declare a resource class
through `scripts/host-resource-runner.mjs`. The runner requests the durable
`host-heavy-resource` lease before starting its child, supervises that child
and its descendants, renews while it runs, and releases only after the owned
process group exits.

The versioned profile is
`apps/web/lib/nonprod/host-resource-profiles.json`. On a host with at most 64
GiB of memory, inference residency contracts non-inference heavyweight
capacity to one even when a second command would appear to fit. Admission also
preserves the host reserve and an inference-growth reserve. Cheap Node guards
such as documentation, policy, and change-impact checks do not enter this lane
and remain concurrent.

A full lane produces a typed `host_resource_queued` response and exits without
leaving a waiting Node process. Stray matching processes are included as
`evidence-only` diagnostics; the broker never kills a process merely because
its command line resembles a heavy workload. Only the admitted runner's own
descendant group may be terminated when lease authority is lost.

## Current operating mode

Capacity is governed by the versioned
`PlatformConfig["local_ci.sandbox_pool"]` policy. An absent or malformed policy
preserves the rolling-upgrade compatibility capacity of **one**. Once a valid
policy is configured, stale, unmeasurable, or unsafe host evidence resolves to
**zero**: queued intent remains FIFO, but no new stage host is admitted.
`slot-1` is never permission to bypass durable FIFO admission or run two gates
manually.

The effective capacity used by admission and shared-lease WIP reporting is:

`min(requested capacity, manifest slots, host-safe capacity)`

The only supported pilot capacities are one and two. A capacity-two request is
admitted only when both the requesting host client and the canonical portal
broker provide recent observations proving the configured memory, CPU, and
disk headroom; Docker health; dependency-convergence quiescence; valid slot
fences; and evidence isolation. The broker pessimistically merges those
observations: minimum free resources, maximum load, and any unhealthy signal
win. Client evidence can therefore contract capacity but can never grant
`slot-1` by itself. The runner continues sampling while work is active. Memory,
disk, Docker, slot-fence, or evidence-integrity loss is a hard active execution
fence: the wrapper stops its stage child and releases authority. High CPU
remains an admission throttle because stopping an already-running stage would
usually worsen contention; dependency convergence keeps its separate
quiescence fence. Release and expiry never promote a local-CI waiter from old
pressure evidence; the FIFO head's next claim poll must supply a fresh
observation before admission.

### Peer-slot host fencing

The host process scan remains a rolling-upgrade drain for legacy, unscoped
local-CI mutators. A mutator owned by a different current slot is not a
conflict when that slot has a live version-one fence and its command is inside
the peer manifest's exact scratch workspace. The gate excludes only that
proved peer owner, its descendants, and detached commands scoped to that
workspace. A peer fence is trusted only while its heartbeat is fresh and the
PID's observed process-start identity still matches the identity captured at
acquisition, preventing PID reuse from turning a stale fence into an
exemption. A missing, invalid, stale, identity-mismatched, dead, or unscoped
fence remains fail-closed.

## Design grounding

- Existing specs/plans reviewed:
  `docs/superpowers/plans/2026-07-28-local-ci-sandbox-pool-pilot.md`.
- Current code substrate reviewed: durable lease admission, slot manifests,
  host process discovery, and local sandbox fences.
- Source of truth: the versioned slot manifest owns peer workspace identity;
  the live local fence owns peer process identity.
- Decision: preserve the legacy-mutator drain while exempting only a
  mechanically proved peer slot, so capacity two changes execution capacity
  without weakening mixed-version safety.

Slot 0 preserves the established external endpoints:

- portal: `http://localhost:3010`
- PostgreSQL host port: `15432`
- scratch checkout: `<root-parent>/<root-name>-worktrees/.local-ci-runner`;
  for example `D:/DPF-worktrees/.local-ci-runner` for a conventional
  `D:/DPF` clone, or
  `D:/DPF-worktrees/.opendigitalproductfactory.git-worktrees/.local-ci-runner`
  when the Git common directory is the central bare
  `D:/DPF-worktrees/.opendigitalproductfactory.git`

The versioned public slot resources (slot keys, ordinals, portal ports, and
PostgreSQL ports) live once in
`apps/web/lib/nonprod/local-ci-slot-resources.json`. Host ports there **must
stay below 49152**: the `49152–65535` ephemeral range is where Windows
Hyper-V/WinNAT dynamically reserves 100-port blocks on every boot, so a host
port in that range binds fine one boot and fails the next with
`bind: An attempt was made to access a socket in a way forbidden by its access
permissions` (WSAEACCES). The earlier `54329`/`54330` pair lived in that range
and broke after a reboot; `15432`/`15433` are permanently out of WinNAT's reach.
This is enforced fleet-wide by the Host Port Range Guard
(`scripts/check-host-port-range.test.mjs`), which fails the gate if any Compose
or slot host port is declared in `49152–65535`. Both the server-side lease
binding and `scripts/lib/local-ci-slot-manifest.mjs` consume that contract.
The manifest derives every remaining mutable identity—including the process
fence, Compose project, PostgreSQL container/database/volume, integration
branch namespace, dependency convergence lock/store, logs, and evidence. Do
not reconstruct these names in a runbook or a second script. Before host
mutation, the server rejects any binding whose version, assigned slot, URL,
ports, or cleanup command differs from this contract.

## Policy and rollback

The policy value has this closed version-one shape:

```json
{
  "version": 1,
  "requestedCapacity": 2,
  "ceilings": {
    "minAvailableMemoryBytes": 8589934592,
    "maxSustainedCpuPercent": 75,
    "minDiskFreeBytes": 107374182400
  },
  "rollback": {
    "maxServiceDurationRegressionPercent": 15,
    "maxInfrastructureFailureRatePercent": 5,
    "evidenceMismatchTolerance": 0
  }
}
```

The numeric pressure ceilings are install-specific pilot inputs, not fleet
defaults. Record the measured capacity-one baseline and the selected ceilings
in the governed pilot evidence before requesting capacity two.

Rollback changes only `requestedCapacity` to `1` in the same validated
PlatformConfig value. No migration, branch movement, worktree cleanup, or
manual lease deletion is part of rollback. Existing valid owners finish under
their admitted slot identity; subsequent reconciliation admits only `slot-0`.
Recording any `failed`, `conflict`, or `blocked_sandbox_drift` result attributed
to `slot-1` invokes a server-side circuit breaker before the evidence is
accepted. It contracts the latest valid policy to one using optimistic
concurrency; if safe contraction repeatedly loses a concurrent update race,
evidence ingestion fails closed instead of implying that rollback succeeded.
An absent or invalid policy is already singleton and is never overwritten.
The environment override is restricted to tests or an explicit break-glass
session and is surfaced as the policy source, so it cannot silently become a
second configuration system.

## Pilot decision report

Capture comparable capacity-one and capacity-two windows in one JSON document
with `baseline` and `pilot` metric objects, then evaluate it with
`scripts/local-ci-pilot-report.mjs`. The report emits one machine-readable
recommendation:

- `retain` (exit 0): representative windows, at least 20% p95 queue-wait
  improvement, median service-duration regression no greater than 15%, and all
  safety checks clear;
- `tune` (exit 1): safety remains intact, but the windows are insufficient,
  incomparable, or the queue-wait improvement is not yet material; or
- `rollback` (exit 2): malformed evidence, an isolation/evidence/attribution
  defect, a host or Docker health breach, service-duration regression above
  15%, or infrastructure failure rate above 5%.

Any overlap, cross-slot cleanup, wrong dependency graph, wrong database,
wrong-artifact, or unattributed failure is an immediate rollback
recommendation regardless of throughput.

Decision thresholds live in the shared
`apps/web/lib/nonprod/local-ci-pilot-guardrails.json` platform contract used by
both policy validation and the report. They are not fields supplied by the
evidence document. A validated install policy may tighten a rollback threshold,
but a client cannot relax the minimum sample, improvement,
service-regression, infrastructure-failure, or comparability thresholds while
grading its own run.

## Recovery

A lost database heartbeat and a live local process fence is an unhealthy slot,
not evidence that the slot is free. Admission fails closed until the owner is
terminated or the dead fence is reaped.

Portal quiescence can outlast a queued claim's short heartbeat window, and a
later process can encounter terminal claim keys left by earlier attempts. The
gate uses one deterministic `rerun-N` sequence for every terminal result
(`released`, `cancelled`, or `expired`). It probes existing terminal attempts
monotonically until a fresh claim is accepted, always inside the original
admission deadline and with the same owner session. Every fresh attempt enters
at the FIFO tail; it never inherits a terminal row's former position. Durable
lease events record the prior and replacement claim keys, terminal reason, and
whether portal quiescence interrupted the queued observation.

Port reachability is also not resource ownership. The runner verifies the exact
manifest-named PostgreSQL container before reuse. If the assigned port is
occupied while that container is absent, provisioning fails closed and names
the conflicting slot, port, and expected container; it must never borrow a
legacy or peer database merely because TCP accepts a connection.

Lease recovery uses the recorded cleanup command:

`node scripts/local-ci-slot-cleanup.mjs --slot-key <recorded-slot>`

The cleanup planner accepts only the closed manifest slot keys, scopes Compose,
container, volume, and build-output cleanup to that identity, and validates the
filesystem target remains inside the slot scratch boundary. The command must
come from the lease record or diagnosed slot state; never guess a peer slot.
Use `--dry-run` when investigating so the exact targets are visible without
mutation.

The gate, runner, status reader, and cleanup planner all resolve the same root
from `git rev-parse --git-common-dir`. Only a conventional common directory
named `.git` is reduced to its parent clone; a central bare common directory is
already the root. If a caller supplies a different root, manifest construction
fails before cleanup or other host mutation. This prevents a linked topic
worktree from inventing a second `*-worktrees` boundary.

If freshness convergence cannot prove the dependency graph, the result is
`blocked_sandbox_drift`, not a product failure. Each slot has its own
convergence mutex and scratch pnpm store, so starting a second install as a
repair is never valid.

## Evidence contract

Every exact-tree result records:

- manifest schema version and slot key
- candidate branch/SHA, accepted base, integration commit, and synthesized tree
- resolved dependency versions and toolchain fingerprint
- PostgreSQL container, port, database, and volume
- Compose project and portal URL
- production artifact kind, locator, identity, and integration-tree binding
- lease, heartbeat/fence events, output path, and freshness verdict
- accepted-base freshness as `remote-current`, `offline-accepted`, or
  `fetch-failed`, including the admission-time resolution timestamp

`origin/main` is refreshed once after admission and before the integration
tree is synthesized. The resolved SHA remains fixed for that run. A network
failure stops before heavy gates and is never relabeled as offline evidence.
Operators intentionally working without network must select
`--offline-accepted-base` (or `DPF_LOCAL_CI_OFFLINE_ACCEPTED_BASE=1`); that
choice is preserved in the evidence.

Capacity may increase only through the governed pilot after slot-isolation
tests and the capacity-one exact-tree gate pass. A capacity-two declaration is
not itself successful evidence: acceptance requires two unrelated exact-SHA
gates active concurrently, a third waiter remaining FIFO, owner-loss recovery
that affects only its slot, and a published comparison report.
