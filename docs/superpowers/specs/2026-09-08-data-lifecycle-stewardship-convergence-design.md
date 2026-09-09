---
status: active
---

# Data Lifecycle Stewardship — Convergence Review and Design

**Date:** 2026-09-08
**Epic:** EP-A33A5C61
**Status:** Review complete; slices filed (BI-A55A651B, BI-39AAE9B8, BI-BFFB9211, BI-D9F158AF, BI-592F1E7E, BI-69C29492, BI-FCDACC13, BI-1F58569C)
**Origin:** Founder-directed database review — data-structure improvements, retention, and optimisation; the data architect must continuously implement controls before growth becomes an incident; policies (compliance, business, operational) are the driver; no new UX burden.
**Supersedes nothing.** Extends `2026-06-14-data-retention-lifecycle-governance-design.md` (retention engine), `2026-07-17-data-management-governance-design.md` (asset registry, executable policy, PDP/PEP) and `2026-06-06-data-architecture-self-maintenance-design.md` (ERD mirror and steward).

## 1. Executive decision

DPF already has most of what Informatica and Collibra sell: a logical data-asset registry with lifecycle classes, a per-field classification with regulated scopes, executable policies with obligations, a policy decision point enforced at inference dispatch, a retention engine with industry floors and legal hold, CI ratchets that fail the build when a new model is unclassified, and a nightly mirror that projects governance metadata onto the EA data-model view. The substrate is not missing. It is **disconnected in four places**, and each disconnect has a measurable cost on the live install today.

The decision is to **converge, not add**: retention is derived from the asset registry instead of a parallel hand list; the enrollment guard keys on lifecycle class instead of table names; oversized evidence payloads leave the ledger tables for the existing content-addressed blob store; and the Data Architect coworker becomes the active, tool-granted owner of a nightly growth-and-lifecycle review whose findings file their own backlog items. Users see the result inside surfaces that already exist — the EA data-model view, the Scheduled Jobs page, the Compliance obligations pages and `/admin/data-stewardship` — never a new console.

## 2. Live evidence (dev install, 16 days old)

Measured directly in Postgres on 2026-09-08. The install was re-seeded 2026-08-23, so every number below is 16 days of growth.

| Fact | Value |
| --- | --- |
| Database size | 1,763 MB |
| Tables / Prisma models | 627 / 626 |
| Retention sweep | runs nightly 04:00 UTC, `totalAffected: 0` every night (nothing is older than any window yet) |
| Industry key resolved for floors | `nonprofit-community` → no floor row → base windows |

### 2.1 Where the bytes are

| Table | Total | Rows | Heap | Index | TOAST | Rows/day | Disposition today |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ToolExecution | 505 MB | 117,310 | 78 MB | 85 MB | 342 MB | ~6,000 | audit-log 365d (one policy, ignores `auditClass`) |
| ExternalEvidenceRecord | 288 MB | 862 | 0.6 MB | 0.4 MB | 287 MB | ~55 | **none** |
| DiscoveredItem | 208 MB | 280,053 | 154 MB | 53 MB | — | ~17,500 | **none** (cascade from DiscoveryRun, which has no retention) |
| ContributorInventorySnapshot | 189 MB | 185,682 | 162 MB | 27 MB | — | ~55,000 | 7d via SyncRun cascade only |
| SecurityEvent | 106 MB | 123,657 | 66 MB | 40 MB | — | ~6,300 | security-audit 365d |
| graph_edge + graph_node | 112 MB | 134,357 | 74 MB | 37 MB | — | rebuilt | code-graph projection; only `InfraCI` labels pruned |
| RouteDecisionLog | 50 MB | 10,109 | 17 MB | 4 MB | 29 MB | ~760 | routing-log 90d |
| RouteOutcome | 7 MB | 13,969 | | | | ~880 | **none** |

### 2.2 The four anatomy findings behind those numbers

