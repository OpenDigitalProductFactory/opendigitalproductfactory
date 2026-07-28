# Local-CI sandbox pool pilot implementation plan

**Backlog item:** BI-CCA0437C
**Planning branch:** `doc/local-ci-sandbox-pool-plan`

> **For agentic workers:** execute this plan one independently reviewable backlog
> item at a time — one BI, one branch, one PR. Use `dpf-tdd` for behavior changes,
> `dpf-local-merge-ci-before-push` plus each phase's completion gate before a
> success claim, and `dpf-pr-with-dco` for handoff. Do not enable capacity two
> until fair admission and slot isolation have separately merged and passed at
> capacity one.

## Outcome

Reduce elapsed local pregate wait without weakening the exact-tree gate by
piloting two isolated `local-integration-ci` slots on hosts that have measured
headroom. Admission becomes durable FIFO instead of a one-second polling race;
each admitted gate receives a complete, typed slot identity; and one setting
returns the system to the proven singleton behavior.

This plan addresses local gate contention independently of the GitHub UX route
sweep. The sweep now crawls 201 routes with the same axe/WCAG assertions in
about 3m08, down from about 11 minutes, but its merge-group job still spends
about 4m40 waiting for the exact-tree production build. That remaining GitHub
critical-path work stays governed by the accepted CI evidence-efficiency
design and its observation window; a local sandbox pool must not be presented
as a substitute for affected-check activation or build-DAG work.

## Current measured problem

Recent exact-SHA gates repeatedly waited behind one global
`local-integration-ci` lease. Continuous one-second pollers were overtaken across
release boundaries, operators coordinated manual claim windows, and unrelated
branches accumulated queue time even when the host retained unused CPU and
memory. The singleton lease correctly prevents shared-runtime corruption, but
it combines two separate concerns:

1. admission capacity, currently fixed at one; and
2. isolation, currently expressed through one scratch worktree, one owner fence,
   one Compose identity, one portal port, and one database endpoint.

Increasing only the lease count would permit cross-gate corruption. Adding
per-worktree runtimes would violate the shared-runtime doctrine and does not
scale. The safe sequence is therefore fairness first, complete slot isolation
second, and a reversible capacity experiment last.

## Prior-design reconciliation

| Existing decision or design | Reconciliation in this plan |
| --- | --- |
| `runtime-gates-via-shared-lease` and `worktree-is-source-control-not-runtime` kernel principles | Preserve one governed **small host pool**, not a runnable runtime per topic worktree. Every gate still leases shared convergence capacity. |
| `2026-07-26-sandbox-lease-fencing.md` / PR #3638 | Preserve heartbeat, owner token, process-tree termination, and fail-closed release. Apply the fence independently to each admitted slot. |
| `2026-07-06-reusable-queueing-substrate-design.md` | Reuse `QueueTelemetryEvent`, `QueueMetricSnapshot`, and `recordQueueTransition`. Admission belongs to the existing lease lifecycle; it is not a `WorkItem` and does not get a parallel queue model or MCP tool family. |
| Unified WIP controls | Derive the local-CI lane's effective WIP limit from the same validated pool-capacity setting used by admission. Do not maintain a second hardcoded limit. |
| `2026-07-26-ci-evidence-efficiency-design.md` | Keep local exact-tree pregate exhaustive. PR check selection and TypeScript-proof reuse remain blocked on representative observation data; this pilot changes waiting capacity, not coverage policy. |
| Build Studio `SandboxSlot` | Do not reuse it. It is tied to `buildId`, `userId`, `containerId`, a single port, and initialization semantics that reset in-use state. It lacks environment identity, exact-tree provenance, FIFO/cancellation, database/Compose identity, and durable owner fencing. |
| In-process `ResourceLane` | Do not use it as the authority. It cannot coordinate separate Codex, Claude, Grok, shell, and portal processes. It may consume the effective capacity for local scheduling, but PostgreSQL remains the durable admission authority. |

No open PR was found implementing this pool or an overlapping lease-admission
change when this plan was prepared. BI-52500C0D, the heartbeat/fencing
prerequisite, is done.

## Verified substrate and extension point

The existing substrate is:

- `NonProductionEnvironmentLease` in
  `packages/db/prisma/schema.prisma`, including a unique nullable `activeKey`;
