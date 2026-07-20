# PlatformConfig unique-index integrity repair

**Backlog item:** `BI-E07FEB3A`  
**Epic:** `EP-4A12A7CB`  
**Work capsule:** `WC-F28B58F1`  
**Branch:** `codex/platform-config-integrity`

## Outcome

Every install has one active `PlatformConfig` row per key, with the physical heap agreeing with `PlatformConfig_key_key`. The newest configuration remains active; older conflicting values remain durable under reserved quarantine keys. The Contributor preview can copy the table without weakening its destination constraint.

## Evidence and substrate

- The governed clone passed the pgvector, EA integrity, and array-typing repairs, then failed closed on duplicate `build-studio-dispatch` keys and reset all 521 destination tables.
- A forced heap scan found two rows while the canonical index reported unique, valid, ready, and live.
- The older row selects Claude; the newer row selects Codex/ChatGPT. Keeping the newest `updatedAt` value prevents silently reverting the operator's current dispatch choice.
- No foreign keys reference PlatformConfig ids. Quarantining the key preserves ids, full JSON values, and timestamps without introducing new substrate.

## Implementation

1. Add a database fixture with old/new conflicting values and a quarantine-key collision. Require newest-row survivorship, non-destructive quarantine, index integrity, and idempotence.
2. Disable all index scan classes; rank by `updatedAt DESC, id DESC`; collision-check quarantine keys; assert a duplicate-free heap; rebuild the canonical unique index in one transaction.
3. Run the fixture, DB typecheck, migration safety guard, exact-SHA merged-code pregate, governed self-upgrade, live heap/index proof, and the full Contributor preview clone.

## Backlog coverage

- Decision: atomic
- Parent: `BI-E07FEB3A`
- Fleet-safe migration, index rebuild, fixture, exact gate, live proof, and full preview acceptance -> `BI-E07FEB3A`
- Dependencies: blocks `BI-7430E579`; builds on `BI-A170C1EB`
- Receipt: `cmrtesb9f005301mlp7hv41sg`
- Rationale: the active-value selection, preservation, enforcement rebuild, and end-to-end proof are one indivisible configuration-integrity correction.

The live MCP surface does not expose `record_plan_backlog_coverage`, so the receipt was recorded through governed `record_execution_evidence` with the same decision, mapping, dependencies, and rationale.

## Risks and rollback

- Index rebuild DDL runs in the governed maintenance window.
- Only older duplicate keys change. Values, ids, and timestamps remain available for audit/recovery.
- Clean installs change no rows; reapplication is idempotent.
- Forward rollback restores a quarantined key only after deliberately removing/rekeying the active conflict, then rebuilding the index.

## Completion evidence

- [ ] Fixture, DB typecheck, migration safety, and exact-SHA pregate pass.
- [ ] Governed self-upgrade and forced heap/catalog proof pass.
- [ ] Full Contributor preview clone completes and `:3001/api/health` is healthy.
