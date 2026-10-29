# Operations current-state hot path

The Operations destination is a decision surface for people actively running a
business. Its read and command path is deliberately separate from historical
Performance reporting. This keeps an assignment decision independent of chart,
report, and historical aggregation latency.

## Read contract

`VersionedOperationsSnapshot` (`operations.v1`) is the current-state boundary.
It contains:

- one deterministic read-model `version`;
- `asOf`, per-source watermarks, freshness, and explicit degraded sources;
- bounded summary, scene, queue/conflict, and activity slices; and
- measured load duration, actual data-client query count, and payload bytes.

The version excludes observation time and timing telemetry. Reading unchanged
facts therefore preserves the token; changing a rendered fact or degraded
source changes it. Consumers select one bounded slice rather than importing
Performance providers or reconstructing the whole business model. A source may
fail soft only when the snapshot records that degradation. The aggregate source
watermark is the oldest participating watermark, so one lagging source cannot
be hidden by a fresher source.

`@dpf/storefront-templates/operations` owns the portable snapshot engine,
selectors and render-neutral contracts. `loadVersionedOperationsSnapshot` is
the host loader used by the workspace, API and admin preview. The legacy
`loadLivingBusinessSnapshot` facade has been removed. Component type bridges
re-export the same canonical contracts. The load runtime counts actual
Prisma-style calls and records source outcomes without coupling the portable
projection to Prisma.

The read-model token preserves the existing FNV algorithm. It is neither an
authorization credential nor a cryptographic digest, source transaction version
or guarantee of an atomic multi-source read. Domain commands retain their own
current authority and atomic version/constraint checks. Read watermarks describe
observation time; they do not assert that underlying business records were
recently updated.

TENANTS snapshots now read canonical customer accounts, subscription renewals
and service work. Current `view_customer` authority is required before customer
reads; service tickets additionally require the existing `manage_platform`
capability. Missing authority or an over-limit source is unavailable, never a
reassuring zero. No contact, description, screening or monetary detail is added.
Stored account status is projected without a second health algorithm.

Rescue population and legal holds use one shared `AnimalProfile` /
`AnimalCustodyEpisode` adapter with the rescue cockpit and require current
`view_animal_welfare` authority at the twin boundary. Historical completed
adoption episodes are labeled adoption outcomes because one animal may return
and be adopted again. Public listings no longer establish custody. Paid invoices
establish payment; without a canonical delivery source, delivered work is
unavailable. Live rescue snapshots cannot inherit a demo boarding-room overlay.
See [the portable boundary and qualification limits](business-operations-portability.md).

## Command contract

Every assignment carries:

- a stable idempotency key;
- the snapshot `expectedVersion`;
- its intended start and end;
- the demand entity; and
- one or more physical resource entities.

The archetype adapter owns one durable atomic transaction: claim or replay the
idempotency receipt, compare the expected version, apply overlap/hold
constraints, and commit the write. The shared boundary validates commands,
collapses identical in-process retries, rejects key reuse with changed intent,
measures confirmation latency, and returns exactly one typed outcome:
`confirmed`, `conflict`, `rejected`, or `unsupported`.

The browser may show an optimistic selection while the command is pending, but
it cannot manufacture confirmation. A conflict rolls the selection back,
advances to the adapter's current version, and exposes returned safe
alternatives. Cross-process concurrency remains a database/adapter invariant;
the in-memory retry map is not a substitute for it.

## Performance and evidence

The initial operational budgets are:

| Measure | Budget |
| --- | ---: |
| Visible local response | <= 100 ms |
| Interaction to Next Paint, p75 | <= 200 ms |
| Cached current-state query, p95 | <= 150 ms |
| Conflict confirmation, p95 | <= 500 ms |
| First useful decision, p75 remote | <= 2.5 s |
| First useful decision, target local | <= 1.5 s |

The shared telemetry helpers publish browser marks/measures, nearest-rank
p50/p75/p95 summaries, and a Server-Timing value for the read. The authenticated
`GET /api/operations/snapshot` endpoint returns the versioned snapshot with
`Server-Timing`, version, and freshness headers and explicitly disables shared
or browser caching. Pull-request evidence must record measured results from the
canonical integration sandbox, including query count and query-plan evidence for
any changed database access. A unit-test duration is not runtime performance
evidence.

## Reuse boundary

The snapshot, selectors, command types, reconciliation state, telemetry, and
semantic resource list are shared by the physical twin templates. FLOOR, BOOK,
YARD, ROOMS, and TERRITORY adapters supply their own spatial facts and durable
constraints; they do not fork this hot-path contract.

Historical metric providers and reporting modules are forbidden dependencies of
the Operations hot path. A static boundary test enforces that separation.

## Historical Performance boundary

`BusinessMetricRollup` is the inverse side of that boundary: a tenant-scoped,
definition-versioned projection keyed by metric, local-business period, and
dimensions. An hourly idempotent job recomputes the current and prior business
day from canonical domain sources. The `/performance` request reads only this
bounded indexed projection; it never aggregates bookings, service turns,
allocations, or resources on demand.

Metric definitions and archetype packs remain code-owned in
`packages/storefront-templates`; the database stores values, availability,
definition version, source watermark, model-level lineage, and computation time.
Unavailable source contracts are persisted as unavailable with a reason, never
as zero. A failed job writes nothing, so the prior valid snapshot remains visible
with a delayed-freshness state. Client boundaries receive only aggregate trend or
export projections; source lineage and tenant identifiers stay server-side.

### Watched analysis

Watched questions reuse this historical boundary; they do not create another
analytics store or read Operations sources directly. An owner first reviews an
inspectable `BusinessAnalysisPlan`, including its metric, comparison, cadence,
materiality threshold, and evidence limits. Only the accepted plan fingerprint
may become a `ScheduledAgentTask`. Each run resolves the authenticated current
organization, evaluates the bounded rollup projection, and writes `TaskRun`
evidence only when a typed material change is present. An unchanged result is a
successful quiet run, not a fabricated finding. See the
[watched-analysis design](../superpowers/specs/2026-08-12-inspectable-watched-business-analysis-design.md).

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
  - `docs/superpowers/plans/2026-07-28-business-operations-and-performance-views-plan.md`
- Current code substrate reviewed:
  - `apps/web/lib/performance/business-performance-provider.ts`
  - `packages/storefront-templates/src/business-view-profile.ts`
  - `apps/web/components/ui/report-kit/README.md`
- Source of truth:
  - `BusinessMetricRollup` is the bounded historical read model;
    `PERFORMANCE_METRIC_DEFINITIONS` owns metric semantics and source owners.
- Decision:
  - extend the existing `/performance` route with report-kit progressive
    disclosure, including inspectable watched questions, and preserve the hard
    dependency boundary from Operations;
    do not create another dashboard home or perform source aggregation during
    an owner request.