1. **CI log text is stored twice, inside JSON columns, on audit ledgers.** 449 `record_local_integration_result` calls hold 276 MB in `ToolExecution.parameters` (max 2.5 MB per row). The same runs land again as `ExternalEvidenceRecord.operationType = local_integration_ci`: 443 rows, 276 MB in `details`. That is ~560 MB, 32% of the database, one artefact type, duplicated. A content-addressed store already exists (`apps/web/lib/documents/blob-storage.ts`, `documents/sha256`, 10 MB inline ceiling).
2. **Audit-class doctrine is declared but not enforced by retention.** `apps/web/lib/audit-classes.ts` says `metrics_only` retains no payload and `journal` is 30 days rolling. The `auditClass` column exists and is populated (metrics_only 57,670 · ledger 35,950 · NULL 23,738 edge heartbeats), yet `policies.ts` enrols `toolExecution` as a single 365-day policy with no `extraWhere`. Half the table is payload the doctrine says should not exist.
3. **Two writers re-snapshot everything every run.** `DiscoveredItem`: 238,660 `network_client` rows for 335 distinct keys across 3,784 runs; the deduplicated truth already lives in `InventoryEntity.lastSeenAt`. `ContributorInventorySnapshot`: 186k rows for 1,139 distinct keys, one `createMany` per 10-minute cron, 99.4% redundant, bounded only because the sync-run prune cascades.
4. **The largest tables are invisible to the enrollment guard.** `scripts/check-retention-enrollment.mjs` recognises growth by name suffix (Event, Log, Telemetry, Receipt, Audit, Activity, Metric, Attempt, Observation, History). `…Snapshot`, `…Item`, `…Record`, `…Outcome` pass silently.

### 2.3 Projection at today's rates, no changes

| Table | 12-month rows | 12-month size |
| --- | --- | --- |
| ToolExecution | ~2.2 M | ~11 GB (payload pattern unchanged; 365d window caps it there) |
| ExternalEvidenceRecord | ~20 k | ~6.5 GB, unbounded |
| DiscoveredItem | ~6.4 M | ~4.7 GB, unbounded |
| SecurityEvent | ~2.3 M | ~2.4 GB (capped by 365d) |
| Total | | ~25 GB/year, roughly 60% of it avoidable by slices 1–3 |

The numbers are for a single-developer dev install. A multi-coworker production install with edge discovery on a real network scales the first three lines by fleet size.

## 3. Where the governance metadata lives today (answer key)

The founder asked where the metadata lives and how it enforces policy. It lives in six places, all code, all tested, and only some of them talk to each other.

| Concern | Home | Enforced by |
| --- | --- | --- |
| Table sensitivity (public/internal/confidential/restricted) | `packages/db/src/table-classification.ts` (~430 lines) | sanitized clone + export filtering; stewardship-scope CI gate |
| Logical asset registry (84 models: domain, owner/steward role, categories, sensitivity, criticality, **lifecycleClass**, residency, projection class, classification provenance) | `apps/web/lib/govern/data/assets.ts` + 25 `*-assets.ts` waves | coverage gate against live Prisma facts, shrink-only `legacy-coverage-baseline.ts` (556 lines still unclassified) |
| Per-field classification + regulated scope (PCI, PHI) | `apps/web/lib/govern/data/field-classification.ts` | schema drift test |
| Lifecycle class semantics (minimum, maximum, hold, prohibited storage, precedence) | `apps/web/lib/govern/data/lifecycle-classes.ts` | nothing deletes from here by design |
| Executable policies and obligations (mask, encrypt, destination, log-use, human-approval, delete-derived-copy, disposition-evidence) | `apps/web/lib/govern/data/executable-policies.ts`, `policy-decision.ts`, `policy-enforcement.ts` | PEP at `inference-dispatch-guard.ts`, `evaluate-inference-policy.ts`, response rehydration |
| Retention windows and retained datasets | `apps/web/lib/operate/retention/policies.ts` (41 purge, ~50 retained), `industry-floors.ts`, `legal-hold.ts` | nightly `data-retention-sweep`; `check-retention-enrollment.mjs` ratchet; `retention-enrollment-allowlist.json` |
| Compliance objects that can reference data (`DataProcessingActivity.assetIds/fieldIds/lifecycleClassIds`, `Policy.executablePolicyIds`, `DataPolicyException`, `DataControlOperation`) | `packages/db/prisma/schema/security-compliance.prisma` | referential integrity by convention and test, not FK |
| Projection for humans | `apps/web/lib/ea/data-model-mirror.ts` writes a `governance` block onto every `data_object` element; `/ea/data-model` renders it nightly | `data-model-mirror-nightly`, owner AGT-BUILD-DA |

Three clarifications the founder asked for after the first read:

- **The "asset registry" is not more tables.** `DATA_ASSET_REGISTRY` is TypeScript, compiled into the app; no database table backs it. It is, however, a fourth *declaration home* describing the same 626 models as the Prisma schema, `table-classification.ts` and `policies.ts`. That redundancy is the thing to collapse, not extend.
- **It is not asset management.** "Data asset" is catalog-vendor vocabulary for a governed dataset. DPF's asset management is the estate plane (`InventoryEntity`, `DiscoveredItem`, `CatalogIdentity`: devices, hosts, software). The name collision is real; this design retires the word and calls it **model metadata**, carried on the table itself.
- **Yes, the metadata belongs in Postgres, next to the data.** See §5.1: one declaration in the Prisma schema, emitted into the database's own catalog, read by everything else. Postgres already has standard, tool-visible carriers for exactly this (`COMMENT ON` and `SECURITY LABEL`), and DPF ships its own Postgres image, so `pg_cron` and `pg_partman` are available for in-database execution.

