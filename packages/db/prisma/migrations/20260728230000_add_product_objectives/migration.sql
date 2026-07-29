-- EP-ED496EB0 Phase 9 / BI-162FBDCC
-- @migration-safety: expand-first: this migration creates three new tables
-- only. It does not classify, backfill, rewrite, tighten, or delete existing
-- Product, BacklogItem, Organization, Principal, or DigitalProduct data.
-- @migration-safety: data-safe: every PRIMARY KEY, UNIQUE constraint, and
-- FOREIGN KEY below targets a newly empty table. No pre-existing row can
-- violate these constraints; future writes enter through organization-scoped
-- application invariants.

CREATE TABLE "ProductObjective" (
  "id" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "problemStatement" TEXT,
  "outcomeHypothesis" TEXT NOT NULL,
  "ownerPrincipalId" TEXT,
  "measureKind" TEXT NOT NULL,
  "measureDefinition" TEXT NOT NULL,
  "measureUnit" TEXT,
  "baselineValue" DECIMAL(20,6),
  "targetValue" DECIMAL(20,6),
  "baselineNarrative" TEXT,
  "targetNarrative" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "reviewCadence" TEXT,
  "reviewAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductObjective_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductObjectiveWork" (
  "id" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "backlogItemId" TEXT NOT NULL,
  "contributionKind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductObjectiveWork_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductOutcomeObservation" (
  "id" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "numericValue" DECIMAL(20,6),
  "narrative" TEXT,
  "measureKind" TEXT NOT NULL,
  "measureUnit" TEXT,
  "sourceKind" TEXT NOT NULL,
  "sourceRef" TEXT,
  "confidence" DOUBLE PRECISION,
  "provenance" JSONB,
  "recordedByPrincipalId" TEXT,
  "supersedesObservationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductOutcomeObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductObjective_objectiveId_key"
  ON "ProductObjective"("objectiveId");
CREATE UNIQUE INDEX "ProductObjective_id_organizationId_key"
  ON "ProductObjective"("id", "organizationId");
CREATE INDEX "ProductObjective_organizationId_status_reviewAt_idx"
  ON "ProductObjective"("organizationId", "status", "reviewAt");
CREATE INDEX "ProductObjective_productId_status_idx"
  ON "ProductObjective"("productId", "status");
CREATE INDEX "ProductObjective_ownerPrincipalId_idx"
  ON "ProductObjective"("ownerPrincipalId");

CREATE UNIQUE INDEX "ProductObjectiveWork_objectiveId_backlogItemId_key"
  ON "ProductObjectiveWork"("objectiveId", "backlogItemId");
CREATE INDEX "ProductObjectiveWork_backlogItemId_idx"
  ON "ProductObjectiveWork"("backlogItemId");
CREATE INDEX "ProductObjectiveWork_contributionKind_idx"
  ON "ProductObjectiveWork"("contributionKind");

CREATE UNIQUE INDEX "ProductOutcomeObservation_observationId_key"
  ON "ProductOutcomeObservation"("observationId");
CREATE UNIQUE INDEX "ProductOutcomeObservation_supersedesObservationId_key"
  ON "ProductOutcomeObservation"("supersedesObservationId");
CREATE INDEX "ProductOutcomeObservation_objectiveId_observedAt_idx"
  ON "ProductOutcomeObservation"("objectiveId", "observedAt");
CREATE INDEX "ProductOutcomeObservation_sourceKind_sourceRef_idx"
  ON "ProductOutcomeObservation"("sourceKind", "sourceRef");
CREATE INDEX "ProductOutcomeObservation_recordedByPrincipalId_idx"
  ON "ProductOutcomeObservation"("recordedByPrincipalId");

ALTER TABLE "ProductObjective"
  ADD CONSTRAINT "ProductObjective_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductObjective"
  ADD CONSTRAINT "ProductObjective_productId_organizationId_fkey"
  FOREIGN KEY ("productId", "organizationId")
  REFERENCES "Product"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductObjective"
  ADD CONSTRAINT "ProductObjective_ownerPrincipalId_fkey"
  FOREIGN KEY ("ownerPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductObjectiveWork"
  ADD CONSTRAINT "ProductObjectiveWork_objectiveId_fkey"
  FOREIGN KEY ("objectiveId") REFERENCES "ProductObjective"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductObjectiveWork"
  ADD CONSTRAINT "ProductObjectiveWork_backlogItemId_fkey"
  FOREIGN KEY ("backlogItemId") REFERENCES "BacklogItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductOutcomeObservation"
  ADD CONSTRAINT "ProductOutcomeObservation_objectiveId_fkey"
  FOREIGN KEY ("objectiveId") REFERENCES "ProductObjective"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOutcomeObservation"
  ADD CONSTRAINT "ProductOutcomeObservation_recordedByPrincipalId_fkey"
  FOREIGN KEY ("recordedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductOutcomeObservation"
  ADD CONSTRAINT "ProductOutcomeObservation_supersedesObservationId_fkey"
  FOREIGN KEY ("supersedesObservationId")
  REFERENCES "ProductOutcomeObservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
