---
title: Index and Collation Integrity
pageKind: entity
status: published
abstract: A text btree index is only correct relative to the collation (string-ordering) provider it was built under. Move a PostgreSQL cluster between libc implementations — for example from a musl (Alpine) base to a glibc (Debian) base — and the comparator for every text column changes underneath every existing text index. PostgreSQL still reports those indexes valid, so the damage is silent: lookups miss rows that are present, and a UNIQUE index stops rejecting duplicates. This page explains the mechanism, the fingerprint, and the detection.
sources:
  - postgresql/collation-support
---

## Why a text index depends on collation

A btree stores keys in sorted order and finds a key by comparing at each node. For text, "sorted" is defined by a **collation** — the locale-dependent rule for how strings order (`'A' < 'a'`? `'ä'` next to `'a'` or after `'z'`?). That rule comes from a provider: the operating system's **libc**, or **ICU**. The index's physical layout *is* the output of that comparator. Search the same index with a *different* comparator and you descend into the wrong subtree.

## How it silently breaks

1. A cluster is `initdb`'d under **musl** (Alpine). musl ships no locale data, so every text column effectively sorts with `C` (byte-order) semantics regardless of the `en_US.utf8` label recorded in `pg_database.datcollate`.
2. The image is later moved to a **glibc** (Debian) base — for instance to pull in an extension. glibc *does* implement `en_US.utf8`, so the comparator for every text column changes under the existing data volume.
3. Every text btree built before the flip is now ordered by the old comparator and searched by the new one. Lookups descend the wrong subtree and **miss rows that are present in the heap**.

`pg_index` still reports the index `valid`, so nothing complains. The corruption compounds:

- An upsert (`where: { key }`) misses the existing row, falls through to `CREATE`, and the **`UNIQUE` index fails to reject the insert** for the same reason — so a unique constraint quietly accumulates duplicates.
- A write-time dedup gate whose candidate lookup is a database query returns zero candidates and reports "clear" for a record that already exists.

That is how one seed run produced many duplicate rows over records first created weeks earlier.

## The fingerprint

You can recognise a cluster that was `initdb`'d under musl and then moved to glibc:

- It has only **3 libc collations** (`default`, `C`, `POSIX`) where a glibc `initdb` creates several hundred.
- `pg_database.datcollversion` is **NULL** — which also means PostgreSQL cannot emit its normal "collation version mismatch" warning, because it has no recorded version to compare against.

## Detection — find it before a UI does

Do not wait to notice duplicate rows. Sweep for it:

- `packages/db/scripts/index-integrity-guard.mjs` checks two things: **collation stability** (the musl fingerprint and any recorded-vs-actual collation-version mismatch) and **index/heap agreement** via `bt_index_parent_check(index, heapallindexed => true)` over every btree. The heap-agreement check is what actually catches a comparator flip.
- The musl fingerprint and a NULL `datcollversion` are **advisory** — they describe how the cluster was built and cannot be cleared by any repair, so failing a build on them would be permanent noise. A recorded-vs-actual collation-version mismatch, or a `bt_index_parent_check` failure, is a **real** regression and must block.

## Prevention and repair

- **Pin the database image by digest.** A floating `:pg16` tag is what let libc move under an existing volume. Re-pin only alongside a `REINDEX` plan, and run the integrity guard against the upgraded volume *before* shipping the new digest to the fleet.
- **Repair** is per-table: quarantine the duplicate losers, retire them, and rebuild the unique index from the repaired heap — see [[professions/data-architect/dedupe-migration-means-the-constraint-is-wrong]]. Always read duplicate data with `enable_indexscan = off` so a corrupt index does not under-report the damage.

## Related

- [[professions/data-architect/dedupe-migration-means-the-constraint-is-wrong]] — the rule to apply when you find duplicates behind a unique constraint.
- [[professions/data-architect/mdm-what-it-does-and-does-not-do]] — why the write-time dedup gate shares this failure mode.
- [[professions/data-architect/schema-migration-practices]] — migration discipline.
