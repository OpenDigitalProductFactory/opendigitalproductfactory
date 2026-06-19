-- De-conflict the single shared nonprod instance: enforce "at most one ACTIVE
-- lease per environmentKey" at the database level. `activeKey` mirrors
-- environmentKey while the lease is active and is NULL once released/expired;
-- a UNIQUE index on it lets Postgres reject a second active claim atomically
-- (multiple NULLs are allowed for history rows), closing the claim TOCTOU race
-- where two sessions could both win :3001 / active-candidate.

-- AlterTable
ALTER TABLE "NonProductionEnvironmentLease" ADD COLUMN "activeKey" TEXT;

-- Backfill (inline per AGENTS.md): collapse any pre-existing duplicate active
-- leases (keep the most recent per environmentKey) so the unique index can be
-- built, then stamp activeKey on the surviving active rows.
UPDATE "NonProductionEnvironmentLease"
SET "status" = 'expired', "releasedAt" = now()
WHERE "status" = 'active'
  AND "id" NOT IN (
    SELECT DISTINCT ON ("environmentKey") "id"
    FROM "NonProductionEnvironmentLease"
    WHERE "status" = 'active'
    ORDER BY "environmentKey", "createdAt" DESC
  );

UPDATE "NonProductionEnvironmentLease"
SET "activeKey" = "environmentKey"
WHERE "status" = 'active';

-- CreateIndex
CREATE UNIQUE INDEX "NonProductionEnvironmentLease_activeKey_key" ON "NonProductionEnvironmentLease"("activeKey");
