# Geographic reference-data index integrity repair

**Backlog item:** BI-7C2B91EF
**Epic:** EP-4A12A7CB
**Work capsule:** WC-C3CAEA4D
**Branch:** `codex/city-index-integrity`

## Outcome

Every install converges its geographic reference data back to the existing MDM contract: one active canonical Region per case-insensitive country/name key, one canonical City per case-insensitive region/name key, preserved Address references, and auditable superseded lineage. The affected indexes are rebuilt from the repaired heap before the Contributor preview clones the data.

## Proven state

- A governed read-only check found 436 duplicate Region groups and 19 duplicate City groups in the live heap.
- `pg_index` reports the corresponding btrees as unique, valid, ready, and live; an indexed predicate can return one row while a forced sequential scan returns two byte-identical keys.
- The City normalized-name pending unique index has the same contradictory state.
- The existing MDM merge substrate already defines the business rule: repoint dependents, retain the loser as `status='superseded'`, and link it through `mergedIntoId`. `Address.cityId` is the only external City foreign key; Region and City also have self-lineage references.
- The fail-safe sanitized clone correctly rejected the duplicate key and reset all 521 destination application tables. Clone filtering is therefore not the repair boundary.
- The exact physical cause of the btree divergence is not yet proven. This plan does not attribute it to an image, collation, shutdown, or storage event without separate evidence.

## Governed architecture decision

Decision interaction `DI-AED2CD86A2B0` recommends `fleet-migration-repair` with high confidence (composite 10.429, margin 6.169), no commandment conflict, and strong structured coverage. The strongest contributors were **Ship Real Functionality** and **Architecture Over Shortcuts**. Clone-only normalization would conceal corrupt production state; an operator runbook would impose hundreds of risky manual merges.

## Backlog coverage

- Decision: atomic
- Parent: `BI-7C2B91EF`
- Rationale: duplicate detection, reference-preserving survivor selection, tombstone lineage, unique-index reconstruction, functional fixture verification, and the final contributor-clone proof form one fleet convergence boundary. Splitting them could ship a destructive data rewrite without its invariant or an invariant that cannot repair affected installs.
- Fleet-safe geographic heap repair, index rebuild, regression tests, and Contributor-preview verification -> `BI-7C2B91EF`
- Dependencies: blocks `BI-7430E579`; extends completed MDM merge substrate under `EP-4A12A7CB`
- Receipt: `cmrt6oc4k048b01o9qt0snt11`

The deployed MCP surface does not expose `record_plan_backlog_coverage`, so the receipt uses the governed `record_execution_evidence` compatibility path.

## TDD implementation

1. Add a failing database integration fixture with duplicate Regions, duplicate Cities, an Address referencing a City loser, colliding and non-colliding cities across duplicate Regions, normalized-name variants, misleading same-named indexes, and a second execution pass.
2. Add one forward migration. Drop only the untrustworthy geographic unique indexes; build deterministic temporary survivor maps from heap scans; repoint Address and self-lineage references; tombstone and uniquely relabel losers; move surviving cities; add deterministic disambiguators where normalized variants remain legitimate.
3. Recreate the four affected unique indexes with their existing definitions and rebuild the Region/City tables' indexes. Assert zero duplicate keys before the migration can commit.
4. Prove a clean install is unchanged, the affected fixture preserves all rows and references, and a second pass is a no-op.
5. Run the DB suite, typecheck, migration-safety guard, migration apply, exact-SHA merged-code pregate, and open-PR overlap sweep.
6. After merge and governed self-upgrade, verify the live heap/index agreement and rerun `dev-init`; the sanitized clone and Contributor preview health must succeed before closing this BI or `BI-7430E579`.

## Safety and rollback

- This is a tightening migration with in-file idempotent remediation before index recreation, as required by the fleet-safe schema-evolution contract.
- No row is hard-deleted. Survivor choice is deterministic; losers retain their ids, lineage, timestamps, and a unique superseded label. Address relationships move to the survivor in the same transaction.
- Prisma applies the migration transactionally. Any unresolved duplicate or index-build failure rolls back the whole repair and leaves the prior install serving.
- Rollback after a successful fleet migration is an audited MDM unmerge/data-restoration operation, not a reverse schema migration; the index definitions themselves do not change.

## Documentation impact

Update the MDM/reference-data architecture documentation with the automated integrity-repair contract and the Contributor setup guide only if operator recovery behavior changes. No new route, UI, public positioning, AI-coworker behavior, schema model, or platform-support watchlist entry is required.

## Completion evidence

- [x] Failing fixture observed before the repair exists (the no-op migration left the duplicate Region active).
- [x] Repair fixture and second-pass idempotency pass, including referenced City losers, duplicate Regions, colliding/non-colliding Cities, pending and explicit normalized-name disambiguation, four rebuilt unique indexes, and unchanged row counts.
- [x] Full DB tests/typecheck and migration-safety checks pass (199 files, 1,646 tests; migration applied cleanly as migration 420 on the governed disposable database).
- [ ] Exact-SHA merged-code pregate passes.
- [ ] Live governed migration and heap/index verification pass.
- [ ] Contributor sanitized clone completes and preview health succeeds.
- [ ] PR health and merge-queue checks are terminal/passing.
