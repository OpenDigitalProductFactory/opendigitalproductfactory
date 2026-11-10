# Workroom activity migration recovery

The populated-install failure in `20261014012000_workroom_activity_ingestion_hardening`
is tracked with BI-BF20F828. The first PostgreSQL error is
`initiative governance activities are append-only`: assigning ingestion positions
to retained `work-intent-declared` activities hits their existing mutation guard.
The explicit migration transaction rolls back. Prisma can then fail to persist
its error log in that aborted transaction, leaving an unfinished zero-step ledger
row with no log. A zero-step row alone does not prove safe recovery.

`20261014011900_prepare_workroom_activity_ingestion` prepares populated installs
without changing the published migration. Under exclusive parent/activity locks,
it permits only a protected activity's NULL-to-assigned ingestion position while
all other fields remain identical. It preserves assigned positions and keeps
overflow rooms unsequenced. The original refusal function is restored before
commit; an interrupted transaction restores both data and guards by rollback.
Already-hardened installs keep their existing positions and functions.

The canonical promoter runs `recover-workroom-activity-migration.mjs` before the
older migration recovery checks. It binds the single unfinished row to the exact
published checksum and candidate preparation bytes, checks the unchanged
predecessor schema and absence of competing transactions, and replays the original
SQL inside a savepoint that is always rolled back. Only the exact append-only
failure with unchanged history can authorize Prisma's normal rolled-back
resolution. The promoter verifies the same row and clear unresolved history
before normal migration deployment. It never marks the failed migration applied.
Unrelated, mixed, changed, partially applied or ambiguous failures remain blocked.

## Verification

The PostgreSQL regression fixture uses an explicit
`DPF_INGESTION_TEST_DATABASE_URL` and generated isolated schemas; it never falls
back to the install database. It checks the original failure, preserved semantic
fields, existing positions, integer overflow, both shared guard attachments,
interruption, competing writers, already-applied histories, and the recovery
probe's unchanged ledger. The package CI job runs it against its PostgreSQL
service alongside the pure classifier tests. Promoter tests cover recovery order
and failures of classification, resolution and verification.

During the October 15, 2026 emergency repair, the operator explicitly authorized
process-gate bypass to restore upgrades. Shared local-CI admission remained queued
with no admitted lease, and releasing the unused reservation required employee
approval. Independent source verification used a separate disposable PostgreSQL
container with bounded resources. This evidence does not claim a shared local-CI
pass or a successful live upgrade. Live restoration is established only by a
successful canonical upgrade and matching served image identity.
