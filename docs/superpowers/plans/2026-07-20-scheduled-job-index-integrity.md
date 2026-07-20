# ScheduledJob unique-index integrity repair

**Backlog item:** `BI-69306ED7`  
**Epic:** `EP-4A12A7CB`  
**Work capsule:** `WC-F04F2FFF`  
**Branch:** `codex/scheduled-job-integrity`

## Outcome

Every install has one active `ScheduledJob` row per job id, with the physical heap agreeing with `ScheduledJob_jobId_key`. The newest persisted job state remains active; older duplicates remain durable under reserved quarantine ids. Contributor preview can copy the table without weakening its destination constraint.

## Evidence and substrate

- A clean governed preview clone passed all preceding repaired tables, including `PortfolioQualityIssue`, then failed closed at `ScheduledJob`.
- A forced heap scan found four duplicate groups and four loser rows while the canonical index reported unique, valid, ready, and live.
- No foreign keys reference ScheduledJob ids. Existing job ids and the migration repair pattern are sufficient; no new scheduler substrate or runtime bypass is needed.

## Implementation

1. Add a database fixture with old/new job state and a quarantine-id collision. Require newest-state survivorship, non-destructive quarantine, healthy unique-index metadata, and idempotence.
2. Disable every index scan class; rank by `updatedAt DESC, lastRunAt DESC NULLS LAST, createdAt DESC, id DESC`; collision-check quarantine job ids; assert a duplicate-free heap; rebuild the canonical unique index atomically.
3. Run the fixture, DB typecheck, migration-safety and data-impact guards, exact-SHA merged-code pregate, governed self-upgrade, forced heap/catalog proof, and the complete Contributor preview clone.

## Backlog coverage

- Decision: atomic
- Parent: `BI-69306ED7`
- Fleet-safe migration, index rebuild, fixture, exact gate, live proof, and preview acceptance -> `BI-69306ED7`
- Dependencies: blocks `BI-7430E579`; builds on `BI-2296E46C`
- Rationale: source remediation and full preview acceptance are one indivisible integrity correction.

## Risks and rollback

- Index rebuild DDL runs in the governed maintenance window.
- Only older duplicate job ids change. IDs, job configuration, execution state, and timestamps remain intact.
- Clean installs change no data; reapplication is idempotent.
- Forward rollback restores a quarantined job id only after deliberately resolving its active conflict and rebuilding the index.

## Completion evidence

- [ ] Fixture, DB typecheck, migration safety, data impact, and exact-SHA pregate pass.
- [ ] Governed self-upgrade and forced heap/catalog proof pass.
- [ ] Complete Contributor preview clone and `:3001/api/health` pass.
