# Data Retention & Lifecycle Governance — Design

- **Date:** 2026-06-14
- **Status:** Slice 1 implemented (this PR); follow-up slices specified below
- **Epic:** EP-DATA-RETENTION — Data Retention & Lifecycle Governance
- **Author:** Platform engineering (Claude, direct-implementation per Build-Studio-rearchitecture override)

## 1. Problem

The platform writes to dozens of append-only tables that grow without bound: tool/authority audit logs, AI adapter telemetry, routing decisions, build-dispatch logs, self-upgrade history, coworker chat, notifications, eval runs, skill/wiki events, coworker turn metrics, and more. The two busiest (`ToolExecution`, `AdapterRunTelemetry`) gain a row on **every** tool call and **every** LLM inference respectively. With no application-database retention, an install's Postgres grows monotonically until it degrades query performance and eventually exhausts disk — a guaranteed "down the line" failure.

Two existing retention mechanisms cover only the edges:

- **Observability stack** — Loki logs (`retention_period: 336h`, 14d) and Prometheus TSDB (`--storage.tsdb.retention.time=15d`) already self-prune. These are the LGTM stack, **not** the application database.
- **Ad-hoc purges** — `runtime-target-janitor` (lease/heartbeat expiry), `infra-prune` (stale CIs + device sessions), and `reconcile-catalog-capabilities` (prunes `ModelCapabilityChangeLog` > 90d). These are scattered, table-specific, and cover a tiny fraction of the accumulation surface.

There is **no** unified retention policy, **no** scheduled purge across the high-volume tables, and **no** explicit regulatory-hold posture (financial records that many business models must keep for 7 years sit in the same database with no protection guaranteeing they are *not* deleted, and no guarantee the rest *is*).

This design adds a single declarative retention policy registry, a generic scheduled purge engine, regulatory holds, and archetype/industry-aware retention floors.

## 2. Goals / Non-goals

**Goals**
- One declarative source of truth for "what we purge, how long we keep it, and what we must never delete."
- A daily, governed, operator-controllable scheduled purge across the highest-volume accumulation surfaces.
- Hard protection for regulated records (financial, tax, compliance, licensing, HR, consent) — never auto-purged.
- Archetype/industry awareness: a bank or clinic automatically retains audit/chat longer than a coffee shop; floors only ever **lengthen** retention.
- Performance: every enrolled purge is index-driven (no nightly full-table scans).
- Safety: purge runs after backups, in batches, under a per-policy cap, with a dry-run mode and an operator kill switch.

**Non-goals (this slice)**
- Archival/cold-storage tiering (export-then-delete). Slice 1 deletes; archival is a future slice.
- Per-org, admin-editable retention windows in the DB. Slice 1 windows are code-defined (auditable, drift-free); industry floors + the kill switch provide per-install variance.
- Purging `TaskRun`/`TaskMessage`/`DecisionInteraction` (status-aware, needs join logic) — future slice.
- Anonymization/pseudonymization as an alternative to deletion — future slice (GDPR erasure flows).

## 3. Research & Benchmarking

Comparison of how mature systems model data lifecycle, reading their mechanisms (not just feature lists).

### Open source
- **Grafana Loki** (already in our stack) — time-window retention via a compactor that deletes chunks older than `retention_period`, with optional per-stream overrides. **Adopted:** the "delete strictly older than a cutoff" model and per-category windows. **Rejected:** stream-label-based overrides (our categories are coarser).
- **PostHog / ClickHouse TTL** — declarative `TTL eventTime + INTERVAL n DAY` on the table; the engine reclaims expired rows in background merges. **Adopted:** declarative per-dataset windows. **Rejected:** engine-native TTL — Postgres has no row TTL, and a per-table TTL column is invasive vs. a central registry.
- **pg_partman (Postgres partitioning + retention)** — time-range partitions with automatic drop of old partitions (metadata-only, near-instant vs. row `DELETE`). **Adopted as a future option** for the very largest tables at scale. **Rejected for slice 1:** partitioning every hot table is a heavy schema change unjustified for young installs; batched `DELETE` on an index is sufficient now and the registry can later route a table to a partition-drop strategy without changing callers.
- **ServiceNow Table Cleanup / Table Rotation** (commercial-OSS-adjacent reference) — scheduled jobs delete (cleanup) or rotate (rolling partitions) records per a per-table policy table. **Adopted:** the central per-table policy + scheduled executor pattern, and the cleanup-vs-rotation distinction (we start with cleanup).

