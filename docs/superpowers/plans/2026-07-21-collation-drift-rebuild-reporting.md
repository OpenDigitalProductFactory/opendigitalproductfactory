# Collation-drift rebuild: report per-index failures, never wedge the chain

Status: migration written, pending live verification
Related: BI-9A00FBC4 (unattended remediation), BI-BE8BBDE9 (unreachable-fix trap),
BI-8C44DB49 (fail-fast dispatch)

## Who is exposed, and why one install upgrades while another does not

Not the operating system. **pgdata lineage.**

```sql
SELECT datcollversion, pg_database_collation_actual_version(oid)
FROM pg_database WHERE datname = 'dpf';
-- drifted install: stored NULL, actual '2.36'
```

A NULL *stored* collation version means `initdb` ran under a libc that reports
none — musl, i.e. the old Alpine postgres image, which ships no locale data, so
every text column sorted with C semantics regardless of the `en_US.utf8` label.
The volume is now served by the Debian/glibc pgvector base
(BI-A35347E4 / BI-4796D52B), and glibc *does* implement `en_US.utf8`. The text
comparator changed underneath an existing volume.

Verified on the affected install: `stored=(none)`, `actual=2.36`.

This is why a Mac install upgrades cleanly while a Windows one is wedged: the Mac
volume was created after the base-image move, so its collation version matches,
no index is corrupt, and the rebuild is a trivial no-op. **An older install on
any OS is equally exposed.** Not a timing issue, not OS-specific — an install-age
issue that merely correlates with which machine was set up when.

Measured consequence on the drifted install: **18 duplicate `Agent.agentId`**
values behind a UNIQUE index that can no longer reject them. An upsert's index
probe descends the wrong subtree, misses the existing row, and falls through to
INSERT. Invisible to an index scan; only `enable_indexscan=off` shows them.

## The defect being fixed

`20260720190000_repair_collation_drift_index_rebuild` is the right repair with a
fatal error-handling flaw:

```sql
EXCEPTION
  WHEN unique_violation THEN blocked := blocked || ...;   -- reported, loop continues
  WHEN others THEN RAISE EXCEPTION '...';                 -- aborts EVERYTHING
```

One index failing for any non-duplicate reason aborts the surrounding
transaction. Postgres then rejects every later statement with *"current
transaction is aborted"*, and that is the error Prisma surfaces — from the
trailing `COMMIT`. **The RAISE's own message, naming the index and the real
SQLSTATE, is never seen.**

Consequence: `finished_at` stayed NULL, P3009 blocked every subsequent
self-upgrade for three days (SUR-13E5FB0C → SUR-A0681976), and the actual cause
was invisible the whole time. The migration's own header says it "must not wedge
the forward-only chain for the whole fleet" — the handler defeated that intent.

## The fix

`20260721180000_repair_collation_drift_index_rebuild_reporting`. Migrations are
immutable, so a new migration rather than an edit. Same data-driven index
selection, same rebuild-only scope. The difference is the failure policy: every
per-index failure — duplicate-blocked *or* unexpected — is caught, recorded, and
reported by name with its SQLSTATE, and **nothing re-raises**.

A duplicate-blocked unique index is an expected outcome whose data needs a dedupe
migration; it must not stop the other ~1000 indexes from being repaired. An
unexpected error is equally not a reason to wedge the fleet — it is a reason to
name the index and the error and let the rest of the repair land.

## Known limit — the unreachable-fix trap, again

An install **already** wedged in P3009 by the original migration cannot receive
this fix through the normal chain: P3009 blocks the very migrate step that would
apply it. Those installs need a one-time manual `prisma migrate resolve` first —
and note the running portal may predate the migration, in which case `resolve`
returns P3017 and must be run from the newer image.

Same shape as BI-BE8BBDE9 (a pre-#3282 portal could not self-upgrade INTO the
#3282 fix). It is exactly the class BI-9A00FBC4 exists to address: an unattended
remote install has nobody to run the resolve.

## Verification — executed against the live drifted install

The migration file itself was applied to the affected database and **committed**:

```
NOTICE:  collation-drift rebuild: 2201 index(es) rebuilt
WARNING: 2 index(es) still hold duplicate rows and were NOT rebuilt:
         InventoryEntity_entityKey_key, PlatformIssueReport_dedupeKey_open_key
WARNING: 3 index(es) failed for an UNEXPECTED reason and were NOT rebuilt:
         VoiceProfile_pkey | VoiceProfile_profileId_key | VoiceProfile_status_idx
         [40P01 after 3 attempts: deadlock detected]
COMMIT
```

**The load-bearing result is the `COMMIT`.** Five problem indexes, and the chain
advanced anyway. The original aborted the entire transaction on the first of
them and wedged every upgrade for three days.

The three `VoiceProfile` indexes rebuilt cleanly on a later direct retry, once
the upgrade's concurrent writes had stopped — confirming the deadlock was
transient lock contention with the TTS sidecar (`dpf-dpf-tts-1`), exactly what
the bounded retry assumes. Final state: **2,204 of 2,206 collatable indexes
rebuilt.**

Supporting evidence on the same install:
- `Agent.agentId` duplicates went 18 → 0 after the paired dedupe migration
  (`20260720193000`) applied during the same upgrade.
- 429 migrations applied, 0 unresolved.

## Remaining — needs a dedupe migration, not this one

Two unique indexes still hold one duplicated key each and cannot be rebuilt until
the data is resolved:

| Index | Duplicated key |
|---|---|
| `PlatformIssueReport_dedupeKey_open_key` | `log-sig:sandbox:869e23847e` (2 rows, both `triaged_local`, 2026-06-15 and 2026-07-15) |
| `InventoryEntity_entityKey_key` | `network_interface:iface:Ethernet_2:192.168.0.200` |

Until each is deduped, that UNIQUE constraint cannot reject new duplicates.

Follow the `20260720193000` pattern rather than deleting: **every conflicting row
is retained under a collision-checked reserved key**, with natural-key foreign
keys detached before loser keys move so `ON UPDATE CASCADE` cannot steal
references from the canonical survivor. That keeps the repair non-destructive,
which is the standing rule for anything an unattended upgrade may execute
(BI-9A00FBC4).
