# EA reference artifact unique-index integrity repair

**Backlog item:** `BI-FB6381E6`  
**Epic:** `EP-4A12A7CB`  
**Work capsule:** `WC-381DB582`  
**Branch:** `codex/ea-reference-artifact-integrity`

## Outcome

Every install has one canonical `EaReferenceModelArtifact` row per `(modelId, path)`, and the physical contents of `EaReferenceModelArtifact_modelId_path_key` agree with a forced heap scan. Duplicate artifact rows and any proposal history attached by artifact id are preserved as explicitly quarantined paths rather than deleted. The governed Contributor preview can copy the table without weakening destination constraints.

## Evidence and substrate

- The governed Contributor preview copied the 167,475-row `ContributorInventorySnapshot`, then failed closed at `EaReferenceModelArtifact` and reset all 521 destination tables.
- A forced sequential scan of the canonical install found three duplicate `(modelId, path)` groups while the canonical index reported unique, valid, ready, and live.
- `EaReferenceProposal.sourceArtifactId` references artifact ids. Renaming duplicate paths preserves those ids and their proposal history; no natural-key foreign key needs detaching.
- The seed already upserts artifacts by the canonical compound key. Rebuilding the index restores that existing write-time contract; no new model or seed path is required.
- The fleet-safe quarantine and trustworthy-index-rebuild pattern is established by `20260720133000_repair_digital_product_index_integrity`.

## Implementation phases

1. **Migration fixture first.** Add a database test that creates a model, duplicate artifact keys, proposal history on a loser, and an untrustworthy canonical-named index. It must require deterministic oldest-row survivorship, non-destructive quarantine, proposal preservation, a rebuilt valid unique index, and idempotence.
2. **Fleet-safe migration.** Disable every index scan class for heap-grounded ranking/assertion; rename each loser to a collision-checked `__dpf_quarantined__<id>__<original-path>` path; assert zero duplicate groups; drop and recreate the canonical unique index in the same transaction.
3. **Structural gates.** Run the migration fixture, DB tests/typecheck, migration-safety and data-impact guards, and exact-SHA merged-code pregate.
4. **Functional acceptance.** Apply through governed self-upgrade, prove zero heap duplicate groups plus one valid/ready/live unique index, then rerun the leased Contributor preview through sanitized-clone completion and `:3001/api/health`.

The migration, fixture, and live proof are one atomic correction under `BI-FB6381E6`; splitting them would leave either existing data or enforcement untrusted.

## Risks and rollback

- The index rebuild takes DDL locks, owned by the self-upgrade maintenance window.
- Quarantine changes only duplicate loser paths. IDs, model ownership, checksums, authority, timestamps, and proposal references are preserved.
- A clean install changes no rows. Reapplying the SQL is idempotent because only duplicate ranks are renamed and the canonical index is rebuilt from the verified heap.
- Rollback is forward-only: restore a quarantined path only after confirming the canonical survivor is no longer needed, then rebuild the unique index. The migration itself is immutable after commit.

## Completion evidence

- [ ] Fixture proves deterministic quarantine, proposal preservation, index integrity, and idempotence.
- [ ] Migration safety/data-impact guards, DB typecheck, and exact-SHA pregate pass.
- [ ] Governed self-upgrade applies the migration; forced heap/catalog checks pass.
- [ ] Governed Contributor preview completes the full clone and serves `:3001/api/health`.
