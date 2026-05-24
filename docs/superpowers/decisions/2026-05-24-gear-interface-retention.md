# GearInterface Retention Baseline (Phase 0)

| Field | Value |
| --- | --- |
| Date | 2026-05-24 |
| Status | Accepted |
| Spec | docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md |
| BI | BI-85CB31F0 |
| Epic | EP-REDUCTION-GEAR-ARCH |

## Context

Per spec §11(10), the GearInterface row stream is expected to grow quickly
once emitters expand beyond the Ring 1→2 pilot:

> "With high-volume emitters, a busy install could write 10^4-10^6
> GearInterface rows/day. Choose partitioning/retention in Phase 0 before
> enabling emitters beyond Ring 1→2."

Phase 0 emits at one interface (Ring 1→2, one row per completed
`BuildPhaseRun`), so realistic volume during the pilot is on the order of
tens to low hundreds of rows per day per install. The infrastructure
question is not "how do we keep the pilot fast" — it is "what shape do we
freeze now so adding Ring 1→2 per-tool-execution emission, Ring 2→3
archetype calibration, Ring 3→4 promotion emission, and Ring 4↔5 hive
federation in Phase 1+ does not require an emergency redesign of the table?"

## Decision

### Hot retention window

Keep all GearInterface rows in the primary `GearInterface` table for **90
days** of recorded data. Within this window, no aggregation or downsampling
— the Cockpit, Calibrator, and Autonomy Governor read row-level evidence
directly.

90 days is chosen to span (a) the longest reasonable feedback loop on
graduation eligibility (Phase 1 will surface real triples once enough
samples accrue), and (b) several monthly review cycles. Operators can
extend the window via env var (`DPF_GEAR_HOT_RETENTION_DAYS`) without a
schema change.

### Partitioning

Defer native PostgreSQL partitioning to Phase 2. Phase 0's volume does not
warrant it. When partitioning lands, the natural key is `recordedAt`
month — `GearInterface_YYYY_MM` partitions, with the parent table acting
as the read view. The existing `(organizationId, recordedAt)` and
`(innerRing, outerRing, transmissionDirection, recordedAt)` indexes are
already partition-friendly because they lead with non-recordedAt columns
or pair with recordedAt as the suffix.

The schema's `recordedAt` is `DateTime DEFAULT now()` — partition-pruning
compatible.

### Cold-tier strategy (Phase 5 sunset)

For rows older than 90 days, the Phase 5 cleanup spec will decide between:

- (A) Detach old monthly partitions to a `gear_interface_cold` schema,
  queryable but excluded from default Cockpit reads.
- (B) Project to compact aggregate rows in a `GearInterfaceAggregate` table
  keyed by `{innerRing, outerRing, capabilityName, archetypeContext, day}`
  with torque histogram + slip rollup. Discard the raw rows.

Phase 0 makes no commitment between (A) and (B). The deciding factor is
whether the Calibrator (Phase 1) needs raw-row replay for its rolling
windows. If it does, (A) wins. If the rolling window can run on monthly
aggregates, (B) wins.

What Phase 0 commits to: **pruning is deterministic and based on
`recordedAt`**. No row in GearInterface depends on any other row, so
pruning by date is safe.

### Per-source emission ceiling

To avoid a single source flooding the stream, Phase 0 documents an
emission ceiling per source type. The writer service does NOT enforce
this in code (validation of emitter density belongs in the Calibrator,
Phase 1), but Phase 0 audits emitter density before adding any new
source:

| Shaft source type | Phase 0 ceiling | Note |
| --- | --- | --- |
| `phase-run` | 1 row per `BuildPhaseRun.completedAt` | Active in pilot |
| `tool-execution` | 0 rows (adapter exists, no production emit) | Phase 1 — likely sampled, not 1:1 |
| `runtime-verification` | 0 rows | Phase 1 — Ring 3→4, archetype-scoped |
| `promotion` | 0 rows | Phase 1 — Ring 3→4 |
| `feature-pack` | 0 rows | Phase 3 — Ring 4↔5 hive federation |
| `migration-classifier` / `seed-delta-manifest` / `channel-manifest` | 0 rows | Phase 2 of governed-upgrade — Ring 4↔5 inward |

Any new emitter must update this table in a follow-up commit before
production wiring.

### Idempotency / replay-safety

The writer derives a deterministic `idempotencyKey` per spec §3.1. Replay
is safe: a re-run of the same source event upserts the same row. This
guarantees retention reasoning is monotonic — pruning by `recordedAt`
never breaks dual-emit retries because retries within the hot window
target the same row.

## Consequences

- **Phase 0 needs no new pruning job.** Hot retention is the only
  retention; nothing leaves the table yet.
- **Phase 2 must add a pruning Inngest function** when total row count
  approaches the threshold (concrete: `GearInterface` row count > 1M, or
  table size > 5GB).
- **No archive table in Phase 0.** Adding one before we know whether the
  Calibrator needs raw replay would lock in the wrong abstraction.
- **The Cockpit query API hard-codes a 7-day default window** but accepts
  longer ranges up to 90 days. Phase 2 will revisit when materialized
  aggregates land per spec §11(11).

## Open follow-ups (Phase 1+)

1. Decide cold-tier path (A vs B) once the Calibrator's data shape is
   firm.
2. Add the pruning Inngest function with a configurable retention
   window.
3. Verify partition compatibility once `gen_random_uuid()` / cuid id
   generation does not interfere with detach/attach.
4. Audit emitter density across Ring 1→2 per-tool-execution + Ring 2→3
   archetype calibration before enabling those emitters in production.
