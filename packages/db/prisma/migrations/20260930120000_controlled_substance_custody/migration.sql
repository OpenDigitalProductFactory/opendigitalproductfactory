-- EP-CSC-CUSTODY / BI-CSC-001: shared controlled-substance custody substrate.
-- Spec: docs/superpowers/specs/2026-09-30-controlled-substance-custody-design.md
-- @migration-safety: data-safe: creates new enums, tables, constraints, triggers and RLS policies only; no existing rows, columns or constraints are changed.
-- CreateEnum
CREATE TYPE "ControlledSubstanceSchedule" AS ENUM ('c_i', 'c_ii', 'c_ii_n', 'c_iii', 'c_iii_n', 'c_iv', 'c_v');

-- CreateEnum
CREATE TYPE "ControlledSubstanceUnit" AS ENUM ('tablet', 'capsule', 'milliliter', 'milligram', 'gram', 'patch', 'each');

-- CreateEnum
CREATE TYPE "ControlledSubstanceHandlerScope" AS ENUM ('receive', 'administer', 'dispense', 'waste', 'witness', 'transfer', 'destroy', 'count', 'reconcile');

-- CreateEnum
CREATE TYPE "ControlledSubstanceMovementKind" AS ENUM ('receipt', 'administration', 'dispense', 'waste', 'return_to_supplier', 'transfer_out', 'transfer_in', 'destruction', 'loss_theft', 'count_adjustment', 'reversal');

-- CreateEnum
CREATE TYPE "ControlledSubstanceCountKind" AS ENUM ('initial', 'biennial', 'state_annual', 'periodic', 'shift_change', 'discrepancy_recount', 'newly_controlled');

-- CreateEnum
CREATE TYPE "ControlledSubstanceCountTiming" AS ENUM ('opening_of_business', 'close_of_business');

-- CreateEnum
CREATE TYPE "ControlledSubstanceCountMethod" AS ENUM ('exact', 'estimated');

-- CreateEnum
CREATE TYPE "ControlledSubstanceDiscrepancyClass" AS ENUM ('unclassified', 'recording_error', 'breakage_or_spill', 'unexplained_variance', 'suspected_theft', 'significant_loss');

-- CreateEnum
CREATE TYPE "ControlledSubstanceDiscrepancyStatus" AS ENUM ('detected', 'contained', 'investigating', 'adjustment_approved', 'escalated', 'reconciled', 'closed');

