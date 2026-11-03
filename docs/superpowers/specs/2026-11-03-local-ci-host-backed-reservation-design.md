---
status: draft
backlog: BI-34955E1F
epic: EP-LOCALCI-ADMITS
workroom: WC-10581410
research: initiative-ff4b0077-e962-4378-9255-3f0df6f9bc2f
decision: DI-8C38441632ED
builds-on: docs/superpowers/specs/2026-09-25-platform-owned-local-ci-memory-design.md
---

# Local-CI host-backed reservation

## Outcome

A local-CI gate is admitted only when both the Docker VM and the physical host
can carry its calibrated memory envelope. While the gate lease is active, that
envelope remains visible to later DPF heavyweight admissions. The platform no
longer starves its own admitted gate by scheduling conflicting DPF work. A run
may still fence when ungoverned host pressure arrives or actual gate-wide
growth exceeds the calibrated envelope; that remains infrastructure evidence,
never a verdict on the diff.

## Delivery agreement

The governed Workroom retains these medium-delivery acceptance criteria:

1. An admitted gate cannot be starved by work admitted after it.
2. The refusal happens at admission, where it is actionable, rather than
   mid-build.
3. No client-side headroom check is required for the pool to conserve capacity.
4. A run that still cannot proceed is reported as infrastructure and re-runnable
   on the same SHA, as today.

## Reproduction on the current tree

The defect is present at `56f0b174b617a80c3cc160dd6e2c3287143c3652`.
`apps/web/lib/nonprod/local-ci-pool-policy.ts:628-650` checks the calibrated
builder reserve only against Docker-VM memory. Lines 653-676 check physical
host memory only against the 6 GiB host-stage reserve. The file's immutable
blob, `bd7cb5ae5614eb93d2526f585bf19c353df8e9cb`, is byte-identical to the file
used by the first two failed gate attempts.

All three exact failures were delegated builds. No local production builder
ran, so increasing only the local builder's physical backing would change none
of them:

| Evidence | Source | Admission available | Minimum available | Observed drawdown | Last visible work |
| --- | --- | ---: | ---: | ---: | --- |
| `cmw0xuavb2kkr01lneyvs7kmr` | `e9331ea67adc512878c1d15a08433d278a758902` | 11,556,442,112 | 3,568,033,792 | 7,988,408,320 | TypeScript 7 test typecheck |
| `cmw0zeq5i2ozf01lnfnzwbx1h` | `e9331ea67adc512878c1d15a08433d278a758902` | 12,245,229,568 | 3,001,556,992 | 9,243,672,576 | TypeScript 7 test typecheck |
| `cmw143v2n39du01ln8vjfzfa5` | `1c1a526a32ef051112872e033cd6cc7374cda420` | 15,654,436,864 | 1,686,036,480 | 13,968,400,384 | Prisma generate after freshness |

Each run was admitted with `productionBuild.status: delegated`, then fenced by
`host-capacity-lost:host-memory-low`, build exit 75, and no failing product
check. Admission and in-run values use the same reclaimable-inclusive host
observer (`scripts/lib/host-available-memory.mjs`); they are not raw
`os.freemem`. The drawdown is gate-wide remaining growth after admission. It is
not attributed to TypeScript, Prisma, Docker, a model, or any other process, and
it is not an RSS measurement.

The existing 12 GiB/40 GiB fixture in
`apps/web/lib/nonprod/local-ci-capacity-profile.test.ts:204-218` exposes a
separate local-builder backing gap, but it is not the reproduction for these
failures. The first implementation test instead characterizes a delegated
claim at each exact admission value above: the current 6 GiB stage reserve
admits it, and the evidence-backed remaining-growth reserve must refuse it.

## Decision

Kernel comparison `DI-8C38441632ED` selected **host-backed lease reservation**
over a container hard limit, a physical placeholder allocation, or retry-only
recovery (composite 13.063, margin 4.274, high confidence).

The reservation is a scheduling promise, not a claim that DPF can pin Windows
RAM:

- The physical host must retain a gate-wide remaining-growth envelope at
  admission, whether the production build is local or delegated.
- The active `NonProductionEnvironmentLease` carries the envelope for the
  lease lifetime.
- Later DPF heavyweight claims treat that lease as an active host reservation.
- The existing in-run watchdog still fences pressure caused by ungoverned host
  work, driver behaviour, or measurement drift.