The "provider setup for routing" the founder remembers is the provider half of one decision: `ModelProvider.sensitivityClearance`, `TaskRequirement.residencyPolicy`, `ProviderClearanceOverride`. The data half of that same decision is a URL-prefix guess in `apps/web/lib/tak/agent-sensitivity.ts`; the payload screen is a parallel path. Neither consults the asset registry.

## 4. The disconnects

| # | Disconnect | Evidence | Cost |
| --- | --- | --- | --- |
| D1 | Asset-registry `lifecycleClass` and retention `PURGE_POLICIES` are two hand-maintained homes with zero imports either way | grep: no `govern/data` import under `operate/retention`; no `operate/retention` import under `govern/data` | single-source-of-truth violation; a model can be `telemetry-bounded` in the registry and unenrolled in retention |
| D2 | Enrollment guard keys on table-name suffix | `check-retention-enrollment.mjs` header | the three largest tables and RouteOutcome escape |
| D3 | Ledger tables carry multi-megabyte JSON payloads; `auditClass` is stored but not applied | §2.2 items 1–2 | 560 MB duplicate + ~57k rows of doctrine-violating payload |
| D4 | Per-run full re-snapshot writers | §2.2 item 3 | 99% redundant rows; one of the two is unbounded |
| D5 | Steward detectors are structural only (`fk-without-index`, `missing-inverse-relation`, `orphan-model`, `ignored-model`); nothing measures growth | `data-architecture-steward-apply.ts` | findings in this review required a human at psql |
| D6 | Floors are a hardcoded industry-alias table; jurisdiction absent; archetype carries no governance payload | `industry-floors.ts`, `StorefrontArchetype` fields, BI-90A8D153 GAP 1 | a missed alias silently drops a statutory floor; the live install has no stated basis for "base windows" |
| D7 | Data Architect coworker is `status: defined`, no governance grants, ERD-only skill | `agent_registry.json:2418`, `dpf-data-architecture-steward/SKILL.md` | the profession that should own D1–D6 cannot act |
| D8 | Route-time classification is a prefix map, not the registry | `agent-sensitivity.ts` | declared sensitivity on RouteDecisionLog is a guess about the route, not a fact about the data |
| D9 | Follow-up slices of the 2026-06-14 spec still open | Slice 3 (TaskRun/TaskMessage terminal-aware), Slice 4 (admin visibility), CoworkerMemoryNote supersede-never-delete, `ModelCapabilityChangeLog` prune never scheduled | steady small leaks |

## 5. Design — converge, then automate

### 5.1 Principle: declare once in the schema, carry it in the database, read it from the catalog

Founder direction (2026-09-08): re-combine the technologies, put the metadata where the data is, and collapse layers rather than add a registry beside the schema. The design therefore has **one declaration, one carrier, many readers**:

```
Prisma schema  (the ONLY declaration: /// @dpf lifecycle=… sensitivity=… categories=… scope=… owner=… steward=…)
        ↓ emitted by the migration generator as
Postgres catalog  (COMMENT ON TABLE / COLUMN with a dpf: JSON payload; SECURITY LABEL where an enforcing provider exists)
        ↓ read via pg_catalog (obj_description / col_description / pg_class / pg_stat_user_tables) by
  • the retention sweep       — window = f(lifecycle class, org obligations); eligible rows found by SQL, optionally pg_cron in-database
  • the enrollment guard      — any relation with a time axis and no dpf:lifecycle comment fails; no name heuristic, no allowlist
  • the growth detector       — pg_class sizes and TOAST split sampled nightly against the same catalog rows
  • the ERD mirror            — governance block comes from the catalog, not from a TypeScript registry
  • sanitized clone / export  — sensitivity read from the column comment
  • external catalog tools    — Informatica, Collibra, OpenMetadata all ingest COMMENT ON natively; nothing DPF-specific to integrate
Regulation / Obligation (archetype × jurisdiction × data class)
        ↓ resolved per organisation, stored as the org's effective window table (one row per lifecycle class)
        ↓ joined at sweep time — floors only lengthen, maxima honoured, holds exclude
Data Architect nightly review  → findings → BIs
```