- lease transitions in `apps/web/lib/nonprod/environment-lease.ts`;
- the existing claim/renew/release/list MCP surface in
  `apps/web/lib/mcp/packs/nonprod-lease-pack.ts`;
- the supervised gate flow in `scripts/gate-worktree.mjs`;
- the convergence runner in `scripts/local-ci-runner.mjs` and
  `scripts/lib/local-integration-ci.mjs`;
- the local service topology in `docker-compose.local-ci.yml`; and
- reusable queue telemetry in `apps/web/lib/queue/queue-telemetry.ts`.

Extend `NonProductionEnvironmentLease` rather than creating another queue.
Candidate additions, to be finalized against generated Prisma types in
BI-69728276, are:

- `claimKey String? @unique` for idempotent gate-attempt admission;
- `slotKey String?` for the admitted resource identity;
- `queuedAt DateTime?`, `admittedAt DateTime?`, and `cancelledAt DateTime?`;
- `heartbeatAt DateTime?` and `phase String?` for operational evidence; and
- `queued` and `cancelled` lifecycle states in addition to the existing active,
  released, and expired states.

For admitted rows, `activeKey` becomes
`<environmentKey>:<slotKey>`. The database uniqueness invariant remains the
last line of defense against same-slot overlap.

Use the existing `PlatformConfig` key/value substrate for the operator-controlled
pilot policy, with a typed reader and strict normalization. The proposed key is
`local_ci.sandbox_pool` with a versioned JSON value containing requested
capacity, pressure ceilings, and rollback policy. Absent, malformed, or unsafe
values resolve to capacity one. Environment overrides are permitted only for
test and break-glass recovery and must be surfaced in evidence.

## Desired topology

| Identity | Slot 0 | Slot 1 | Isolation requirement |
| --- | --- | --- | --- |
| Lease | `local-integration-ci:slot-0` | `local-integration-ci:slot-1` | Unique `activeKey`, owner, heartbeat, and phase |
| Scratch checkout | `.local-ci-runner/slot-0` | `.local-ci-runner/slot-1` | No shared index, generated output, or cleanup root |
| Host fence | `dpf-local-ci-owner-slot-0.json` | `dpf-local-ci-owner-slot-1.json` | Token plus live owner PID; never a global file |
| Compose project | `dpf-local-ci-0` | `dpf-local-ci-1` | Distinct project name, network, containers, and volumes |
| Portal | Fixed slot-0 port | Fixed slot-1 port | Stable non-overlapping ports and URL in the slot manifest |
| PostgreSQL | Slot-0 container, port, database, volume | Slot-1 container, port, database, volume | No shared schema, socket, volume, or fallback container |
| Dependency state | Slot-0 workspace links and scratch store fallback | Slot-1 workspace links and scratch store fallback | Freshness and convergence cannot mutate the peer slot |
| Evidence/output | Slot-0 metadata paths | Slot-1 metadata paths | Carries slot, exact SHA, integration tree, DB, dependency, Compose, and artifact identities |

Define this topology once in a versioned, typed slot manifest consumed by the
gate, runner, Compose invocation, freshness preflight, evidence publisher, and
cleanup. Do not duplicate port arithmetic or path construction across scripts.

## Standards used

