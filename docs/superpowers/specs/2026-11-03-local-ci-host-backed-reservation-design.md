---
status: proposed
backlog: BI-34955E1F
epic: EP-LOCALCI-ADMITS
workroom: WC-10581410
research: initiative-d1a1dcf3-cd92-41ad-a7ae-4d27e14353b6
decision: DI-8C38441632ED
builds-on: docs/superpowers/specs/2026-09-25-platform-owned-local-ci-memory-design.md
---

# Local-CI host-backed reservation

## Outcome

A local-CI gate is admitted only when both the Docker VM and the physical host
can carry its calibrated memory envelope. While the gate lease is active, that
envelope remains visible to later DPF heavyweight admissions. An admitted gate
therefore reaches a product verdict unless pressure arrives from outside DPF's
admission boundary; that exceptional case remains an infrastructure fence and
never becomes a verdict on the diff.

## Reproduction on the current tree

The defect is present at `56f0b174b617a80c3cc160dd6e2c3287143c3652`.
`apps/web/lib/nonprod/local-ci-pool-policy.ts:628-650` checks the calibrated
builder reserve only against Docker-VM memory. Lines 653-676 check physical
host memory only against the smaller host-stage reserve. The file's immutable
blob, `bd7cb5ae5614eb93d2526f585bf19c353df8e9cb`, is byte-identical to the
file used by failed gate commit
`e9331ea67adc512878c1d15a08433d278a758902`.

Two clean canonical attempts on that commit were admitted and both fenced at
4:43 in web TypeScript phase 7 with
`host-capacity-lost:host-memory-low`, build exit 75, and no failing product
check (`cmw0xuavb2kkr01lneyvs7kmr` and
`cmw0zeq5i2ozf01lnfnzwbx1h`). The second run's raw `os.freemem` observation
fell from 12,320,993,280 to 3,136,466,944 bytes, below the unchanged 4 GiB
watchdog floor. That counter is not the Windows/WSL-adjusted broker value, and
the evidence does not identify the process that consumed the memory. It does
prove that a gate admitted without physical backing crossed the physical-host
fence twice.

The existing scenario in
`apps/web/lib/nonprod/local-ci-capacity-profile.test.ts:204-218` makes the
boundary executable: 12 GiB of physical memory and 40 GiB in Docker currently
admits one slot because only the 6 GiB host-stage reserve is charged to the
physical host. The first implementation step changes that expectation to a
refusal and observes it fail before changing production code.

## Decision

Kernel comparison `DI-8C38441632ED` selected **host-backed lease reservation**
over a container hard limit, a physical placeholder allocation, or retry-only
recovery (composite 13.063, margin 4.274, high confidence).

The reservation is a scheduling promise, not a claim that DPF can pin Windows
RAM:

- The physical host must have the envelope at admission.
- The active `NonProductionEnvironmentLease` carries the envelope for the
  lease lifetime.
- Later DPF heavyweight claims treat that lease as an active host reservation.
- The existing in-run watchdog still fences pressure caused by ungoverned host
  work, driver behaviour, or measurement drift.

For a local build, the larger calibrated builder envelope is deliberately a
conservative proxy for shared physical-host backing. It is not a measurement of
native TypeScript 7 demand, an RSS attribution, or memory pinned by the lease.

This uses the existing `resourceClass` and `expectedMemoryBytes` lease fields.
It adds no table, enum, daemon, client-side retry loop, or memory-holding
process.

## Scope manifest

**OBJ-1:** Local-CI admission requires simultaneous Docker-VM and physical-host
backing for the gate's governed memory envelope.

**OBJ-2:** The active gate lease is the durable host reservation, and later DPF
heavyweight admissions cannot ignore it.

**OBJ-3:** Recovery remains bounded and honest: external pressure fences the run
as infrastructure, releases the lease, and permits a later same-SHA attempt;
the platform never loops an unchanged admission automatically.

| AC | OBJ | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | A local build uses `max(calibrated builder reserve, host-stage reserve)` as its physical-host envelope. A delegated build, which does not build in Docker, uses the host-stage reserve. |
| AC-2 | OBJ-1 | With 12 GiB physical host memory, 40 GiB Docker memory, the 4 GiB floor, and the current local-build reserve, admission returns zero capacity with a physical-host-backing reason. It does not admit the old capacity-one scenario. |
| AC-3 | OBJ-1 | Sufficient Docker and physical memory preserves the existing one- or two-slot result; VM and host shortfalls remain separately attributable in policy evidence. |
| AC-4 | OBJ-2 | A version-1 local-CI lease stores a server-derived `resourceClass` (`docker-build` for a local build, `typescript` for delegated) and the exact host-backing envelope in `expectedMemoryBytes`; callers cannot supply or weaken those values. |
| AC-5 | OBJ-2 | A later, genuinely competing `host-heavy-resource` claim reads active, unexpired local-CI reservations in the same host reservation domain, so the existing host-resource policy queues rather than over-admitting. Terminal or expired local-CI leases do not consume the domain. Duplicate local-CI slot protection remains the local-CI pool's responsibility. |
| AC-6 | OBJ-2 | New host-backed claim decisions serialize on the existing `host-heavy-resource` advisory lock before taking an environment-specific lock. The lock order is identical for new local-CI and host-heavy claims, so two simultaneous new claims cannot both decide from an empty reservation set. A renewal, subscription, resume, or repeated claim for the current lease excludes its own row and cannot double-subtract or reject its already-held reservation. |
| AC-7 | OBJ-3 | Release, cancellation, and expiry stop the reservation by changing the existing lease status; no second cleanup record or compensating process is required. The watchdog's `host-capacity-lost` outcome and same-SHA rerun semantics remain unchanged. |
| AC-8 | OBJ-3 | Repeating an unchanged infrastructure failure is not automatic. Existing durable queue/resume behaviour may wake a queued claim when capacity is released, but it does not create a new attempt after a terminal fence. |

