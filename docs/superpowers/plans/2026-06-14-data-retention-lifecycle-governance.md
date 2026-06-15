# Data Retention & Lifecycle Governance — Implementation Plan

- **Date:** 2026-06-14
- **Epic:** EP-DATA-RETENTION
- **Spec:** [`docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md`](../specs/2026-06-14-data-retention-lifecycle-governance-design.md)

This plan is phased so each slice is independently shippable and verifiable. Slice 1 is implemented in this PR.

## Phase 1 — Foundation: registry + engine + scheduled purge (DONE — this PR)

1. **Policy registry** — `apps/web/lib/operate/retention/policies.ts`: `PURGE_POLICIES` (17 enrolled datasets), `RETAINED_DATASETS` (regulated holds), `RetentionCategory` union, cascade-correct chat handler.
2. **Industry floors** — `industry-floors.ts`: `INDUSTRY_RETENTION_FLOORS`, `resolveEffectiveRetentionDays` (max, never shorten), `resolveOrgIndustryKey` + alias map.
3. **Engine** — `execute.ts`: `runRetentionSweep` (batched id-windowed delete, per-policy cap, dry-run count, custom handler, error isolation).
4. **Orchestration** — `run.ts`: kill switch, industry resolve, `ScheduledJob` heartbeat + rolling summary.
5. **Scheduled job** — `queue/functions/data-retention-sweep.ts` (cron `0 4 * * *` after backups; manual event); registered in `functions/index.ts`; catalogued (editable, run-now) in `scheduled-jobs/catalog.ts`; `ScheduledJob` row seeded via `seed-platform-retention.ts` + `seed.ts`.
6. **Indexes** — migration `20260614180000_add_data_retention_purge_indexes` (12 single-column purge indexes).
7. **Tests** — `retention.test.ts` (17) + existing `scheduled-jobs.test.ts` (9) green.

**Exit criteria (met):** unit tests + typecheck + `prisma validate` green in the worktree; production build + migration apply + first live sweep verified via CI / shared local-CI lease per §5.

## Phase 2 — Consolidate ad-hoc purges

- Move `ModelCapabilityChangeLog` 90d prune out of `reconcile-catalog-capabilities.ts` into a `PURGE_POLICIES` entry.
- Move device-session cleanup out of `infra-prune.ts` (or have it delegate to the registry).
- Goal: one source of truth; retire bespoke `deleteMany` calls. Add a lint/test discouraging new ad-hoc date-based deletes outside the registry.

## Phase 3 — Status-aware datasets

- Enroll `TaskRun` + cascaded children (`TaskMessage`, `TaskArtifact`, `TaskNode`) and `DecisionInteraction` with terminal-state-aware selection (only completed/failed runs past the window). Needs custom handlers (joins + cascade ordering) like the chat handler.

## Phase 4 — Admin UX

- Surface the retention matrix, effective (industry-widened) windows, last-run summary (`ScheduledJob.metadata.recentRuns`), and a dry-run preview button on the Scheduled Jobs admin surface. `tracksRunData` is already true.

## Phase 5 — Archival + erasure

- Export-then-delete cold-storage tier for categories that need recoverability.
- GDPR right-to-be-forgotten flows over chat/PII (anonymize vs delete), distinct from time-based retention.

## Phase 6 — Scale strategy

- Add a per-policy `strategy: "delete" | "partition-drop"`; route the largest tables to time-range partitioning + partition drop (pg_partman-style) when an install's volume warrants it. Registry-level change; callers unaffected.

## Risks & mitigations

- **Large first run on an aged install** → per-policy cap + nightly catch-up; `capped` reported.
- **Deleting wanted data** → conservative base windows, regulated-exclusion guard test, dry-run, kill switch, backup-before-purge ordering.
- **Index build lock on huge tables** → for very large existing installs, create the purge indexes `CONCURRENTLY` out-of-band before enabling the sweep (noted in the migration comment); young installs are unaffected.
- **Industry misclassification** → floors only lengthen; regulated records protected regardless; null industry = safe base windows.