- PostgreSQL transaction-level advisory locks automatically release at
  transaction end, making
  [`pg_advisory_xact_lock`](https://www.postgresql.org/docs/current/functions-admin.html)
  suitable for serializing one environment's reconciliation.
- PostgreSQL row locking supports deterministic `ORDER BY`; `SKIP LOCKED` is
  explicitly queue-like but provides an inconsistent view, so strict FIFO
  promotion must be decided inside the serialized transaction rather than
  inferred from racing consumers:
  [`SELECT`](https://www.postgresql.org/docs/current/sql-select.html).
- Docker Compose project names are the supported way to isolate multiple copies
  of one application, including CI workloads:
  [project names](https://docs.docker.com/compose/how-tos/project-name/) and the
  [Compose application model](https://docs.docker.com/compose/intro/compose-application-model/).
  Named volumes must also be project-scoped:
  [volumes](https://docs.docker.com/reference/compose-file/volumes/).
- Windows Job Objects provide process-tree grouping, termination, accounting,
  and limits:
  [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
  and
  [CPU rate controls](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information).
  The implementation may use an existing compatible process-tree helper, but
  must preserve equivalent Windows and POSIX behavior.
- Prometheus histograms support server-side aggregation and percentile
  calculation. Reuse the existing queue metrics and prefer native histograms
  when the installed client supports them:
  [histogram practices](https://prometheus.io/docs/practices/histograms/).

## Phase 1 — durable FIFO admission at capacity one

**Delivery backlog item:** BI-69728276

### Behavior

1. Add the lease lifecycle fields through a fleet-safe migration. In the same
   migration, set every still-active legacy row to `slot-0`, rewrite its
   `activeKey` to `<environmentKey>:slot-0`, and populate admission timestamps
   before changing the uniqueness contract.
2. Reconcile one environment inside a database transaction guarded by
   `pg_advisory_xact_lock(hashtext(<stable namespace + environmentKey>))`.
   Expire dead owners, order waiting rows by `queuedAt` and stable ID, identify
   free configured slots, and admit the oldest waiter into the lowest free
   slot.
3. Make claim idempotent by `claimKey`. A retry returns the same queued or
   admitted lease. A conflicting attempt cannot create a second waiter for the
   same gate.
4. Return a discriminated claim result: admitted with lease/slot details, or
   queued with stable queue position and wait age. At capacity one, behavior is
   otherwise equivalent to today's singleton.
5. Invoke reconciliation after claim, release, expiry, and cancellation.
   Releasing a queued row cancels it; releasing an admitted row frees its slot
   and promotes the oldest eligible waiter.
6. Update the existing claim/renew/release/list MCP tools; do not add a new
   queue API. Preserve compatibility for callers that only consume the admitted
   result.
7. Replace one-second race polling in `scripts/gate-worktree.mjs` with
   idempotent queued-claim observation using bounded backoff plus jitter.
   Cancellation and signals release/cancel exactly once.
8. Record existing queue transitions and metrics for enqueued, admitted,
   cancelled, expired, released, queue depth, wait duration, and service
   duration, tagged by environment and slot but not by high-cardinality branch
   or SHA labels.

### Tests and completion gate

- Unit tests prove FIFO under concurrent claims, idempotent retries,
  cancellation, expiry promotion, deterministic slot choice, and uniqueness
  conflict recovery.
- A PostgreSQL-backed concurrency test proves that many simultaneous claimers
  yield one admitted owner and a stable queue.
- MCP contract tests prove queued/admitted discrimination and backward-safe
  list/release behavior.
- Gate tests prove it no longer depends on winning a polling race.
- Run affected Vitest/Node tests, migration safety and apply checks, TypeScript
  checks, `git diff --check`, and the mandatory exact-tree local pregate.
- Keep effective capacity fixed at one for this entire PR.

## Phase 2 — slot-scope every mutable resource

**Delivery backlog item:** BI-4BE30454
**Depends on:** BI-69728276

### Behavior

1. Add a dependency-free typed slot-manifest module with schema version,
   `slotKey`, scratch path, fence path, Compose project, portal URL/port,
   PostgreSQL container/port/database/volume, dependency state/store paths,
   evidence paths, and cleanup boundary.
2. Thread the admitted manifest through `scripts/gate-worktree.mjs`,
   `scripts/local-ci-runner.mjs`,
   `scripts/lib/local-integration-ci.mjs`,
   `scripts/sandbox-freshness-preflight.mjs`, and Compose invocation. Remove
   hidden global fallbacks such as `.local-ci-runner`,
   `dpf-local-ci-postgres`, port 54329, root port 5433, port 3010, and the
   global owner file.
3. Claim durable admission first, then acquire the slot-scoped local PID/token
   fence. If that fence is live, fail closed and reconcile the slot as unhealthy
   rather than falling through to a peer resource.
4. Scope all normal and exceptional cleanup to the admitted manifest. Validate
   resolved absolute deletion/move targets remain under the exact scratch slot
   or exact Compose project before cleanup.
5. Preserve sandbox freshness step zero independently per slot, including
   mutexed dependency convergence and scratch-local pnpm store fallback.
6. Extend evidence with manifest version, slot key, branch, candidate SHA,
   merge base, integration-tree SHA, freshness verdict, resolved dependency
   versions, database identity, Compose project, production-image digest, and
   artifact identity.
7. Keep configured capacity at one. Slot 1 may be exercised explicitly in tests
   and an isolated diagnostic, but automatic admission must not use it yet.

### Tests and completion gate

- Manifest tests prove stable, non-overlapping paths, ports, projects,
  containers, databases, volumes, and cleanup scopes for slots 0 and 1.
- Contract tests fail if a gate/runner/freshness/Compose surface uses a known
  global fallback.
- Two synthetic slot processes prove that fencing, output, and cleanup in one
  slot do not affect the other.
- Run affected Node/Vitest tests, script/Compose guards, production build,
  `git diff --check`, and the mandatory exact-tree local pregate at capacity
  one.

## Phase 3 — reversible two-slot capacity pilot

**Delivery backlog item:** BI-A4427AB8
**Depends on:** BI-69728276 and BI-4BE30454

### Behavior

1. Add a typed reader for `PlatformConfig["local_ci.sandbox_pool"]`. The
   effective capacity is `min(requested capacity, manifest slots, host-safe
   capacity)`, defaults to one, and is the single input to admission and local
   WIP reporting.
2. Before admitting slot 1, evaluate conservative host pressure: available
   memory, sustained CPU, disk free space, Docker health, and any active
   installation/convergence mutation. Insufficient or unmeasurable headroom
   keeps capacity at one and records the reason.
3. While two gates run, continuously sample per-slot process-tree/Compose CPU,
   memory, disk, dependency-convergence time, test/build duration, queue wait,
   failure classification, and host pressure. Use Job Object accounting on
   Windows where practical and an equivalent process-group/cgroup observation
   path on POSIX.
4. Automatically stop admitting slot 1 and return effective capacity to one
   when a versioned safety ceiling is breached, freshness becomes unproven,
   either slot loses fencing, Docker/database health degrades, or failure rate
   exceeds the agreed pilot threshold. Let the current owner clean up
   fail-closed; do not kill a healthy gate merely to shrink future capacity
   unless the host itself is unsafe.
5. Prove the acceptance scenario with two unrelated exact-SHA gates admitted
   concurrently and a third queued FIFO. Kill one owner process and prove only
   its slot is reaped and promoted while the peer's evidence remains valid.
6. Compare a representative capacity-one window with the capacity-two pilot:
   median and p95 queue wait, end-to-end pregate latency, service duration,
   throughput, failure/flake rate, resource saturation, and evidence validity.
   The decision report recommends retain, tune, or rollback; it does not
   silently make capacity two permanent.
7. Rollback is one validated configuration change to requested capacity one.
   No migration, branch change, or per-worktree cleanup is required.

### Pilot acceptance thresholds

Final numeric pressure ceilings must be recorded before enabling slot 1 based on
the host baseline. At minimum, retain capacity two only if:

- p95 queue wait materially decreases over a comparable workload window;
- median service duration does not regress by more than 15%;
- no overlap, cross-slot cleanup, stale dependency, wrong-database, or
  wrong-artifact evidence defect occurs;
- product-failure and infrastructure-failure classification remain attributable
  to exactly one slot and exact tree; and
- host memory, CPU, disk, and Docker health remain below the recorded safe
  ceilings.

Any isolation defect is an immediate capacity-one rollback regardless of speed.

### Tests and completion gate

- Config tests prove absent, malformed, excessive, and unsafe values fail to
  capacity one.
- Admission tests prove capacity contraction does not evict a valid owner and
  prevents new slot-1 claims.
- The two-active/third-FIFO and owner-death scenarios run as governed
  integration evidence.
- Run targeted tests, full exact-tree pregate, production build, and the pilot
  comparison report before a retain/tune decision.

## Expected files

The implementation should remain concentrated in:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_queue_nonprod_leases_for_pool/`
- `apps/web/lib/nonprod/environment-lease.ts`
- `apps/web/lib/nonprod/environment-lease.test.ts`
- `apps/web/lib/mcp/packs/nonprod-lease-pack.ts`
- `apps/web/lib/queue/queue-telemetry.ts`
- `apps/web/lib/build/wip-cap.ts` or its existing effective-capacity owner
- `scripts/gate-worktree.mjs`
- `scripts/gate-worktree-lease.test.mjs`
- `scripts/local-ci-runner.mjs`
- `scripts/lib/local-integration-ci.mjs`
- `scripts/sandbox-freshness-preflight.mjs`
- a new dependency-free slot-manifest module and tests under `scripts/lib/`
- `docker-compose.local-ci.yml`
- the relevant contributor/testing and operations documentation

If implementation requires a second configuration source, queue model, MCP
tool family, or unrelated Build Studio slot changes, stop and re-evaluate the
architecture before expanding scope.

## Migration safety

The lease migration changes a live coordination table and must tolerate any
existing active, expired, and released rows:

1. add nullable fields first;
2. idempotently backfill active legacy rows to `slot-0`, including timestamps
   and rewritten `activeKey`;
3. preserve released/expired historical rows without reactivation;
4. remediate duplicate or malformed active rows by expiring/quarantining the
   non-winning rows before a new uniqueness contract;
5. add indexes only after remediation; and
6. include an in-file migration-safety attestation or remediation block accepted
   by the migration guard.

If fleet state cannot be proven safe for the final uniqueness change, split it
into expand/backfill and later contract releases. Never edit the migration
after commit.

## Evidence, documentation, and UX impact

Each phase publishes exact-tree evidence and records queue/admission timing on
its BI. Phase 3 additionally publishes the comparison and rollback decision.
Update:

- contributor testing documentation for queued/admitted state and slot identity;
- operations documentation for capacity, pressure rollback, and recovery; and
- architecture documentation if the durable lease lifecycle changes its public
  contract.

No new operator UI is required for the pilot. Existing lease/list surfaces must
expose queued position, admitted slot, effective capacity, and rollback reason
in their structured output. A visual operations dashboard is a separate
follow-up only if pilot evidence shows operators cannot diagnose the pool from
existing observability; it must not block the latency experiment.

## Risks and mitigations

- **Isolation is incomplete.** A hidden shared path, port, database, volume, or
  store corrupts evidence. **Mitigation:** capacity remains one until structural
  contract tests and explicit simultaneous-slot tests pass; any isolation
  defect rolls back immediately.
- **FIFO is weakened by races.** Independent pollers overtake one another.
  **Mitigation:** serialize reconciliation in PostgreSQL and order by durable
  queue timestamp plus stable ID; local polling observes state but never decides
  ownership.
- **A stale owner blocks a slot.** Database TTL and host PID disagree.
  **Mitigation:** retain heartbeat/fencing, token ownership, process-tree
  termination, and reconciliation on expiry. Neither signal alone permits a
  second process to mutate the slot.
- **Two heavy builds slow both gates.** Throughput rises but user-visible
  latency worsens. **Mitigation:** host-pressure admission, automatic capacity
  contraction, and a measured 15% service-duration regression ceiling.
- **Configuration drifts from WIP reporting.** Admission says two while another
  scheduler says one. **Mitigation:** one typed effective-capacity resolver is
  consumed by both.
- **Metric cardinality grows without bound.** Branch/SHA labels overload
  Prometheus. **Mitigation:** use low-cardinality environment, slot, state, and
  outcome labels; exact-tree provenance stays in evidence records.
- **The pilot is mistaken for reduced coverage.** Faster admission masks the
  separate PR-selection work. **Mitigation:** keep exact pregate exhaustive and
  report GitHub critical-path and coverage-policy progress separately.

## Backlog coverage

- Decision: decomposed
- Parent: BI-CCA0437C
- Receipt: `cms4z2ba4098501np4i2pxfr3`
- Dependencies: none for `fair-admission`; `slot-isolation` depends on `fair-admission`; `two-slot-pilot` depends on both earlier deliverables.
- Mapping: `fair-admission` -> `BI-69728276`
- Mapping: `slot-isolation` -> `BI-4BE30454`
- Mapping: `two-slot-pilot` -> `BI-A4427AB8`

| Deliverable | Backlog item | Depends on |
| --- | --- | --- |
| `fair-admission` | BI-69728276 — Replace local-CI polling races with durable FIFO lease admission | None |
| `slot-isolation` | BI-4BE30454 — Make local-CI runner state and resources slot-scoped | `fair-admission` |
| `two-slot-pilot` | BI-A4427AB8 — Run and evaluate the reversible two-slot local-CI capacity pilot | `fair-admission`, `slot-isolation` |

This sequencing keeps each PR independently reviewable and preserves the
singleton safety contract until the pool is proven. The parent remains open
until the pilot report selects retain, tune, or rollback and all acceptance
criteria are reconciled.
