---
title: When a Dedupe Migration Means the Constraint Is Wrong
pageKind: entity
status: published
abstract: If you are about to write a migration that removes duplicate rows from behind a UNIQUE constraint, stop. A healthy unique index rejects duplicates on insert — so their presence means the index is not doing its job, usually because it has silently diverged from the heap. Fix the cause (check index/heap agreement) before deduping, or you will be back writing the same migration for the next table next week.
sources:
  - postgresql/amcheck
---

## The rule

**A `UNIQUE` constraint that is holding duplicate rows did not fail on its own. Find out why before you dedupe.**

Duplicates behind a unique index are not a data-entry accident to be swept up per table. A valid unique btree *cannot* accept a second row with the same key — the insert would be rejected. So if duplicates exist, the index was not enforcing uniqueness at the moment those rows were written. Deduping without finding the cause treats the symptom and leaves the mechanism broken: the next seed run, the next upsert, re-creates the duplicates, and you write the same repair migration again. (This is exactly how seven near-identical "repair `<table>` index integrity" migrations landed in a single day.)

## Do this first

1. **Check index/heap agreement.** Run amcheck's `bt_index_parent_check(index, heapallindexed => true)` on the unique index. It verifies that every heap tuple is findable through the index under the index's own comparator. A failure here — not a row count — is the real signal.
2. **Read duplicate data with index scans disabled.** A plain `SELECT ... GROUP BY key HAVING count(*) > 1` may itself descend the corrupt index and *under-report* the duplicates. Force a heap scan first:
   ```sql
   SET LOCAL enable_indexscan = off;
   SET LOCAL enable_indexonlyscan = off;
   SET LOCAL enable_bitmapscan = off;
   ```
   Then count. The heap tells the truth; the index may not.
3. **Read the runbook.** `docs/runbooks/2026-07-20-collation-drift-index-corruption.md` documents the specific incident this rule generalises, and [[professions/data-architect/index-and-collation-integrity]] explains the mechanism.

## When you do write the repair

Use the shared, tested pattern, not a hand-copied migration. The ratified sequence — force heap scan → rank duplicates by a declared survivor ordering → collision-checked quarantine rename into the `__dpf_quarantined__` namespace → **retire the loser in the same statement** → fail-closed assertion that no duplicate remains → drop and recreate the unique index from the repaired heap — is emitted by `buildExactKeyRepairSql` (`packages/db/src/migrations/exact-key-repair.ts`). Two traps a hand-written copy repeatedly falls into:

- **Forgetting to retire the loser.** Quarantining the key alone leaves the row `active`, so it still renders as a live duplicate (a "ghost"). The retirement step must run in the *same* `UPDATE` that renames the key, or a follow-up migration is needed. The shared helper takes the retirement columns as a first-class parameter for exactly this reason.
- **Natural-key foreign keys.** If a child table references this table's *natural key* (not its `id`) with `ON UPDATE CASCADE`, detach those constraints before renaming losers — otherwise the cascade drags a canonical child reference onto the quarantined row — and reattach after the index is rebuilt.

## Why not just add `ON CONFLICT DO NOTHING`?

Because that hides the corruption. If the index is diverged, `ON CONFLICT` consults the same broken index and still lets the duplicate through. The fix is index/heap integrity, not a softer insert.

## Related

- [[professions/data-architect/index-and-collation-integrity]] — the usual cause: a collation-comparator change under an existing index.
- [[professions/data-architect/mdm-what-it-does-and-does-not-do]] — MDM cleans up duplicates but does not prevent them; this rule is about the prevention layer.
- [[professions/data-architect/schema-migration-practices]] — general migration discipline.
