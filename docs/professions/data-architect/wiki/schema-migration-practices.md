---
title: Schema Migration Practices
pageKind: entity
status: published
abstract: A schema migration is a versioned, ordered change to a database's structure applied as code. Safe migrations are backward-compatible, reversible where possible, and decoupled from the deploy so that old and new application versions can run against the same database during a rollout.
sources:
  - postgresql/data-definition
---

## Definition

A **schema migration** is a change to the structure of a database — adding a table or column, altering a type, adding a constraint or index — captured as an ordered, versioned unit of code and applied deterministically to every environment. Migrations are how a data model *evolves* after it is in production, where the schema can no longer simply be recreated because it holds live data that must be preserved. In PostgreSQL the mechanism is `ALTER TABLE` (and `CREATE`/`DROP`) run inside a migration transaction; the discipline is in *how* those statements are sequenced and released.

## Migrations Are Code

- **Versioned and ordered** — each migration has a monotonic identifier; the tool applies pending migrations in order and records which have run. The schema state is a pure function of the migration history, so every environment converges to the same structure.
- **Forward-only history, additive by default** — a migration that has been applied to a shared environment is never edited in place; a correction is a new migration. History is append-only for the same reason a ledger is.
- **Reviewed like any change** — a migration is a diff that a reviewer reads, because a bad `ALTER` can lock a table or drop data. Migrations belong in the same PR as the code that depends on them.

## The Expand / Contract Pattern

The central practice for **zero-downtime** migration is to never make a single breaking change. Instead, split every incompatible change into backward-compatible steps so that the old and new application versions can both run against the database during the rollout window:

1. **Expand** — add the new structure without removing the old. Add the new nullable column / new table / new index; deploy it *before* the code that needs it.
2. **Migrate + dual-write** — backfill existing rows and have the application write to both old and new shapes while both code versions are live.
3. **Contract** — once every running instance uses only the new shape, drop the old column/table in a later migration.

Renaming a column, for example, is never a single `RENAME`: it is *add new column → backfill → write both → switch reads → drop old column*, spread across releases. The migration is decoupled from the deploy precisely so that a rollback of the application code does not require a rollback of the schema.

## Safety Practices on PostgreSQL

- **Prefer non-blocking operations.** Adding a column with no volatile default is fast; adding a `NOT NULL` or a new `CHECK`/foreign-key constraint validates every existing row and can take a long lock. Add the constraint as `NOT VALID` first, then `VALIDATE CONSTRAINT` in a separate step to avoid holding a heavy lock.
- **Build indexes concurrently.** `CREATE INDEX CONCURRENTLY` avoids locking writes on a large table (at the cost of running outside a transaction).
- **Keep the lock window short.** `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock; set a `lock_timeout` so a migration fails fast rather than queueing behind — and blocking — production traffic.
- **Backfill in batches.** Update large tables in bounded chunks rather than one transaction that bloats WAL and holds locks.
- **Test on production-like data.** A migration that is instant on an empty test database can lock a table for minutes on a table with a hundred million rows; measure against representative volume.

## Reversibility

Every migration should have a defined **down** path, or an explicit note that it is irreversible (a `DROP COLUMN` destroys data — its true reverse is *restore from backup*, not a `down` script). Additive expand-phase migrations are trivially reversible; destructive contract-phase migrations are the ones that must be gated behind confirmation that nothing still depends on the old shape.

## Why It Matters

Schema migration is where data modelling meets operational risk. A well-run migration practice lets a data model change continuously without outages, data loss, or a frozen release train; a careless one turns a one-line `ALTER` into a production incident. For the Data Architect coworker, proposing a migration means proposing the *sequence* — expand, backfill, contract — and the lock-safety plan, not just the final schema.

## See Also

- [[professions/data-architect/data-modelling-concepts]]
- [[professions/data-architect/normalisation-and-denormalisation]]
- [[professions/data-architect/data-governance-principles]]
