# Human-principal failed-migration recovery

Backlog coverage: `BI-2BD99239` · Work capsule: `WC-D6CE3874`

## Runtime evidence

The first canonical upgrade attempt failed the immutable migration
`20260812110000_backfill_missing_human_principals` with PostgreSQL SQLSTATE
`23505` on `PrincipalAlias_aliasType_aliasValue_issuer_key`. The corrective
preparation migration subsequently merged, but Prisma correctly retained the
original zero-step failed row and blocked every later migration. Canonical run
`SUR-BADF2B34` then built both images successfully and stopped before migration
deployment because the promoter only allowed recovery of the older inventory
snapshot migration.

## Delivery plan

1. Reproduce the missing allowlist path with DB policy and promoter contract
   tests before implementation.
2. Extract the common read-only unresolved-ledger inspection and exact
   post-resolution verification into one shared helper.
3. Add a migration-specific, fail-closed policy that authorizes only the exact
   human-principal migration checksum, zero applied steps, SQLSTATE `23505`,
   alias constraint, UUID row identity, and exact corrective migration bytes.
4. Run that policy before the existing inventory recovery and normal
   `prisma migrate deploy`; resolve only the returned row, then verify that row
   is rolled back and no unresolved migration remains.
5. Verify unit, PostgreSQL, shell contract, and functional promoter behavior;
   then complete semantic review, exact local CI, protected merge, canonical
   self-upgrade, and the deferred Restaurant seating acceptance.

## Safety and data impact

This change adds no schema migration and does not edit application data. It may
change one `_prisma_migrations` ledger row only after the candidate proves the
full allowlisted failure tuple. Every mismatch fails before the portal swap and
before normal migration deployment. The already-merged forward preparation
migration remains the sole repair of business identity data.

Documentation impact is limited to this recovery plan and inline promoter
contract comments; no user-facing or coworker-facing workflow changes.
