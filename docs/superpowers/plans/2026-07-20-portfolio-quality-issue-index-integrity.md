# PortfolioQualityIssue unique-index integrity repair

**Backlog item:** `BI-2296E46C`  
**Epic:** `EP-4A12A7CB`  
**Work capsule:** `WC-215CE8E3`  
**Branch:** `codex/portfolio-quality-integrity`

## Outcome

Every install has one active `PortfolioQualityIssue` row per issue key, with the physical heap agreeing with `PortfolioQualityIssue_issueKey_key`. The most recently observed issue remains active; older duplicates remain durable under reserved quarantine keys. Contributor preview can copy the table without weakening its destination constraint.

## Evidence and substrate

- A clean, governed preview clone passed all prior repaired tables and failed closed at `PortfolioQualityIssue`.
- A forced heap scan found 243 duplicate groups and 243 loser rows while the canonical index reported unique, valid, ready, and live.
- `DiscoveryTriageDecision` references issue ids with `ON DELETE SET NULL`; preserving every id keeps those references intact.
- The existing unique key and migration-based repair pattern are sufficient; no new model or runtime bypass is needed.

## Implementation

1. Add a database fixture with old/new observations and a quarantine-key collision. Require newest-observation survivorship, non-destructive quarantine, healthy unique-index metadata, and idempotence.
2. Disable every index scan class; rank by `lastDetectedAt DESC, firstDetectedAt DESC, id DESC`; collision-check quarantine keys; assert a duplicate-free heap; rebuild the canonical unique index atomically.
3. Run the fixture, DB typecheck, migration-safety guard, exact-SHA merged-code pregate, governed self-upgrade, forced heap/catalog proof, and the complete Contributor preview clone.

## Backlog coverage

- Decision: atomic
- Parent: `BI-2296E46C`
- Fleet-safe migration, index rebuild, fixture, exact gate, live proof, and preview acceptance -> `BI-2296E46C`
- Dependencies: blocks `BI-7430E579`; builds on `BI-E07FEB3A`
- Rationale: source remediation and full preview acceptance are one indivisible integrity correction.

## Risks and rollback

- Index rebuild DDL runs in the governed maintenance window.
- Only older duplicate issue keys change. IDs, issue content, timestamps, and references remain intact.
- Clean installs change no data; reapplication is idempotent.
- Forward rollback restores a quarantined key only after deliberately resolving its active conflict and rebuilding the index.

## Completion evidence

- [ ] Fixture, DB typecheck, migration safety, and exact-SHA pregate pass.
- [ ] Governed self-upgrade and forced heap/catalog proof pass.
- [ ] Complete Contributor preview clone and `:3001/api/health` pass.
