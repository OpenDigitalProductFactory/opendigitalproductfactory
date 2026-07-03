-- Phase 4 (regulation version lineage). `version` increments per governed
-- iteration; `previousVersionId` links a new version to the one it supersedes,
-- so iterating a regulation is an immutable new version rather than a silent
-- in-place mutation. `version` defaults to 1 (safe for existing rows).
ALTER TABLE "Regulation" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Regulation" ADD COLUMN "previousVersionId" TEXT;
CREATE INDEX "Regulation_previousVersionId_idx" ON "Regulation" ("previousVersionId");
-- @migration-safety: data-safe: previousVersionId is added NULL in this same migration, so every existing row is NULL and no row can violate the self-referential FK.
ALTER TABLE "Regulation"
  ADD CONSTRAINT "Regulation_previousVersionId_fkey"
  FOREIGN KEY ("previousVersionId") REFERENCES "Regulation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