What this retires: `packages/db/src/table-classification.ts` (sensitivity moves into the schema declaration), the hand lists in `operate/retention/policies.ts` (derived from the catalog), `scripts/check-retention-enrollment.mjs` plus its allowlist and the name heuristic, and the `DATA_ASSET_REGISTRY` wave files as a parallel home. What stays app-side and why: cascade to non-Postgres stores (Qdrant vectors, Neo4j) needs the app to know the derived-copy contracts; per-row legal hold stays a column; the kill switch and backup-before-purge ordering stay on the ScheduledJob row. The Prisma declaration is the source; the Postgres catalog is the executable carrier; TypeScript reads, it no longer declares.

Why `COMMENT ON` rather than a metadata table: it travels with the object (drop the table, the metadata goes), it is versioned by the same migration that creates the column, every catalog crawler on the market reads it, and it costs nothing at query time. Why not only `SECURITY LABEL`: it requires a label provider extension to be meaningful and is not read by generic tools; it is the right second carrier once row-level enforcement (e.g. `sepgsql`-style or a DPF provider) is wanted.

Nothing above is a new concept in the platform; the change is the number of homes.

### 5.2 Slices

| Slice | BI | What lands | Why this order |
| --- | --- | --- | --- |
| 1 | BI-A55A651B | `toolExecution` split by `auditClass` via `extraWhere`: metrics_only 30d and payload nulled at write; journal 30d; ledger 365d + floors; edge heartbeats classified at the writer | smallest diff, largest immediate byte win, closes a doctrine contradiction |
| 2 | BI-39AAE9B8 | inline-payload ceiling on the ledger writer; oversize evidence goes to the sha256 blob store once, ledger keeps digest + summary; ExternalEvidenceRecord enrolled; blob GC in the sweep; one-off backfill | removes 32% of the DB and the growth pattern behind it |
| 3 | BI-BFFB9211 | DiscoveryRun purge (keep latest per connection); discovery and contributor-inventory write only on digest change; both tables registered `telemetry-bounded` | turns two re-snapshot logs into change logs |
| 4 | BI-D9F158AF | **4a + 4d-i built:** structured `/// @dpf` governance tags in the Prisma schema; migration generator emits `COMMENT ON` (and labels) into Postgres; retention, guard, mirror and clone read `pg_catalog`; `table-classification.ts`, the hand lists, the enrollment heuristic, the allowlist and the registry wave files are retired; absorbs 2026-06-14 slice 3, memory-note hard delete and the unscheduled capability-log prune | the single-source collapse everything after depends on |
| 5 | BI-592F1E7E | nightly `TableGrowthSample`; steward issue types `growth-without-disposition`, `payload-anatomy`, `re-snapshot-pattern`; 12-month projection; persistent findings file one keyed BI; EA element card shows size, growth/day, disposition, last sweep digest (BI-F0F3887F) | makes this review a nightly machine job |
| 6 | BI-69C29492 | `record-retention` obligation kind seeded from existing statutory sources; floors resolved from applicable obligations for archetype + jurisdiction; alias table deleted; maxima honoured; resolved matrix visible on `/compliance/obligations` | policies become the driver; absorbs BI-90A8D153 GAP 1 |
| 7 | BI-FCDACC13 | AGT-BUILD-DA activated with governance grants; skill gains lifecycle and growth sections plus the §3 answer key; nightly job = mirror + steward + growth review + retention dry-run; monthly coverage wave proposes registry entries as PRs | the profession owns the loop |
| 8 | BI-1F58569C | route sensitivity resolved from the assets a route touches (code graph already links CodeRoute → PrismaField), prefix map as rollout floor; one classification receipt shape; RouteOutcome and RouteDecisionLog enrolled together | closes the data half of the routing decision |

Slices 1–3 are independent of each other and of slice 4. Slices 5–8 build on 4.

### 5.3 Transparency without new interfaces

- **EA data-model view** (`/ea/data-model`): the `governance` block already on every `data_object` gains `lifecycleClass`, effective window, size, growth/day, projection, last-sweep digest. This is the catalog.
- **Scheduled Jobs admin**: the retention sweep row already shows recent runs; slice 4 makes the summary list every enrolled table with its derived window; a dry-run preview button is the 2026-06-14 slice 4 item.
- **`/admin/data-stewardship`**: the existing autonomous Data Steward panel (MDM) gets a second digest column for lifecycle findings, so one page shows what the steward merged and what it swept or flagged.
- **`/compliance/obligations/[id]`**: a `record-retention` obligation lists the tables it governs and their effective window for this organisation.
- **Rooms**: the Data Architect posts its nightly digest to the platform-operations room; a finding that persists three nights becomes a BI under EP-A33A5C61.