The checked-in remaining-growth reserve starts at 15,042,142,208 bytes: the
largest observed drawdown above, 13,968,400,384 bytes, plus the existing 1 GiB
local-CI safety margin. It is a conservative shared-host reservation proxy, not
measured TypeScript 7 demand, an RSS attribution, or pinned RAM. The 6 GiB
host-stage reserve continues to describe stage concurrency; it no longer
pretends to cover all gate-wide host growth.

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
| AC-1 | OBJ-1 | `hostRemainingGrowthPolicy.admissionReserveBytes` starts at 15,042,142,208 bytes: the maximum gate-wide drawdown in the three cited delegated failures plus a 1 GiB margin. The reserve is not capped to the unrelated 16 GiB builder limit. If it cannot fit beside the shared host reserve on the current machine, capacity is zero. |
| AC-2 | OBJ-1 | A delegated claim at each cited admission value is refused before execution because physical available memory cannot retain the 4 GiB floor plus the remaining-growth reserve. This is the failing-then-passing reproduction for the observed defect. |
| AC-3 | OBJ-1 | A local build uses `max(remaining-growth reserve, calibrated builder reserve, host-stage reserve)` as its physical-host envelope. A delegated build uses `max(remaining-growth reserve, host-stage reserve)`. Docker-VM builder admission remains separate. |
| AC-4 | OBJ-1 | Recording a leased gate result stores `{ hostTotalBytes, admissionAvailableBytes, minimumAvailableBytes, drawdownBytes, hostMemoryFence, observedAt }` in a bounded 20-sample `local_ci.host_remaining_growth_calibration` row. A larger valid drawdown raises the reserve to `drawdown + 1 GiB`; this fix never lowers the checked-in reserve automatically. A sample is invalid when values are non-finite, negative, internally inconsistent, or exceed the sampled physical total. Missing or invalid evidence uses the checked-in value. |
| AC-5 | OBJ-1 | Sufficient Docker and physical memory preserves the existing one- or two-slot result; VM-builder, host-stage, and host-remaining-growth shortfalls remain separately attributable in policy evidence. |
| AC-6 | OBJ-2 | A version-1 local-CI lease stores a server-derived `resourceClass` (`docker-build` for a local build, `typescript` for delegated) and the exact physical-host envelope in `expectedMemoryBytes`; callers cannot supply or weaken those values. |
| AC-7 | OBJ-2 | One shared byte-budget resolver decides new local-CI and `host-heavy-resource` claims in both directions. It admits only when `availableMemoryBytes >= shared host reserve + inference-growth reserve + candidate envelope + sum(active host-backed envelopes)`. The shared reserve is the existing 8 GiB host-resource reserve; the local-CI watchdog's separate 4 GiB fence is unchanged. It never substitutes active-row count for heterogeneous bytes. |
| AC-8 | OBJ-2 | The mixed-size regression queues a new 6 GiB TypeScript claim when physical availability is 24 GiB and an active 16 GiB reservation exists: the prospective 30 GiB including the 8 GiB host floor does not fit. The reverse order and a not-yet-started active reservation produce the same refusal. |
| AC-9 | OBJ-2 | New host-backed claim decisions serialize on the existing `host-heavy-resource` advisory lock before taking an environment-specific lock. The final shared-budget decision and active-reservation read occur inside that lock for both claim kinds; two simultaneous opposite-direction claims cannot each decide from an empty set. A renewal, subscription, resume, or repeated claim for the current lease excludes its own row and cannot reject its already-held reservation. |
| AC-10 | OBJ-3 | Release, cancellation, and expiry stop the reservation by changing the existing lease status; no second cleanup record or compensating process is required. The watchdog's `host-capacity-lost` outcome and same-SHA rerun semantics remain unchanged. |
| AC-11 | OBJ-3 | Repeating an unchanged infrastructure failure is not automatic. Existing durable queue/resume behaviour may wake a queued claim when capacity is released, but it does not create a new attempt after a terminal fence. |

## Architecture

### Three envelopes, two measurement domains

`resolveLocalCiPoolPolicy` keeps the purposes and measurement domains explicit:

1. Docker-VM builder capacity continues to be calculated from
   `dockerAvailableMemoryBytes`, the calibrated builder reserve, current builder
   usage, and the VM floor.
2. The host-stage reserve continues to govern how many native stages may run at
   once. It is not treated as a measurement of gate-wide growth.
3. Physical-host remaining-growth capacity is calculated from
   `availableMemoryBytes`, the host floor, and the calibrated reserve from AC-1
   through AC-4. It applies to local and delegated builds.
4. A local build's durable host envelope is the maximum of the builder,
   host-stage, and remaining-growth reserves. A delegated build's is the
   maximum of host-stage and remaining-growth reserves.