## Architecture

### One envelope, two measurements

`resolveLocalCiPoolPolicy` keeps the two measurement domains explicit:

1. Docker-VM capacity continues to be calculated from
   `dockerAvailableMemoryBytes`, the calibrated builder reserve, current builder
   usage, and the VM floor.
2. Physical-host capacity is calculated from `availableMemoryBytes`, the host
   floor, and the host-backing envelope from AC-1.
3. Effective capacity is the minimum of manifest, Docker-VM, and physical-host
   capacities. A shortfall records which domain refused the claim.

This is intentionally not derived from the in-run `os.freemem` watchdog
sample. Admission uses the existing pessimistic client/server merge; the
watchdog remains an independent continuous check.

### The lease is the reservation

`claimNonprodEnvironmentLease` derives reservation metadata from the resolved
pool policy. It persists that metadata when a version-1 local-CI lease is born
and converges an existing queued version-1 row before admission. Preview and
legacy leases remain null, as today.

The fields already have the required lifetime: they are attached to a row whose
`status`, `expiresAt`, and `activeKey` are reconciled transactionally. Consumers
count only active, unexpired rows, so release and expiry remove the reservation
without another lifecycle.

### One host reservation domain

Claims for `local-integration-ci` and `host-heavy-resource` acquire the
`host-heavy-resource` advisory lock first. Local-CI then acquires its own pool
lock. After the shared lock is held, host-heavy admission reads active,
unexpired reservations from both environments and excludes the exact lease
being resumed.

This shared domain governs competing kinds of DPF work; it does not replace the
local-CI slot invariant or count the same gate twice. A new host-heavy request
sees an active local-CI reservation. A repeated claim, subscription, resume, or
heartbeat for that gate keeps the same row and excludes that row from any
prospective-reservation calculation. Renewals continue through the existing
renewal path and do not rerun new-admission policy against capacity the holder
already owns.

The policy remains conservative rather than pretending to know live RSS for
each reservation. `expectedMemoryBytes` is the scheduling envelope, while
`availableMemoryBytes` is the current host observation. Active local-CI rows
participate in the existing heavyweight capacity calculation just like other
admitted host work.

## Ordered implementation

1. **Red test — physical backing.** Change the 12 GiB/40 GiB policy fixture to
   require refusal, and add sufficient-host plus delegated-build cases.
2. **Policy refactor.** Introduce a pure host-backing-envelope/capacity helper;
   make `resolveLocalCiPoolPolicy` report the envelope and contract effective
   capacity across the VM and host domains.
3. **Red test — durable reservation.** Extend lease fixtures to require
   server-derived reservation metadata on local-CI rows and to show that a
   later host-heavy claim sees an active local-CI row.
4. **Lease integration.** Reuse `resourceClass` and `expectedMemoryBytes`, add
   the shared advisory-lock order, and include active local-CI rows in the
   host-resource reservation read.
5. **Lifecycle regression.** Verify release, cancel, expiry, resume, delegated
   production builds, legacy leases, and preview leases keep their existing
   semantics.
6. **Qualification.** Run the focused policy/lease suites, scoped typecheck,
   guard loop, canonical local-CI gate on the exact commit, semantic review,
   then merge/deploy. Only after deployment may the blocked UI branch re-run
   its canonical gate.

## Verification

- `pnpm --filter web exec vitest run lib/nonprod/local-ci-capacity-profile.test.ts lib/nonprod/environment-lease-pool-policy.test.ts`
- `pnpm --filter web exec vitest run lib/nonprod/environment-lease.test.ts lib/nonprod/environment-lease-host-resource.test.ts lib/nonprod/environment-lease-release.test.ts`
- Scoped `apps/web` typecheck and repository guards required by the changed
  paths.
- Canonical `pnpm gate:context` and `pnpm pr:ready -- --worktree ...` on the
  committed tree, without heap, floor, model, context, or gate-policy
  overrides.
- Post-deploy live proof: a deliberately insufficient physical-host fixture is
  refused before execution; an admitted gate's readback retains
  `resourceClass` and `expectedMemoryBytes` until release; a concurrent
  heavyweight request queues.

## Rollback

Revert the change. Existing nullable lease fields and legacy rows need no data
migration or cleanup. The system returns to snapshot-only admission and keeps
the current watchdog fence, which is safe but again susceptible to admitting a
gate the physical host cannot carry.

## Out of scope

- Changing the 16 GiB builder ceiling, 4 GiB host/VM floor, 6 GiB host-stage
  calibration, V8 heap settings, TypeScript version, model residency, or slot
  count.
- Killing unrelated host processes or allocating placeholder memory.
- Claiming that DPF can prevent starvation caused by software outside its
  admission and lease boundary.
- Retrying a terminal infrastructure fence without a new explicit attempt.