No `/admin/data` console is built. The 2026-07-17 spec's "Admin → Data Management" workspace is deferred until the projections above prove insufficient.

## 6. Research and benchmarking

- **Collibra / Informatica Axon+EDC**: catalog with business glossary, policy objects linked to assets, lineage, stewardship workflows. DPF adopts: policy-to-asset linkage as the single driver (slice 4/6), steward ownership with automated proposals (slice 7). DPF rejects: a separate catalog UI and a manual stewardship queue — the catalog is a projection of code-declared facts, and the steward is a coworker.
- **OpenMetadata / DataHub (open source)**: ingestion-driven catalog, tags → policies, table profiling with row-count and size history, "stale table" and "unused asset" detectors. DPF adopts: profiling history and growth detectors as first-class findings (slice 5). DPF rejects: ingestion from the running database as the source of truth — Prisma facts plus the registry are authoritative; the database is measured, not mined.
- **Postgres operational practice** (`pg_partman`, TimescaleDB retention policies, Debezium outbox): time-partitioned event tables with partition-drop retention once volume warrants. DPF keeps this as the 2026-06-14 slice 6 lever, unlocked by slice 5's measurements; the registry can carry a per-asset `strategy: "partition-drop"` without changing callers.
- **Regulatory anchors** already cited in the compliance seeds (IRS/FLSA 7-year, HIPAA 6-year, GDPR storage limitation as a maximum, EU AI Act logging obligations): slice 6 re-expresses the four hardcoded floors as obligations against those same sources rather than inventing new ones.

## 7. Safety properties (unchanged and extended)

1. Backup-before-purge, kill switch, dry-run, batch + cap, floors-only-lengthen, regulated exclusion, legal-hold exclusion — all retained from the 2026-06-14 spec.
2. **Derivation never widens deletion silently**: compiling the registry into retention is a build-time step with a snapshot test; a lifecycle-class change that would shorten any window fails until the diff is acknowledged in the PR (same posture as the shrink-only baselines).
3. **Payload relocation is lossless**: slice 2 keeps a digest and byte length on the ledger row; the blob is reaped only after its longest referencing window, and the reap is itself disposition-evidenced.
4. **Change-only writers keep first-seen and last-seen**: slice 3 never loses the fact that an item was observed; it stops recording that nothing changed.
5. **Data-impact gate**: every slice that touches a persistent surface ships a `*.data-impact.json`; slice 5 finally produces the runtime `dispositionEvidence` the manifest contract has demanded since PR #3835.

## 8. Verification

- Unit: retention suite stays green; new tests for `auditClass` branches, registry→policy compilation equality, guard on lifecycle class, digest-change write suppression, growth detector thresholds.
- Live acceptance on the dev install, measured with the same `pg_total_relation_size` queries in §2: ToolExecution and ExternalEvidenceRecord drop by the amounts in §2.2 after backfill; DiscoveredItem and ContributorInventorySnapshot daily row growth falls by two orders of magnitude; the sweep summary shows non-zero `byCategory` once windows are reached; the EA element card shows disposition for every one of the 626 models or names its exemption.
- Regression guard: a new Prisma model with a time column and no registry entry fails CI with the message naming the registry file, not the heuristic.

## 9. Decisions and open questions

**Decided (this review, founder direction 2026-09-08):**
- One declaration home: the Prisma schema. One carrier: the Postgres catalog (`COMMENT ON`, later `SECURITY LABEL`). Everything else reads; nothing else declares. Retention, classification, growth and the ERD mirror are readers of the same catalog rows.
- The word "asset" is retired for this concern to avoid collision with estate asset management; the concern is model metadata.
- No new admin console; transparency through existing projections.
- The Data Architect coworker owns the nightly loop and files its own findings.

**Deferred until measured:**
- Partition conversion for ToolExecution / SecurityEvent (needs slice 5 baselines).
- Whether per-organisation editable windows are demanded (code = floor, DB = override, never below statutory).
- The exact window for the metrics_only class (30 days proposed; doctrine says "no payload", which the write-time nulling satisfies regardless of the row window).

## 10. References

- `docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md`
- `docs/superpowers/specs/2026-07-17-data-management-governance-design.md`
- `docs/superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md`
- `docs/architecture/data-model-stewardship-runbook.md`
- `docs/professions/data-architect/wiki/data-governance-principles.md`
- BI-873F3C48, BI-C34E09B0, BI-81ABBDA2, BI-153F7E4A (shipped substrate); BI-90A8D153, BI-F0F3887F (open, absorbed by slices 5–6)