5. Effective capacity is the minimum of manifest, Docker-VM (when local),
   host-stage, and host-remaining-growth capacities. A shortfall records which
   policy refused the claim.

The host client also supplies physical `totalMemoryBytes`. The portal never
substitutes Docker-VM total memory for that value. It validates calibration
samples and the shared byte budget; an absent or inconsistent physical total
fails closed.

The calibration compares values produced by the same reclaimable-inclusive
host observer at admission and during the run. It records drawdown, not process
ownership. The watchdog remains an independent continuous check and still owns
the terminal fence.

### Bounded remaining-growth calibration

`recordLocalIntegrationResult` already receives both the decided admission
policy and the gate-wide host-pressure summary. A new pure fold keeps the last
20 valid samples. Invalid, unleased, or mismatched evidence is ignored. The
resolved reserve is the larger of the checked-in value and the largest valid
`drawdownBytes + 1 GiB`. It is not clamped down to fit a machine: inability to
retain the reserve is an admission refusal, which is the required outcome.
This slice is raise-only; lowering a host reservation needs a later evidence
review because an optimistic decrease recreates the starvation defect.

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
lock. Measurements and local-CI-specific policy inputs may be prepared before
the transaction, but the final shared-budget decision occurs only after the
shared lock. It reads active, unexpired reservations from both environments and
excludes the exact lease being resumed.

This shared domain governs competing kinds of DPF work in both directions; it
does not replace the local-CI slot invariant or count the same gate twice. A
new host-heavy request sees an active local-CI reservation, and a new local-CI
request sees an active host-heavy reservation. A repeated claim, subscription,
resume, or heartbeat for the current holder keeps the same row and excludes it
from prospective reservation. Renewals continue through the existing renewal
path and do not rerun new-admission policy against capacity the holder already
owns.

The shared resolver uses bytes, not reservation count. For a new claim it
requires current available memory to retain the existing 8 GiB shared-host
reserve, inference-growth
reserve, every other active host-backed envelope, and the candidate envelope.
This is deliberately pessimistic: v1 has no trustworthy per-lease resident-RSS
telemetry, so it treats each active envelope as still available to grow until
release. Memory already resident may therefore be conservatively reserved
again. The design makes that over-reservation explicit and never claims exact
resident-versus-remaining attribution; the safe error is queueing, not
over-admission. A later optimization may subtract attested resident usage, but
it is outside this fix.

## Ordered implementation

1. **Red test — delegated recurrence.** Add the three exact delegated
   admission/minimum pairs from the evidence table. Prove the current 6 GiB
   stage-only policy admits them, then require pre-execution refusal.
2. **Policy refactor.** Add the checked-in remaining-growth policy and a pure
   host-envelope/capacity helper; make `resolveLocalCiPoolPolicy` report each
   envelope and contract effective capacity across the VM and host domains.
3. **Calibration TDD.** Add the bounded raise-only calibration fold, persist it
   from leased gate evidence, and prove invalid or unleased evidence cannot
   change admission.
4. **Red test — durable reservation.** Extend lease fixtures to require
   server-derived reservation metadata on local-CI rows and to show that a
   later host-heavy claim sees an active local-CI row and a later local-CI claim
   sees an active host-heavy row. Cover the 24/16/6 GiB mixed-size case, both
   claim orders, a not-yet-started holder, and exact self-exclusion.
5. **Shared-budget refactor.** Replace active-row count capacity with one pure
   conservative byte-budget resolver. Reuse `resourceClass` and
   `expectedMemoryBytes`, apply the shared advisory-lock order, and make both
   claim kinds read the same active reservation set inside the lock.
6. **Lifecycle regression.** Verify release, cancel, expiry, resume, delegated
   production builds, legacy leases, and preview leases keep their existing
   semantics.
7. **Qualification.** Run the focused policy/calibration/lease suites, scoped typecheck,
   guard loop, canonical local-CI gate on the exact commit, semantic review,
   then merge/deploy. Only after deployment may the blocked UI branch re-run
   its canonical gate.

## Verification

- `pnpm --filter web exec vitest run lib/nonprod/local-ci-capacity-profile.test.ts lib/nonprod/environment-lease-pool-policy.test.ts`
- `pnpm --filter web exec vitest run lib/nonprod/local-ci-host-remaining-growth-calibration.test.ts lib/nonprod/local-integration.test.ts`
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
  concurrency calibration, V8 heap settings, TypeScript version, model
  residency, or slot count.
- Killing unrelated host processes or allocating placeholder memory.
- Claiming that DPF can prevent starvation caused by software outside its
  admission and lease boundary.
- Retrying a terminal infrastructure fence without a new explicit attempt.
