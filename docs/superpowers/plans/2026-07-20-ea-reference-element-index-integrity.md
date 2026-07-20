# EA reference element unique-index integrity repair

**Backlog item:** `BI-A794805F`  
**Epic:** `EP-4A12A7CB`  
**Work capsule:** `WC-B67C9451`  
**Branch:** `codex/ea-reference-element-integrity`

## Outcome

Every install has one canonical `EaReferenceModelElement` row per `(modelId, slug)`, and the physical heap agrees with the canonical unique index. Duplicate rows remain available under reserved quarantine slugs, preserving their ids, parent/child links, assessments, attributes, and provenance. The governed Contributor preview can enforce and copy the table without weakening destination constraints.

## Evidence and substrate

- The governed Contributor preview passed the artifact repair, copied the large inventory/discovery tables, then failed closed at `EaReferenceModelElement` and reset all 521 destination tables.
- A forced sequential scan found 22 duplicate groups (23 loser rows) while `EaReferenceModelElement_modelId_slug_key` reported unique, valid, ready, and live.
- `parentId` and `EaReferenceAssessment.modelElementId` reference element ids. Renaming loser slugs preserves every ID-based relationship.
- The seed/import contract already identifies elements by the canonical `(modelId, slug)` key. Rebuilding the index restores that contract without inventing new substrate.
- The fleet-safe quarantine and trustworthy-index-rebuild pattern is established by the adjacent DigitalProduct and EA artifact integrity repairs.

## Implementation phases

1. **Migration fixture first.** Reproduce duplicate natural keys, a quarantine-name collision, a child linked to a loser, and an assessment linked to a loser. Require deterministic lexical-id survivorship, non-destructive quarantine, relationship preservation, a rebuilt valid unique index, and idempotence.
2. **Fleet-safe migration.** Disable all index scan classes; quarantine every lexical loser with a collision-checked reserved slug; assert zero heap duplicates; drop and recreate the canonical index in one transaction.
3. **Structural gates.** Run the migration fixture, DB tests/typecheck, migration-safety and data-impact guards, and exact-SHA merged-code pregate.
4. **Functional acceptance.** Apply through governed self-upgrade, prove heap/index integrity, then rerun the leased Contributor preview through sanitized-clone completion and `:3001/api/health`.

## Backlog coverage

- Decision: atomic
- Parent: `BI-A794805F`
- Fleet-safe quarantine migration, canonical unique-index rebuild, fixture, exact gate, governed live proof, and full Contributor preview acceptance -> `BI-A794805F`
- Dependencies: blocks `BI-7430E579`; builds on completed EA artifact and DigitalProduct integrity repairs
- Receipt: `cmrtcqw9u00ch01o92x5oizc8`
- Rationale: migration, enforcement rebuild, and functional proof are one indivisible correction; splitting them leaves either source data or destination enforcement untrusted.

The live MCP surface does not expose `record_plan_backlog_coverage`, so this receipt was recorded through the governed `record_execution_evidence` path with the same atomic decision, mapping, dependency graph, and rationale.

## Risks and rollback

- The index rebuild takes DDL locks during the self-upgrade maintenance window.
- Quarantine changes only duplicate loser slugs. IDs, relationships, attributes, and provenance remain intact.
- A clean install changes no rows. Reapplication is idempotent because only duplicate ranks are renamed and the index is rebuilt from the verified heap.
- Rollback is forward-only: a quarantined slug may be restored only after its canonical conflict is deliberately resolved, followed by another unique-index rebuild.

## Completion evidence

- [ ] Fixture proves deterministic quarantine, relationship preservation, index integrity, and idempotence.
- [ ] Migration safety/data-impact guards, DB typecheck, and exact-SHA pregate pass.
- [ ] Governed self-upgrade applies the migration; forced heap/catalog checks pass.
- [ ] Governed Contributor preview completes the full clone and serves `:3001/api/health`.