### Commercial
- **Datadog / Splunk** — tiered retention; Splunk `frozenTimePeriodInSecs` per index; Datadog configurable log retention + 15-month metrics. **Adopted:** category-tiered windows (telemetry short, audit long).
- **AWS S3 Lifecycle / DynamoDB TTL** — declarative per-object/item expiry with a managed sweeper. **Adopted:** declarative intent separated from the execution engine.
- **Financial/records regimes (IRS, SOX, HIPAA, GDPR)** — IRS/SOX → ~7-year financial-record retention; HIPAA → ~6-year clinical; GDPR → storage-limitation + erasure. **Adopted:** the regulated-hold list with cited bases, and industry floors keyed to sector.

### Patterns adopted
1. Declarative per-dataset policy, central registry, generic executor (ServiceNow, S3, DynamoDB).
2. Delete-older-than-cutoff with category-tiered windows (Loki, Splunk, Datadog).
3. Regulated-hold exclusion with statutory basis (IRS/SOX/HIPAA/GDPR).
4. Industry-aware floors that only lengthen (sector record-keeping law).

### Anti-patterns identified (and what we do instead)
- **Silent unbounded growth** (current state) → scheduled bounded purge.
- **Scattered ad-hoc `deleteMany`** (`infra-prune`, `reconcile-catalog`) → one registry; existing ad-hoc purges flagged for consolidation (§9).
- **Purge without a backup** → schedule the sweep *after* the daily backups.
- **Hard-coded windows with no operator escape** → kill switch + dry-run + caps.

## 4. Architecture overview

```
PURGE_POLICIES (policies.ts)  ─┐
RETAINED_DATASETS (policies.ts)│  declarative registry (single source of truth)
INDUSTRY_RETENTION_FLOORS ─────┘  (industry-floors.ts)
            │
            ▼
runRetentionSweep (execute.ts)   pure engine: cutoff = now - max(base, industryFloor)
            │                     batched id-windowed deleteMany | custom handler | dry-run count
            ▼
executeScheduledRetentionSweep (run.ts)   kill switch + industry resolve + ScheduledJob heartbeat
            │
            ▼
dataRetentionSweepScheduled / ...Requested (queue/functions/data-retention-sweep.ts)
   cron "0 4 * * *" (after 03:00 backups) + manual event, quiescence-gated
            │
            ▼
catalog.ts (editable, run-now)   ·   ScheduledJob row (seed-platform-retention.ts)
```

## 5. Components (slice 1, implemented)

