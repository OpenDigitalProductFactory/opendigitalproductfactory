-- BI-EEA24A34 Phase 3: rental / shared-asset value-stream domain model.
-- Additive tables only — RentableUnit / RentalAgreement / RentalConditionRecord.
-- Models the reserve → checkout → return & inspect → re-pool lifecycle for
-- stocked, returnable assets (equipment rental, self-storage, agricultural
-- shared-machinery co-op). StorefrontItem stays the rate-card *class*;
-- RentableUnit is an individual stocked asset (optional — a class may be a
-- quantity-pool with stockQuantity and zero units); RentalAgreement is the
-- rental analog of StorefrontBooking and hangs off StorefrontConfig.
-- BookingHold (existing) is reused for reservation concurrency.

-- CreateTable
CREATE TABLE "RentableUnit" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "storefrontItemId" TEXT NOT NULL,
    "unitRef" TEXT,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "meterReading" DECIMAL(65,30),
    "attributes" JSONB,
    "acquiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentableUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalAgreement" (
    "id" TEXT NOT NULL,
    "agreementRef" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "storefrontItemId" TEXT NOT NULL,
    "rentableUnitId" TEXT,
    "customerContactId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "pricingModel" TEXT NOT NULL DEFAULT 'per-day',
    "rateAmount" DECIMAL(65,30),
    "depositAmount" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "verificationStatus" TEXT NOT NULL DEFAULT 'not-required',
    "checkoutConditionId" TEXT,
    "returnConditionId" TEXT,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalConditionRecord" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "meterReading" DECIMAL(65,30),
    "notes" TEXT,
    "mediaRefs" JSONB,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalConditionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentableUnit_unitId_key" ON "RentableUnit"("unitId");

-- CreateIndex
CREATE INDEX "RentableUnit_storefrontId_status_idx" ON "RentableUnit"("storefrontId", "status");

-- CreateIndex
CREATE INDEX "RentableUnit_storefrontItemId_status_idx" ON "RentableUnit"("storefrontItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreement_agreementRef_key" ON "RentalAgreement"("agreementRef");

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreement_checkoutConditionId_key" ON "RentalAgreement"("checkoutConditionId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreement_returnConditionId_key" ON "RentalAgreement"("returnConditionId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreement_idempotencyKey_key" ON "RentalAgreement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RentalAgreement_storefrontId_status_idx" ON "RentalAgreement"("storefrontId", "status");

-- CreateIndex
CREATE INDEX "RentalAgreement_rentableUnitId_status_idx" ON "RentalAgreement"("rentableUnitId", "status");

-- CreateIndex
CREATE INDEX "RentalAgreement_periodStart_periodEnd_idx" ON "RentalAgreement"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "RentalAgreement_customerEmail_idx" ON "RentalAgreement"("customerEmail");

-- CreateIndex
CREATE INDEX "RentalConditionRecord_agreementId_phase_idx" ON "RentalConditionRecord"("agreementId", "phase");

-- AddForeignKey
ALTER TABLE "RentableUnit" ADD CONSTRAINT "RentableUnit_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentableUnit" ADD CONSTRAINT "RentableUnit_storefrontItemId_fkey" FOREIGN KEY ("storefrontItemId") REFERENCES "StorefrontItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_storefrontItemId_fkey" FOREIGN KEY ("storefrontItemId") REFERENCES "StorefrontItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_rentableUnitId_fkey" FOREIGN KEY ("rentableUnitId") REFERENCES "RentableUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_checkoutConditionId_fkey" FOREIGN KEY ("checkoutConditionId") REFERENCES "RentalConditionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_returnConditionId_fkey" FOREIGN KEY ("returnConditionId") REFERENCES "RentalConditionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalConditionRecord" ADD CONSTRAINT "RentalConditionRecord_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