-- CreateTable
CREATE TABLE "ControlledSubstanceProduct" (
    "id" TEXT NOT NULL,
    "productRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeIngredient" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "dosageForm" TEXT NOT NULL,
    "schedule" "ControlledSubstanceSchedule" NOT NULL,
    "ndcCode" TEXT,
    "baseUnit" "ControlledSubstanceUnit" NOT NULL,
    "containerUnits" DECIMAL(18,4),
    "wasteWitnessRequired" BOOLEAN NOT NULL DEFAULT true,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledSubstanceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledSubstanceRegister" (
    "id" TEXT NOT NULL,
    "registerRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationLicenseRecordId" TEXT,
    "personLicenseRecordId" TEXT,
    "careLocationId" TEXT,
    "storageLabel" TEXT NOT NULL,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledSubstanceRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledSubstanceHandlerAuthorization" (
    "id" TEXT NOT NULL,
    "authorizationRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "scope" "ControlledSubstanceHandlerScope" NOT NULL,
    "grantedByPrincipalId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "revokedByPrincipalId" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledSubstanceHandlerAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledSubstanceMovement" (
    "id" TEXT NOT NULL,
    "movementRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "ControlledSubstanceMovementKind" NOT NULL,
    "quantityDelta" DECIMAL(18,4) NOT NULL,
    "balanceBefore" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "lotNumber" TEXT,
    "lotExpiresAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorPrincipalId" TEXT NOT NULL,
    "witnessPrincipalId" TEXT,
    "patientProfileId" TEXT,
    "animalProfileId" TEXT,
    "counterpartyName" TEXT,
    "counterpartyRegistration" TEXT,
    "documentRef" TEXT,
    "reason" TEXT,
    "reversesMovementId" TEXT,
    "countId" TEXT,
    "discrepancyId" TEXT,
    "previousHash" TEXT,
    "entryHash" TEXT NOT NULL,

    CONSTRAINT "ControlledSubstanceMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledSubstanceCount" (
    "id" TEXT NOT NULL,
    "countRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "kind" "ControlledSubstanceCountKind" NOT NULL,
    "timing" "ControlledSubstanceCountTiming" NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "takenByPrincipalId" TEXT NOT NULL,
    "witnessPrincipalId" TEXT,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlledSubstanceCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledSubstanceCountLine" (
    "id" TEXT NOT NULL,
    "countLineRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQuantity" DECIMAL(18,4) NOT NULL,
    "countedQuantity" DECIMAL(18,4) NOT NULL,
    "varianceQuantity" DECIMAL(18,4) NOT NULL,
    "method" "ControlledSubstanceCountMethod" NOT NULL,
    "openedContainer" BOOLEAN NOT NULL DEFAULT false,
    "containerUnits" DECIMAL(18,4),

    CONSTRAINT "ControlledSubstanceCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledSubstanceDiscrepancy" (
    "id" TEXT NOT NULL,
    "discrepancyRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "countLineId" TEXT,
    "varianceQuantity" DECIMAL(18,4) NOT NULL,
    "classification" "ControlledSubstanceDiscrepancyClass" NOT NULL DEFAULT 'unclassified',
    "classificationRationale" TEXT,
    "status" "ControlledSubstanceDiscrepancyStatus" NOT NULL DEFAULT 'detected',
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "openedByPrincipalId" TEXT NOT NULL,
    "significanceFactors" JSONB,
    "regulatorNoticeDueAt" TIMESTAMP(3),
    "regulatorNoticeGivenAt" TIMESTAMP(3),
    "regulatorNoticeRef" TEXT,
    "lossReportDueAt" TIMESTAMP(3),
    "lossReportFiledAt" TIMESTAMP(3),
    "lossReportRef" TEXT,
    "resolution" TEXT,
    "resolvedByPrincipalId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledSubstanceDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceProduct_productRef_key" ON "ControlledSubstanceProduct"("productRef");

-- CreateIndex
CREATE INDEX "ControlledSubstanceProduct_organizationId_schedule_idx" ON "ControlledSubstanceProduct"("organizationId", "schedule");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceProduct_organizationId_name_strength_dos_key" ON "ControlledSubstanceProduct"("organizationId", "name", "strength", "dosageForm");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceProduct_id_organizationId_key" ON "ControlledSubstanceProduct"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceRegister_registerRef_key" ON "ControlledSubstanceRegister"("registerRef");

-- CreateIndex
CREATE INDEX "ControlledSubstanceRegister_organizationLicenseRecordId_idx" ON "ControlledSubstanceRegister"("organizationLicenseRecordId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceRegister_personLicenseRecordId_idx" ON "ControlledSubstanceRegister"("personLicenseRecordId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceRegister_careLocationId_organizationId_idx" ON "ControlledSubstanceRegister"("careLocationId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceRegister_organizationId_storageLabel_key" ON "ControlledSubstanceRegister"("organizationId", "storageLabel");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceRegister_id_organizationId_key" ON "ControlledSubstanceRegister"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceHandlerAuthorization_authorizationRef_key" ON "ControlledSubstanceHandlerAuthorization"("authorizationRef");

-- CreateIndex
CREATE INDEX "ControlledSubstanceHandlerAuthorization_registerId_organiza_idx" ON "ControlledSubstanceHandlerAuthorization"("registerId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceHandlerAuthorization_registerId_principa_idx" ON "ControlledSubstanceHandlerAuthorization"("registerId", "principalId", "scope");

-- CreateIndex
CREATE INDEX "ControlledSubstanceHandlerAuthorization_organizationId_idx" ON "ControlledSubstanceHandlerAuthorization"("organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceHandlerAuthorization_principalId_idx" ON "ControlledSubstanceHandlerAuthorization"("principalId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceHandlerAuthorization_grantedByPrincipalI_idx" ON "ControlledSubstanceHandlerAuthorization"("grantedByPrincipalId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceHandlerAuthorization_revokedByPrincipalI_idx" ON "ControlledSubstanceHandlerAuthorization"("revokedByPrincipalId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceMovement_movementRef_key" ON "ControlledSubstanceMovement"("movementRef");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceMovement_reversesMovementId_key" ON "ControlledSubstanceMovement"("reversesMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceMovement_entryHash_key" ON "ControlledSubstanceMovement"("entryHash");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_registerId_organizationId_idx" ON "ControlledSubstanceMovement"("registerId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_organizationId_occurredAt_idx" ON "ControlledSubstanceMovement"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_productId_organizationId_idx" ON "ControlledSubstanceMovement"("productId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_actorPrincipalId_idx" ON "ControlledSubstanceMovement"("actorPrincipalId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_witnessPrincipalId_idx" ON "ControlledSubstanceMovement"("witnessPrincipalId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_patientProfileId_organizationId_idx" ON "ControlledSubstanceMovement"("patientProfileId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_animalProfileId_organizationId_idx" ON "ControlledSubstanceMovement"("animalProfileId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_countId_organizationId_idx" ON "ControlledSubstanceMovement"("countId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceMovement_discrepancyId_organizationId_idx" ON "ControlledSubstanceMovement"("discrepancyId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceMovement_registerId_productId_sequence_key" ON "ControlledSubstanceMovement"("registerId", "productId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceCount_countRef_key" ON "ControlledSubstanceCount"("countRef");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCount_registerId_organizationId_idx" ON "ControlledSubstanceCount"("registerId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCount_registerId_kind_takenAt_idx" ON "ControlledSubstanceCount"("registerId", "kind", "takenAt");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCount_organizationId_idx" ON "ControlledSubstanceCount"("organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCount_takenByPrincipalId_idx" ON "ControlledSubstanceCount"("takenByPrincipalId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCount_witnessPrincipalId_idx" ON "ControlledSubstanceCount"("witnessPrincipalId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceCount_id_organizationId_key" ON "ControlledSubstanceCount"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceCountLine_countLineRef_key" ON "ControlledSubstanceCountLine"("countLineRef");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCountLine_countId_organizationId_idx" ON "ControlledSubstanceCountLine"("countId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCountLine_organizationId_idx" ON "ControlledSubstanceCountLine"("organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceCountLine_productId_organizationId_idx" ON "ControlledSubstanceCountLine"("productId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceCountLine_countId_productId_key" ON "ControlledSubstanceCountLine"("countId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceCountLine_id_organizationId_key" ON "ControlledSubstanceCountLine"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceDiscrepancy_discrepancyRef_key" ON "ControlledSubstanceDiscrepancy"("discrepancyRef");

-- CreateIndex
CREATE INDEX "ControlledSubstanceDiscrepancy_registerId_organizationId_idx" ON "ControlledSubstanceDiscrepancy"("registerId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceDiscrepancy_registerId_status_idx" ON "ControlledSubstanceDiscrepancy"("registerId", "status");

-- CreateIndex
CREATE INDEX "ControlledSubstanceDiscrepancy_organizationId_status_idx" ON "ControlledSubstanceDiscrepancy"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ControlledSubstanceDiscrepancy_productId_organizationId_idx" ON "ControlledSubstanceDiscrepancy"("productId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceDiscrepancy_countLineId_organizationId_idx" ON "ControlledSubstanceDiscrepancy"("countLineId", "organizationId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceDiscrepancy_openedByPrincipalId_idx" ON "ControlledSubstanceDiscrepancy"("openedByPrincipalId");

-- CreateIndex
CREATE INDEX "ControlledSubstanceDiscrepancy_resolvedByPrincipalId_idx" ON "ControlledSubstanceDiscrepancy"("resolvedByPrincipalId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSubstanceDiscrepancy_id_organizationId_key" ON "ControlledSubstanceDiscrepancy"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "ControlledSubstanceProduct" ADD CONSTRAINT "ControlledSubstanceProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceRegister" ADD CONSTRAINT "ControlledSubstanceRegister_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceRegister" ADD CONSTRAINT "ControlledSubstanceRegister_organizationLicenseRecordId_fkey" FOREIGN KEY ("organizationLicenseRecordId") REFERENCES "OrganizationLicenseRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceRegister" ADD CONSTRAINT "ControlledSubstanceRegister_personLicenseRecordId_fkey" FOREIGN KEY ("personLicenseRecordId") REFERENCES "PersonLicenseRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceRegister" ADD CONSTRAINT "ControlledSubstanceRegister_careLocationId_organizationId_fkey" FOREIGN KEY ("careLocationId", "organizationId") REFERENCES "CareLocation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceHandlerAuthorization" ADD CONSTRAINT "ControlledSubstanceHandlerAuthorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceHandlerAuthorization" ADD CONSTRAINT "ControlledSubstanceHandlerAuthorization_registerId_organiz_fkey" FOREIGN KEY ("registerId", "organizationId") REFERENCES "ControlledSubstanceRegister"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceHandlerAuthorization" ADD CONSTRAINT "ControlledSubstanceHandlerAuthorization_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceHandlerAuthorization" ADD CONSTRAINT "ControlledSubstanceHandlerAuthorization_grantedByPrincipal_fkey" FOREIGN KEY ("grantedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceHandlerAuthorization" ADD CONSTRAINT "ControlledSubstanceHandlerAuthorization_revokedByPrincipal_fkey" FOREIGN KEY ("revokedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_registerId_organizationId_fkey" FOREIGN KEY ("registerId", "organizationId") REFERENCES "ControlledSubstanceRegister"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "ControlledSubstanceProduct"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_actorPrincipalId_fkey" FOREIGN KEY ("actorPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_witnessPrincipalId_fkey" FOREIGN KEY ("witnessPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_patientProfileId_organizationI_fkey" FOREIGN KEY ("patientProfileId", "organizationId") REFERENCES "PatientProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_animalProfileId_organizationId_fkey" FOREIGN KEY ("animalProfileId", "organizationId") REFERENCES "AnimalProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_reversesMovementId_fkey" FOREIGN KEY ("reversesMovementId") REFERENCES "ControlledSubstanceMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_countId_organizationId_fkey" FOREIGN KEY ("countId", "organizationId") REFERENCES "ControlledSubstanceCount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceMovement" ADD CONSTRAINT "ControlledSubstanceMovement_discrepancyId_organizationId_fkey" FOREIGN KEY ("discrepancyId", "organizationId") REFERENCES "ControlledSubstanceDiscrepancy"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceCount" ADD CONSTRAINT "ControlledSubstanceCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceCount" ADD CONSTRAINT "ControlledSubstanceCount_registerId_organizationId_fkey" FOREIGN KEY ("registerId", "organizationId") REFERENCES "ControlledSubstanceRegister"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceCount" ADD CONSTRAINT "ControlledSubstanceCount_takenByPrincipalId_fkey" FOREIGN KEY ("takenByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceCount" ADD CONSTRAINT "ControlledSubstanceCount_witnessPrincipalId_fkey" FOREIGN KEY ("witnessPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceCountLine" ADD CONSTRAINT "ControlledSubstanceCountLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceCountLine" ADD CONSTRAINT "ControlledSubstanceCountLine_countId_organizationId_fkey" FOREIGN KEY ("countId", "organizationId") REFERENCES "ControlledSubstanceCount"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceCountLine" ADD CONSTRAINT "ControlledSubstanceCountLine_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "ControlledSubstanceProduct"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceDiscrepancy" ADD CONSTRAINT "ControlledSubstanceDiscrepancy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceDiscrepancy" ADD CONSTRAINT "ControlledSubstanceDiscrepancy_registerId_organizationId_fkey" FOREIGN KEY ("registerId", "organizationId") REFERENCES "ControlledSubstanceRegister"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceDiscrepancy" ADD CONSTRAINT "ControlledSubstanceDiscrepancy_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "ControlledSubstanceProduct"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceDiscrepancy" ADD CONSTRAINT "ControlledSubstanceDiscrepancy_countLineId_organizationId_fkey" FOREIGN KEY ("countLineId", "organizationId") REFERENCES "ControlledSubstanceCountLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceDiscrepancy" ADD CONSTRAINT "ControlledSubstanceDiscrepancy_openedByPrincipalId_fkey" FOREIGN KEY ("openedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledSubstanceDiscrepancy" ADD CONSTRAINT "ControlledSubstanceDiscrepancy_resolvedByPrincipalId_fkey" FOREIGN KEY ("resolvedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Shape constraints ──────────────────────────────────────────────────────

-- A register is bound to exactly one registration: institutional or practitioner.
ALTER TABLE "ControlledSubstanceRegister"
  ADD CONSTRAINT "ControlledSubstanceRegister_exactly_one_registrant"
  CHECK (num_nonnulls("organizationLicenseRecordId", "personLicenseRecordId") = 1);

-- A movement names at most one patient subject (human/vet PatientProfile or shelter AnimalProfile).
ALTER TABLE "ControlledSubstanceMovement"
  ADD CONSTRAINT "ControlledSubstanceMovement_at_most_one_subject"
  CHECK (num_nonnulls("patientProfileId", "animalProfileId") <= 1);

-- The running balance is arithmetic, never asserted: after = before + delta, never negative.
ALTER TABLE "ControlledSubstanceMovement"
  ADD CONSTRAINT "ControlledSubstanceMovement_balance_arithmetic"
  CHECK ("balanceAfter" = "balanceBefore" + "quantityDelta" AND "balanceAfter" >= 0 AND "quantityDelta" <> 0);

ALTER TABLE "ControlledSubstanceMovement"
  ADD CONSTRAINT "ControlledSubstanceMovement_sequence_positive"
  CHECK ("sequence" >= 1);

-- A witness is a second person.
ALTER TABLE "ControlledSubstanceMovement"
  ADD CONSTRAINT "ControlledSubstanceMovement_witness_not_actor"
  CHECK ("witnessPrincipalId" IS NULL OR "witnessPrincipalId" <> "actorPrincipalId");

ALTER TABLE "ControlledSubstanceCount"
  ADD CONSTRAINT "ControlledSubstanceCount_witness_not_taker"
  CHECK ("witnessPrincipalId" IS NULL OR "witnessPrincipalId" <> "takenByPrincipalId");

ALTER TABLE "ControlledSubstanceCountLine"
  ADD CONSTRAINT "ControlledSubstanceCountLine_variance_arithmetic"
  CHECK ("varianceQuantity" = "countedQuantity" - "expectedQuantity" AND "countedQuantity" >= 0);

ALTER TABLE "ControlledSubstanceHandlerAuthorization"
  ADD CONSTRAINT "ControlledSubstanceHandlerAuthorization_window"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- ─── Append-only history (AC-CSC-001) ───────────────────────────────────────

CREATE OR REPLACE FUNCTION refuse_controlled_substance_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; correct it with a reversal, never an edit', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS controlled_substance_movement_append_only ON "ControlledSubstanceMovement";
CREATE TRIGGER controlled_substance_movement_append_only
  BEFORE UPDATE OR DELETE ON "ControlledSubstanceMovement"
  FOR EACH ROW EXECUTE FUNCTION refuse_controlled_substance_history_mutation();

DROP TRIGGER IF EXISTS controlled_substance_count_append_only ON "ControlledSubstanceCount";
CREATE TRIGGER controlled_substance_count_append_only
  BEFORE UPDATE OR DELETE ON "ControlledSubstanceCount"
  FOR EACH ROW EXECUTE FUNCTION refuse_controlled_substance_history_mutation();

DROP TRIGGER IF EXISTS controlled_substance_count_line_append_only ON "ControlledSubstanceCountLine";
CREATE TRIGGER controlled_substance_count_line_append_only
  BEFORE UPDATE OR DELETE ON "ControlledSubstanceCountLine"
  FOR EACH ROW EXECUTE FUNCTION refuse_controlled_substance_history_mutation();

-- Retained evidence is never deleted; discrepancy cases and handler grants change state only.
CREATE OR REPLACE FUNCTION refuse_controlled_substance_record_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is retained controlled-substance evidence and cannot be deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS controlled_substance_discrepancy_no_delete ON "ControlledSubstanceDiscrepancy";
CREATE TRIGGER controlled_substance_discrepancy_no_delete
  BEFORE DELETE ON "ControlledSubstanceDiscrepancy"
  FOR EACH ROW EXECUTE FUNCTION refuse_controlled_substance_record_delete();

DROP TRIGGER IF EXISTS controlled_substance_handler_authorization_no_delete ON "ControlledSubstanceHandlerAuthorization";
CREATE TRIGGER controlled_substance_handler_authorization_no_delete
  BEFORE DELETE ON "ControlledSubstanceHandlerAuthorization"
  FOR EACH ROW EXECUTE FUNCTION refuse_controlled_substance_record_delete();

-- ─── Organization isolation ─────────────────────────────────────────────────

ALTER TABLE "ControlledSubstanceProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlledSubstanceProduct" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ControlledSubstanceProduct_organization_policy" ON "ControlledSubstanceProduct"
  USING ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''));

ALTER TABLE "ControlledSubstanceRegister" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlledSubstanceRegister" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ControlledSubstanceRegister_organization_policy" ON "ControlledSubstanceRegister"
  USING ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''));

ALTER TABLE "ControlledSubstanceHandlerAuthorization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlledSubstanceHandlerAuthorization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ControlledSubstanceHandlerAuthorization_organization_policy" ON "ControlledSubstanceHandlerAuthorization"
  USING ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''));

ALTER TABLE "ControlledSubstanceMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlledSubstanceMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ControlledSubstanceMovement_organization_policy" ON "ControlledSubstanceMovement"
  USING ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''));

ALTER TABLE "ControlledSubstanceCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlledSubstanceCount" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ControlledSubstanceCount_organization_policy" ON "ControlledSubstanceCount"
  USING ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''));

ALTER TABLE "ControlledSubstanceCountLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlledSubstanceCountLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ControlledSubstanceCountLine_organization_policy" ON "ControlledSubstanceCountLine"
  USING ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''));

ALTER TABLE "ControlledSubstanceDiscrepancy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlledSubstanceDiscrepancy" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ControlledSubstanceDiscrepancy_organization_policy" ON "ControlledSubstanceDiscrepancy"
  USING ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.organization_id', true), ''));
