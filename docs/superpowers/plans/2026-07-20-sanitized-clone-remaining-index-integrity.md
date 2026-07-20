# Remaining sanitized-clone unique-index integrity repair

**Backlog item:** BI-63D490FD  
**Branch:** `codex/sanitized-clone-index-sweep`

## Goal

Every install has a physical heap that agrees with all valid, simple, non-primary unique indexes. The contributor sanitized clone must copy the full source database without failing on a destination uniqueness constraint. Conflicting rows remain durable under collision-checked reserved keys; no row is deleted.

## Evidence and substrate

A forced-heap catalog sweep (`enable_indexscan`, `enable_indexonlyscan`, and `enable_bitmapscan` disabled) found the finite remaining divergence set:

| Table | Canonical key | Duplicate groups | Loser rows | Survivor rule |
| --- | --- | ---: | ---: | --- |
| `Agent` | `agentId` | 17 | 17 | oldest `createdAt`, then lexical `id` (stable seeded identity) |
| `DiscoveredModel` | `(providerId, modelId)` | 1 | 1 | newest `lastSeenAt`, `discoveredAt`, then `id` |
| `ImprovementSignal` | `(sourceType, sourceId)` | 2 | 2 | newest `lastSeenAt`, highest recurrence, newest update, then `id` |
| `ModelProfile` | `(providerId, modelId)` | 15 | 16 | newest evaluation, highest eval count, newest generated row, then `id` |
| `RawSource` | `sourceKey` | 2 | 2 | newest `updatedAt`, `createdAt`, then `id` |
| `SkillAssignment` | `(skillId, agentId)` | 3 | 3 | enabled first, highest priority, newest assignment, then `id` |
| `SkillDefinition` | `skillId` | 2 | 2 | newest `updatedAt`, `createdAt`, then `id` |
| `StorefrontArchetype` | `archetypeId` | 2 | 2 | newest `updatedAt`, `createdAt`, then `id` |
| `TaxonomyNode` | `nodeId` | 1 | 1 | lexical `id` (stable seeded identity; model has no timestamps) |

`Agent.agentId` and `SkillDefinition.skillId` are natural-key FK targets. Their incoming constraints must be detached before loser keys are changed, otherwise `ON UPDATE CASCADE` can retarget canonical references to a quarantined loser. The constraints are restored after the canonical indexes are rebuilt. All ID-based relationships remain attached to their original rows.

## Implementation

1. Add a database fixture that creates every affected table, duplicate keys, reserved-key collisions, and natural-key child references. Require deterministic survivorship, non-destructive quarantine, reference preservation, healthy unique indexes, and idempotence.
2. In one transaction, disable all index scan classes; detach the eight natural-key FKs; rank each duplicate group using the table-specific rules above; and rename every loser with a collision-checked `__dpf_quarantined__<id>__<original-key>` component.
3. Assert every repaired heap is duplicate-free, then drop and recreate the nine canonical unique indexes and restore the natural-key FKs.
4. Run the targeted fixture, the DB suite/typecheck, migration-safety/data-impact guards, and the exact-SHA merged-code pregate.
5. Deploy through governed self-upgrade, prove zero forced-heap divergence and healthy index metadata, then rerun the leased contributor preview through clone completion and `:3001/api/health`.

## Backlog coverage

- Decision: atomic
- Parent: `BI-63D490FD`
- Fleet-safe repair, fixture, data-impact evidence, live heap/index proof, and full preview acceptance -> `BI-63D490FD`
- Dependencies: builds on the earlier per-table repairs through `BI-69306ED7`; blocks contributor-preview acceptance `BI-7430E579`
- Receipt: `cmrtihrio00fe01r0wkaly4g3`
- Rationale: all nine findings are manifestations of the same source-heap/index divergence and jointly block the same clone pipeline. Shipping a subset would knowingly leave the clone broken at the next table.

## Data lifecycle and rollback

- No row is deleted and no primary key changes.
- The canonical row keeps the business key. Losers retain their complete payload and ID-based history under reserved quarantine keys.
- Natural-key child references keep the original business key and resolve to the canonical row after constraints are restored.
- Rollback is forward-only: restore a quarantined business key only after deliberately resolving its canonical conflict, then rebuild the affected unique index. The committed migration remains immutable.

## Acceptance

- [x] Fixture proves all nine survivor policies, collision handling, reference preservation, index integrity, and idempotence.
- [x] Targeted and full DB verification pass (206 files, 1,656 tests; DB typecheck; migration-safety guard; data-impact tests).
- [ ] Exact-SHA merged-code pregate passes.
- [ ] Governed live migration shows zero forced-heap divergence and all nine indexes valid/ready/live.
- [ ] Contributor preview completes migrations, sanitized clone, and `GET :3001/api/health`.
