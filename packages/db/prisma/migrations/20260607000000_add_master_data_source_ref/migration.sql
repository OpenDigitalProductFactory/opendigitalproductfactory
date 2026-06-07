-- Master Data Management source crosswalk (MDM spec §6.2, typed-FK hybrid).
-- Additive: new table + FKs to high-volume canonical domains. No existing data touched.

-- CreateTable
CREATE TABLE "MasterDataSourceRef" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "supplierId" TEXT,
    "sourceSystem" TEXT NOT NULL,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT NOT NULL,
    "sourcePayloadHash" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "trustTier" TEXT NOT NULL DEFAULT 'unknown',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterDataSourceRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MasterDataSourceRef_domain_sourceSystem_sourceEntityId_key" ON "MasterDataSourceRef"("domain", "sourceSystem", "sourceEntityId");

-- CreateIndex
CREATE INDEX "MasterDataSourceRef_domain_canonicalId_idx" ON "MasterDataSourceRef"("domain", "canonicalId");

-- CreateIndex
CREATE INDEX "MasterDataSourceRef_sourceSystem_sourceEntityId_idx" ON "MasterDataSourceRef"("sourceSystem", "sourceEntityId");

-- CreateIndex
CREATE INDEX "MasterDataSourceRef_customerAccountId_idx" ON "MasterDataSourceRef"("customerAccountId");

-- CreateIndex
CREATE INDEX "MasterDataSourceRef_supplierId_idx" ON "MasterDataSourceRef"("supplierId");

-- AddForeignKey
ALTER TABLE "MasterDataSourceRef" ADD CONSTRAINT "MasterDataSourceRef_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterDataSourceRef" ADD CONSTRAINT "MasterDataSourceRef_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Typed-FK hybrid invariant (spec §6.2): for FK-backed domains the typed column
-- must be populated and equal canonicalId; for all other (polymorphic) domains
-- both typed columns must be null. Enforced in the DB, not just application code.
ALTER TABLE "MasterDataSourceRef" ADD CONSTRAINT "MasterDataSourceRef_typed_fk_check"
    CHECK (
      ("domain" = 'customer-account' AND "customerAccountId" = "canonicalId" AND "supplierId" IS NULL)
      OR ("domain" = 'supplier' AND "supplierId" = "canonicalId" AND "customerAccountId" IS NULL)
      OR ("domain" NOT IN ('customer-account', 'supplier') AND "customerAccountId" IS NULL AND "supplierId" IS NULL)
    );
