-- BI-916216E7 (EP-OUTCOME-HIERARCHY, WWMD DI-5C99BCBB0AF4): the instance's
-- direction. A vision beside the existing mission, the top-level outcomes the
-- owner writes, and an append-only revision per save. Spec:
-- docs/superpowers/specs/2026-10-28-instance-direction-design.md.
-- All additive; fields start empty and nothing is backfilled (the owner writes
-- them, never a migration).
ALTER TABLE "BusinessContext" ADD COLUMN "vision" TEXT;

-- id is the semantic IO-XXXXXXXX id minted in app code; Epic.servesInstanceOutcomeId
-- (BI-7CD178F8, a later migration) references it.
CREATE TABLE "InstanceOutcome" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "measure" TEXT,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceOutcome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstanceOutcome_organizationId_lifecycle_idx" ON "InstanceOutcome"("organizationId", "lifecycle");

ALTER TABLE "InstanceOutcome" ADD CONSTRAINT "InstanceOutcome_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InstanceDirectionRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mission" TEXT,
    "vision" TEXT,
    "outcomes" JSONB NOT NULL,
    "changedByUserId" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceDirectionRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstanceDirectionRevision_organizationId_version_key"
  ON "InstanceDirectionRevision"("organizationId", "version");
CREATE INDEX "InstanceDirectionRevision_organizationId_idx" ON "InstanceDirectionRevision"("organizationId");
CREATE INDEX "InstanceDirectionRevision_changedByUserId_idx" ON "InstanceDirectionRevision"("changedByUserId");

ALTER TABLE "InstanceDirectionRevision" ADD CONSTRAINT "InstanceDirectionRevision_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstanceDirectionRevision" ADD CONSTRAINT "InstanceDirectionRevision_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InstanceDirectionRevision" ADD CONSTRAINT "InstanceDirectionRevision_source_closed_set"
  CHECK ("source" IN ('settings', 'setup'));
