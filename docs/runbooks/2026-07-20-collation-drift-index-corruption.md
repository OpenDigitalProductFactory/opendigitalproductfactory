# Collation-drift index corruption

**Status:** root cause identified and repaired 2026-07-20 (BI-8CCF7F13)
**Applies to:** any install whose `pgdata` volume predates the Postgres base-image change

## Read this first if you are about to write a "repair `<table>` index integrity" migration

Between 2026-07-20 12:47 and 17:24, **seven** of these merged — geographic, digital product,
EA artifact, EA element, PlatformConfig, PortfolioQualityIssue, ScheduledJob. Each one correctly
deduped a table and rebuilt an index. Each was also a symptom of a single cluster-wide cause that
none of them named, so the eighth through twenty-eighth were already latent when the seventh
merged.

**If you found duplicate rows behind a `UNIQUE` constraint, you are almost certainly looking at
this.** Run the guard before writing anything:

```bash
DATABASE_URL=... pnpm --filter @dpf/db index-integrity
```

## What actually happened

1. The cluster was `initdb`'d under **Alpine/musl**. musl ships no locale data, so every text
   column sorted with **C** semantics regardless of the `en_US.utf8` label recorded in
   `pg_database.datcollate`.
2. `docker/postgres/Dockerfile` later moved to a Debian/glibc `pgvector` base (BI-A35347E4 /
   BI-4796D52B) so pgvector could never drift out of the image. Correct on its own terms — but
   glibc *does* implement `en_US.utf8`, so **the text comparator changed underneath an existing
   volume**.
3. Every text btree built before that move is ordered by the old comparator and searched by the
   new one. Lookups descend into the wrong subtree and miss rows that are present in the heap.

The cluster still carries the fingerprint: only **3** libc collations exist (`default`, `C`,
`POSIX`) where a glibc `initdb` registers several hundred, and `datcollversion` is `NULL`.

### Value-level proof

`Principal_principalId_key` physically stores `PRN-f284…` before `principal_edge_017…`. That is C
ordering (`P` = 0x50 < `p` = 0x70). The live database collation orders them the other way:

```sql
SELECT 'PRN-f284586' < 'principal_edge_017';                        -- false (db default)
SELECT ('PRN-f284586' COLLATE "C") < ('principal_edge_017' COLLATE "C");  -- true
```

## Why it is silent, and why it compounds

`pg_index` still reports the index `indisvalid`, so nothing complains. Worse, the corruption is
self-propagating through ordinary application code:

> An upsert (`where: { agentId }`) descends the broken btree, misses the existing row, and falls
> through to `CREATE`. The unique index then fails to *reject* the insert for exactly the same
> reason.

That is how one seed run produced **17 duplicate AI coworkers** over rows first created six weeks
earlier. `data_checksums` is `off`, and before BI-8CCF7F13 nothing in the repo used `amcheck` —
this failure class had zero detection.

## Diagnosing

**Always disable index scans when investigating, or you will not see the duplicates.** An index
scan returns 1 row where the heap holds 2:

```sql
SET enable_indexscan=off; SET enable_bitmapscan=off; SET enable_indexonlyscan=off;
SELECT "agentId", count(*) FROM "Agent" GROUP BY 1 HAVING count(*) > 1;
```

The definitive check is `amcheck` with `heapallindexed => true`. That argument is load-bearing: a
comparator flip leaves the btree structurally walkable, so a structure-only check **passes**.

```sql
CREATE EXTENSION IF NOT EXISTS amcheck;
SELECT bt_index_parent_check('public."Agent_agentId_key"'::regclass, true, true);
```

## Repairing

`REINDEX` rebuilds an index with the current comparator, which is the entire repair. It changes no
data, and rebuilding a healthy index is harmless — so the migration
`20260720190000_repair_collation_drift_index_rebuild` sweeps every collation-sensitive btree
rather than naming a list, because each install has its own corrupted set depending on when its
volume was created.

A unique index that **already holds duplicates** cannot be rebuilt — the rebuild fails on the
duplicate. Those are caught per-index, left alone, and named in a `WARNING`. They need dedupe
first, and dedupe needs judgement (see below).

## Do not generalise the dedupe

Deleting a duplicate parent row is not safe by default:

- Nearly every relation is `ON DELETE CASCADE`, and **Postgres fires RI cascade unconditionally** —
  it does not check whether another parent row still supplies the same key. Deleting a duplicate
  therefore destroys children belonging to the survivor.
- `Agent` carries **23 inbound foreign keys**. Nineteen target `Agent.id` (unique per row, so those
  children unambiguously belong to one row); four target `Agent.agentId`, which is *identical*
  across the duplicates, so those children cannot be attributed by key at all.
- `SkillDefinition`'s four inbound keys target the **natural key** (`skillId`), not `id`, so the
  "rename the key to quarantine it" pattern used by the earlier per-table migrations cascades into
  the children.

Concrete volumes at stake on the diagnosed install: 1870 `SkillUsageEvent` and 496
`SkillAssignment` rows.

### Beware NULL keys

`WorkCapsule` looked like it had 47 duplicates. It has none: those rows have NULL keys, and **NULLs
are distinct in a unique index**. A `GROUP BY` collapses them into one apparent group. Check for
NULLs before concluding a table needs dedupe.

## Preventing recurrence

- `docker/postgres/Dockerfile` is **pinned by digest**. A floating `:pg16` tag is what let libc move
  under an existing volume. Re-pin only alongside a REINDEX plan, and run the guard against an
  upgraded volume before shipping a new digest to the fleet.
- `packages/db/scripts/index-integrity-guard.mjs` detects both the corruption and the collation
  fingerprint. The musl fingerprint and a NULL `datcollversion` are reported as **advisory**: they
  describe how the cluster was built, cannot be cleared by any repair, and failing on them would
  hold CI red permanently. A recorded-vs-actual collation version mismatch **does** fail — that one
  is a real regression and means indexes are stale.

## Related

- BI-8CCF7F13 — root cause, sweep, and remaining per-table dedupe
- BI-A35347E4 / BI-4796D52B — the pgvector base-image change that flipped the comparator
- EP-4A12A7CB — Master Data Management; the durable answer for *reliable* duplicate handling is the
  MDM match/merge/survivorship substrate rather than another bespoke dedupe migration
