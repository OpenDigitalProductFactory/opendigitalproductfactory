-- EP-ED496EB0 Phase 3 / BI-83C7D9EE
-- Expand-first Catalog Builder packaging contracts.
--
-- @migration-safety: data-safe: existing-table columns are nullable; all
-- constrained rows live in newly created empty tables; CatalogSku(id,
-- organizationId) is already unique by id; no legacy row is classified or
-- rewritten by this migration.

ALTER TABLE "CatalogItem"
  ADD COLUMN "fulfillmentRoute" TEXT;

ALTER TABLE "ProductConfiguration"
  ADD COLUMN "promotedFromQuoteLineItemId" TEXT,
  ADD COLUMN "promotionSnapshot" JSONB,
  ADD COLUMN "promotedAt" TIMESTAMP(3);

ALTER TABLE "QuoteLineItem"
  ADD COLUMN "catalogSkuId" TEXT;

CREATE UNIQUE INDEX "CatalogSku_id_organizationId_key"
  ON "CatalogSku"("id", "organizationId");

CREATE TABLE "CatalogBundleComponent" (
  "id" TEXT NOT NULL,
  "componentId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "parentCatalogItemId" TEXT NOT NULL,
  "componentCatalogItemId" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
  "eligibility" TEXT NOT NULL DEFAULT 'standalone-and-bundle',
  "allocationMode" TEXT NOT NULL DEFAULT 'unallocated',
  "allocationPercent" DECIMAL(65,30),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogBundleComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogPriceList" (
  "id" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogPriceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogPriceListEntry" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "catalogSkuId" TEXT,
  "priceType" TEXT NOT NULL DEFAULT 'fixed',
  "priceAmount" DECIMAL(65,30) NOT NULL,
  "minimumQuantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogPriceListEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogPromotion" (
  "id" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "adjustmentType" TEXT NOT NULL,
  "adjustmentValue" DECIMAL(65,30) NOT NULL,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogPromotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogPromotionItem" (
  "id" TEXT NOT NULL,
  "promotionItemId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "priceListId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogPromotionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogChannelEligibility" (
  "id" TEXT NOT NULL,
  "eligibilityId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "channelKey" TEXT NOT NULL,
  "eligibility" TEXT NOT NULL DEFAULT 'eligible',
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogChannelEligibility_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogBundleComponent_componentId_key"
  ON "CatalogBundleComponent"("componentId");
CREATE UNIQUE INDEX "CatalogBundleComponent_parentCatalogItemId_componentCatalogItemId_key"
  ON "CatalogBundleComponent"("parentCatalogItemId", "componentCatalogItemId");
CREATE INDEX "CatalogBundleComponent_organizationId_effectiveTo_idx"
  ON "CatalogBundleComponent"("organizationId", "effectiveTo");
CREATE INDEX "CatalogBundleComponent_componentCatalogItemId_idx"
  ON "CatalogBundleComponent"("componentCatalogItemId");

CREATE UNIQUE INDEX "CatalogPriceList_priceListId_key"
  ON "CatalogPriceList"("priceListId");
CREATE UNIQUE INDEX "CatalogPriceList_organizationId_key_key"
  ON "CatalogPriceList"("organizationId", "key");
CREATE UNIQUE INDEX "CatalogPriceList_id_organizationId_key"
  ON "CatalogPriceList"("id", "organizationId");
CREATE INDEX "CatalogPriceList_organizationId_status_effectiveFrom_idx"
  ON "CatalogPriceList"("organizationId", "status", "effectiveFrom");
CREATE INDEX "CatalogPriceList_effectiveTo_idx"
  ON "CatalogPriceList"("effectiveTo");

CREATE UNIQUE INDEX "CatalogPriceListEntry_entryId_key"
  ON "CatalogPriceListEntry"("entryId");
CREATE UNIQUE INDEX "CatalogPriceListEntry_priceListId_catalogItemId_catalogSkuId_effectiveFrom_key"
  ON "CatalogPriceListEntry"("priceListId", "catalogItemId", "catalogSkuId", "effectiveFrom");
CREATE UNIQUE INDEX "CatalogPriceListEntry_defaultSku_effectiveFrom_key"
  ON "CatalogPriceListEntry"("priceListId", "catalogItemId", "effectiveFrom")
  WHERE "catalogSkuId" IS NULL;
CREATE INDEX "CatalogPriceListEntry_organizationId_catalogItemId_effectiveFrom_idx"
  ON "CatalogPriceListEntry"("organizationId", "catalogItemId", "effectiveFrom");
CREATE INDEX "CatalogPriceListEntry_catalogSkuId_idx"
  ON "CatalogPriceListEntry"("catalogSkuId");
CREATE INDEX "CatalogPriceListEntry_effectiveTo_idx"
  ON "CatalogPriceListEntry"("effectiveTo");

CREATE UNIQUE INDEX "CatalogPromotion_promotionId_key"
  ON "CatalogPromotion"("promotionId");
CREATE UNIQUE INDEX "CatalogPromotion_organizationId_key_key"
  ON "CatalogPromotion"("organizationId", "key");
CREATE UNIQUE INDEX "CatalogPromotion_id_organizationId_key"
  ON "CatalogPromotion"("id", "organizationId");
CREATE INDEX "CatalogPromotion_organizationId_status_effectiveFrom_idx"
  ON "CatalogPromotion"("organizationId", "status", "effectiveFrom");
CREATE INDEX "CatalogPromotion_effectiveTo_idx"
  ON "CatalogPromotion"("effectiveTo");

CREATE UNIQUE INDEX "CatalogPromotionItem_promotionItemId_key"
  ON "CatalogPromotionItem"("promotionItemId");
CREATE UNIQUE INDEX "CatalogPromotionItem_promotionId_catalogItemId_priceListId_key"
  ON "CatalogPromotionItem"("promotionId", "catalogItemId", "priceListId");
CREATE UNIQUE INDEX "CatalogPromotionItem_defaultPriceList_key"
  ON "CatalogPromotionItem"("promotionId", "catalogItemId")
  WHERE "priceListId" IS NULL;
CREATE INDEX "CatalogPromotionItem_organizationId_catalogItemId_idx"
  ON "CatalogPromotionItem"("organizationId", "catalogItemId");
CREATE INDEX "CatalogPromotionItem_priceListId_idx"
  ON "CatalogPromotionItem"("priceListId");

CREATE UNIQUE INDEX "CatalogChannelEligibility_eligibilityId_key"
  ON "CatalogChannelEligibility"("eligibilityId");
CREATE UNIQUE INDEX "CatalogChannelEligibility_catalogItemId_channelKey_effectiveFrom_key"
  ON "CatalogChannelEligibility"("catalogItemId", "channelKey", "effectiveFrom");
CREATE INDEX "CatalogChannelEligibility_organizationId_channelKey_eligibility_idx"
  ON "CatalogChannelEligibility"("organizationId", "channelKey", "eligibility");
CREATE INDEX "CatalogChannelEligibility_effectiveTo_idx"
  ON "CatalogChannelEligibility"("effectiveTo");

CREATE INDEX "ProductConfiguration_promotedFromQuoteLineItemId_idx"
  ON "ProductConfiguration"("promotedFromQuoteLineItemId");
CREATE INDEX "QuoteLineItem_catalogSkuId_idx"
  ON "QuoteLineItem"("catalogSkuId");

ALTER TABLE "ProductConfiguration"
  ADD CONSTRAINT "ProductConfiguration_promotedFromQuoteLineItemId_fkey"
  FOREIGN KEY ("promotedFromQuoteLineItemId")
  REFERENCES "QuoteLineItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuoteLineItem"
  ADD CONSTRAINT "QuoteLineItem_catalogSkuId_fkey"
  FOREIGN KEY ("catalogSkuId")
  REFERENCES "CatalogSku"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogBundleComponent"
  ADD CONSTRAINT "CatalogBundleComponent_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogBundleComponent"
  ADD CONSTRAINT "CatalogBundleComponent_parentCatalogItemId_organizationId_fkey"
  FOREIGN KEY ("parentCatalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogBundleComponent"
  ADD CONSTRAINT "CatalogBundleComponent_componentCatalogItemId_organizationId_fkey"
  FOREIGN KEY ("componentCatalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CatalogPriceList"
  ADD CONSTRAINT "CatalogPriceList_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogPriceListEntry"
  ADD CONSTRAINT "CatalogPriceListEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogPriceListEntry"
  ADD CONSTRAINT "CatalogPriceListEntry_priceListId_organizationId_fkey"
  FOREIGN KEY ("priceListId", "organizationId")
  REFERENCES "CatalogPriceList"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogPriceListEntry"
  ADD CONSTRAINT "CatalogPriceListEntry_catalogItemId_organizationId_fkey"
  FOREIGN KEY ("catalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogPriceListEntry"
  ADD CONSTRAINT "CatalogPriceListEntry_catalogSkuId_organizationId_fkey"
  FOREIGN KEY ("catalogSkuId", "organizationId")
  REFERENCES "CatalogSku"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CatalogPromotion"
  ADD CONSTRAINT "CatalogPromotion_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogPromotionItem"
  ADD CONSTRAINT "CatalogPromotionItem_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogPromotionItem"
  ADD CONSTRAINT "CatalogPromotionItem_promotionId_organizationId_fkey"
  FOREIGN KEY ("promotionId", "organizationId")
  REFERENCES "CatalogPromotion"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogPromotionItem"
  ADD CONSTRAINT "CatalogPromotionItem_catalogItemId_organizationId_fkey"
  FOREIGN KEY ("catalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogPromotionItem"
  ADD CONSTRAINT "CatalogPromotionItem_priceListId_organizationId_fkey"
  FOREIGN KEY ("priceListId", "organizationId")
  REFERENCES "CatalogPriceList"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogChannelEligibility"
  ADD CONSTRAINT "CatalogChannelEligibility_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogChannelEligibility"
  ADD CONSTRAINT "CatalogChannelEligibility_catalogItemId_organizationId_fkey"
  FOREIGN KEY ("catalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