- **`apps/web/lib/operate/retention/policies.ts`** — `PURGE_POLICIES` (enrolled datasets) + `RETAINED_DATASETS` (regulated, never purged) + the closed `RetentionCategory` union + the cascade-correct `purgeStaleAgentThreads` custom handler. The single source of truth.
- **`industry-floors.ts`** — `INDUSTRY_RETENTION_FLOORS`, `resolveEffectiveRetentionDays` (`max(base, floor)`), `resolveOrgIndustryKey`, and alias normalization (`"financial"` → `"banking-financial-services"`).
- **`execute.ts`** — `runRetentionSweep`: per policy, compute the industry-widened cutoff, then **dry-run** (count only), **custom handler**, or **generic batched delete**. Batched id-windowed `deleteMany` keeps each statement small and PK-indexed; a per-policy cap bounds a single run so a backlog catches up over nights rather than one giant lock. One failing policy never strands the rest.
- **`run.ts`** — `executeScheduledRetentionSweep`: honors the operator kill switch (`ScheduledJob.enabled === false`), resolves industry, runs the sweep, and persists `lastRunAt/lastStatus/nextRunAt` + a compact rolling summary in `ScheduledJob.metadata.recentRuns` (durable audit that outlives Loki's 14-day window).
- **`constants.ts`** — job ids, cron (`0 4 * * *`), batch size, per-policy cap, named windows.
- **`queue/functions/data-retention-sweep.ts`** — the scheduled cron function (quiescence-gated, concurrency-limited to 1) and the manual `ops/data-retention.requested` event (supports `dryRun`).
- **Wiring** — registered in `queue/functions/index.ts`; catalogued in `operate/scheduled-jobs/catalog.ts` as **editable** with a run-now event; `ScheduledJob` heartbeat row seeded via `packages/db/src/seed-platform-retention.ts` (called from `seed.ts`).
- **Indexes** — migration `20260614180000_add_data_retention_purge_indexes` adds single-column purge indexes to the 12 enrolled tables whose only timestamp indexes were composite (would seq-scan).

## 6. Retention matrix (slice 1 enrolled datasets)

| Model | Category | Timestamp | Base window | Notes |
| --- | --- | --- | --- | --- |
| `ToolExecution` | audit-log | createdAt | 365d | #1 growth driver; authority audit trail |
| `AdapterRunTelemetry` | ai-telemetry | startedAt | 180d | per LLM inference; aggregates kept elsewhere |
| `TokenUsage` | ai-telemetry | createdAt | 180d | billing reconciliation window |
| `RouteDecisionLog` | routing-log | createdAt | 90d | routing reasoning; short debug value |
| `AuthorizationDecisionLog` | security-audit | createdAt | 365d | security audit; lengthened by floors |
| `CoworkerTurnMetric` | coworker-metrics | createdAt | 180d | per-turn telemetry |
| `SkillUsageEvent` | skill-telemetry | createdAt | 180d | feeds daily aggregator |
| `BuildActivity` | build-log | createdAt | 90d | build tool runs |
| `BuildDispatchAttempt` | build-log | startedAt | 90d | dispatch attempts/retries |
| `StallEvent` | build-log | createdAt | 90d | watchdog stall detections |
| `TaskEvaluation` | eval-history | createdAt | 90d | EndpointTaskPerformance is source of truth |
| `EndpointTestRun` | eval-history | startedAt | 90d | probe/scenario run summaries |
| `WikiIngestEvent` | knowledge-audit | createdAt | 90d | KB ingest audit |
| `Notification` | inbox | createdAt | 90d | **read only**; unread never swept |
| `SelfUpgradeRun` | self-upgrade-log | createdAt | 365d | deployment history |
| `QuiescenceRun` | coordination-log | startedAt | 90d | drain orchestration audit |
| `AgentThread` (chat) | coworker-chat | updatedAt | 545d | custom cascade handler; by last activity |

## 7. Regulatory holds + archetype floors

**Regulated datasets (`RETAINED_DATASETS`) are never touched by the engine.** They are catalogued with a cited basis and minimum years: invoices/payments/bills/POs/expenses/fixed-assets/exchange-rates/dunning/storefront-orders/donations/rental-agreements (financial, 7y); tax remittance/decision/liability/filing (7y); compliance evidence/audits/findings/submissions, requirement & policy acknowledgments (6–7y); org/person license records (7y); employment & termination records (7y); voice consent (7y). A unit test fails the build if any regulated model is ever enrolled for purge (`PURGE_MODELS ∩ RETAINED_MODELS = ∅`).

**Archetype/industry floors** raise the minimum retention for operational categories based on the install's `Organization.industry` (DPF is single-org-per-install). `effective = max(base, floor)` — floors only lengthen:

| Industry (archetype category) | audit-log | security-audit | coworker-chat | other |
| --- | --- | --- | --- | --- |
| banking-financial-services | 7y | 7y | 7y | routing/telemetry 1y |
| professional-services | 7y | 7y | 7y | — |
| healthcare-wellness | 6y | 6y | 6y | — |
| public-sector | 3y | 3y | 3y | — |
| (default / unknown) | base | base | base | base |

A null/unknown industry safely falls back to base windows; regulated **records** remain protected regardless of industry. Industry strings are alias-normalized (`"financial"`, `"credit-union"`, … → `"banking-financial-services"`).

**Row-level legal hold (BI-90A8D153 GAP 2).** Distinct from the table-level `RETAINED_DATASETS` above: a `legalHold` boolean on individual rows. The engine now honours it — a purge over any model carrying a `legalHold` column excludes held rows (`legalHold: { not: true }`, which spares only an explicit `true`; `false`/`null` stay purge-eligible). The held-model set (`apps/web/lib/operate/retention/legal-hold.ts`) is guarded against schema drift by `legal-hold.schema.test.ts`, which parses `schema.prisma` and fails if the set ever disagrees with the actual `legalHold` columns — so enrolling a new held model can never silently reintroduce the "held row purged" trap. Before this, `execute.ts` built its WHERE purely from the timestamp field + `extraWhere` and read none of the three existing `legalHold` columns; the trap was latent only because those models are not purge-enrolled. A full hold substrate (scope / custodian / matter / release workflow), the jurisdiction axis, and per-run disposition evidence are the remaining, separable parts of BI-90A8D153.

## 8. Safety properties

1. **Backup-before-purge** — cron at `0 4 * * *`, strictly after the `0 3 * * *` backup crons.
2. **Operator kill switch** — `editable` catalog classification; `ScheduledJob.enabled = false` skips the sweep (checked in `run.ts`).
3. **Dry-run** — `ops/data-retention.requested {dryRun:true}` counts what *would* be purged, deletes nothing.
4. **Per-policy cap** (100k/run) + **batched deletes** (1k) — no single giant lock; backlog drains over nights; `capped` is reported.
5. **Floor-only-lengthens** — industry rules can never shorten below a regulator's minimum.
6. **Regulated exclusion** — enforced in code and by a build-failing test.
7. **Quiescence-gated + concurrency 1** — never overlaps a self-upgrade drain or a prior in-flight sweep.
8. **Auditable** — rolling per-run summaries persist on the `ScheduledJob` row.

## 9. Follow-up slices

- **Slice 2 — consolidate ad-hoc purges:** fold `reconcile-catalog-capabilities` `ModelCapabilityChangeLog` prune and the device-session cleanup into the registry; retire the bespoke calls (single source of truth).
- **Slice 3 — status-aware datasets:** enroll `TaskRun`/`TaskMessage`/`TaskArtifact`/`TaskNode` and `DecisionInteraction` with terminal-state-aware selection (only purge messages of completed/failed runs past the window).
- **Slice 4 — admin UX:** surface the retention matrix, last-run summary, and a dry-run "preview" button on the Scheduled Jobs admin page (`tracksRunData` already true).
- **Slice 5 — archival tier:** export-then-delete to cold storage for categories that want recoverability, and GDPR erasure (right-to-be-forgotten) flows over the chat/PII surfaces.
- **Slice 6 — scale strategy:** route the very largest tables to a partition-drop strategy (pg_partman-style) once an install's volume warrants it; the registry can carry a per-policy `strategy` without changing callers.
- **Per-org editable windows:** if demanded, back the windows with a DB policy table layered over the code defaults (code = floor, DB = operator override, never below statutory).

## 10. Verification

- **Unit tests** (`retention.test.ts`, 17 cases): regulated-exclusion guard, registry well-formedness, floor math (lengthen/never-shorten/aliases), executor batching + cap + dry-run + cutoff math, chat cascade-order, `extraWhere` (read-only notifications), catalog registration. **Green (17/17).**
- **Catalog test** (`scheduled-jobs.test.ts`): unchanged, still green (9/9) with the new entry.
- **Typecheck:** new files type-clean (`tsc --noEmit`, full project config).
- **Schema:** `prisma validate` passes with the 12 new indexes.
- **Runtime-bound gates** (production build, migration apply, live purge) run via CI / the shared local-CI lease / canonical install per AGENTS.md §5 — not in the source-only worktree.

## 11. References

- AGENTS.md §6 (backlog), §10 (design research), §11 (data-model stewardship), §5 (gates).
- Existing precedent: `infra-prune.ts`, `runtime-target-janitor.ts`, `postgres-daily-backup.ts`, `scheduled-jobs/catalog.ts`.
- Observability retention: `monitoring/loki/loki-config.yml`, `docker-compose.yml` (Prometheus).
