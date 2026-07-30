-- EP-ED496EB0 Phase 4 / BI-574638B7
-- Expand-first Product Sold traceability contracts.
--
-- @migration-safety: data-safe: StorefrontOrder.organizationId is nullable and
-- backfilled only from its existing StorefrontConfig relation; all remaining
-- constrained rows live in newly created empty tables; the added composite
-- unique indexes include already-unique primary keys; no legacy JSON, customer
-- identity, subscriber, entitlement, fulfillment instance, or sale is inferred.

ALTER TABLE "StorefrontOrder"
  ADD COLUMN "organizationId" TEXT;

UPDATE "StorefrontOrder" AS orders
SET "organizationId" = storefronts."organizationId"
FROM "StorefrontConfig" AS storefronts
WHERE orders."storefrontId" = storefronts."id"
  AND orders."organizationId" IS NULL;

CREATE UNIQUE INDEX "CatalogPriceListEntry_id_organizationId_key"
  ON "CatalogPriceListEntry"("id", "organizationId");
CREATE UNIQUE INDEX "StorefrontOrder_id_organizationId_key"
  ON "StorefrontOrder"("id", "organizationId");
CREATE INDEX "StorefrontOrder_organizationId_status_idx"
  ON "StorefrontOrder"("organizationId", "status");

CREATE TABLE "StorefrontOrderLineItem" (
  "id" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontOrderId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "catalogSkuId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(65,30) NOT NULL,
  "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "configurationSnapshot" JSONB,
  "pricingSnapshot" JSONB NOT NULL,
  "sourcePosition" INTEGER,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorefrontOrderLineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductSold" (
  "id" TEXT NOT NULL,
  "productSoldId" TEXT NOT NULL,
  "materializationKey" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "providerOrganizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "catalogSkuId" TEXT,
  "configurationId" TEXT,
  "priceListEntryId" TEXT,
  "promotionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'purchased',
  "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(65,30),
  "discountAmount" DECIMAL(65,30),
  "taxAmount" DECIMAL(65,30),
  "totalAmount" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "configurationSnapshot" JSONB,
  "pricingSnapshot" JSONB NOT NULL,
  "commercialSnapshot" JSONB NOT NULL,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductSoldEvidence" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productSoldId" TEXT NOT NULL,
  "evidenceKind" TEXT NOT NULL,
  "quoteLineItemId" TEXT,
  "salesOrderId" TEXT,
  "storefrontOrderLineItemId" TEXT,
  "storefrontBookingId" TEXT,
  "rentalAgreementId" TEXT,
  "subscriptionId" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evidenceSnapshot" JSONB NOT NULL,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSoldEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSoldEvidence_exactly_one_source" CHECK (num_nonnulls(
    "quoteLineItemId",
    "salesOrderId",
    "storefrontOrderLineItemId",
    "storefrontBookingId",
    "rentalAgreementId",
    "subscriptionId"
  ) = 1)
);

CREATE TABLE "ProductSoldParty" (
  "id" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productSoldId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "accountId" TEXT,
  "contactId" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "displaySnapshot" JSONB NOT NULL,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSoldParty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSoldParty_exactly_one_party" CHECK (num_nonnulls("accountId", "contactId") = 1)
);

CREATE TABLE "ProductSoldEntitlement" (
  "id" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "entitlementKey" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productSoldId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "accountId" TEXT,
  "contactId" TEXT,
  "subscriptionId" TEXT,
  "entitlementKind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "quantity" DECIMAL(65,30),
  "rightSnapshot" JSONB NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validTo" TIMESTAMP(3),
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSoldEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSoldEntitlement_exactly_one_beneficiary" CHECK (num_nonnulls("accountId", "contactId") = 1)
);

CREATE TABLE "ProductFulfillmentInstance" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "instanceKey" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productSoldId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "instanceKind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "storefrontBookingId" TEXT,
  "rentalAgreementId" TEXT,
  "rentableUnitId" TEXT,
  "edgeNodeId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "fulfillmentSnapshot" JSONB NOT NULL,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductFulfillmentInstance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductFulfillmentInstance_has_typed_target" CHECK (num_nonnulls("storefrontBookingId", "rentalAgreementId", "rentableUnitId", "edgeNodeId") >= 1)
);

CREATE TABLE "ProductSoldComponentAllocation" (
  "id" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productSoldId" TEXT NOT NULL,
  "componentCatalogItemId" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
  "allocationMode" TEXT NOT NULL DEFAULT 'unallocated',
  "allocatedAmount" DECIMAL(65,30),
  "allocationPercent" DECIMAL(65,30),
  "reportingTreatment" TEXT NOT NULL DEFAULT 'non-additive',
  "componentSnapshot" JSONB NOT NULL,
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSoldComponentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSoldComponentAllocation_non_additive" CHECK ("reportingTreatment" = 'non-additive')
);

CREATE UNIQUE INDEX "StorefrontOrderLineItem_lineId_key"
  ON "StorefrontOrderLineItem"("lineId");
CREATE UNIQUE INDEX "StorefrontOrderLineItem_id_organizationId_key"
  ON "StorefrontOrderLineItem"("id", "organizationId");
CREATE UNIQUE INDEX "StorefrontOrderLineItem_storefrontOrderId_sourcePosition_key"
  ON "StorefrontOrderLineItem"("storefrontOrderId", "sourcePosition");
CREATE INDEX "StorefrontOrderLineItem_organizationId_catalogItemId_idx"
  ON "StorefrontOrderLineItem"("organizationId", "catalogItemId");
CREATE INDEX "StorefrontOrderLineItem_catalogSkuId_idx"
  ON "StorefrontOrderLineItem"("catalogSkuId");

CREATE UNIQUE INDEX "ProductSold_productSoldId_key"
  ON "ProductSold"("productSoldId");
CREATE UNIQUE INDEX "ProductSold_materializationKey_key"
  ON "ProductSold"("materializationKey");
CREATE UNIQUE INDEX "ProductSold_id_organizationId_key"
  ON "ProductSold"("id", "organizationId");
CREATE INDEX "ProductSold_organizationId_status_purchasedAt_idx"
  ON "ProductSold"("organizationId", "status", "purchasedAt");
CREATE INDEX "ProductSold_providerOrganizationId_purchasedAt_idx"
  ON "ProductSold"("providerOrganizationId", "purchasedAt");
CREATE INDEX "ProductSold_productId_purchasedAt_idx"
  ON "ProductSold"("productId", "purchasedAt");
CREATE INDEX "ProductSold_offeringId_idx" ON "ProductSold"("offeringId");
CREATE INDEX "ProductSold_catalogItemId_idx" ON "ProductSold"("catalogItemId");
CREATE INDEX "ProductSold_catalogSkuId_idx" ON "ProductSold"("catalogSkuId");
CREATE INDEX "ProductSold_configurationId_idx" ON "ProductSold"("configurationId");
CREATE INDEX "ProductSold_priceListEntryId_idx" ON "ProductSold"("priceListEntryId");
CREATE INDEX "ProductSold_promotionId_idx" ON "ProductSold"("promotionId");

CREATE UNIQUE INDEX "ProductSoldEvidence_evidenceId_key"
  ON "ProductSoldEvidence"("evidenceId");
CREATE UNIQUE INDEX "ProductSoldEvidence_quoteLineItemId_key"
  ON "ProductSoldEvidence"("quoteLineItemId");
CREATE UNIQUE INDEX "ProductSoldEvidence_storefrontOrderLineItemId_key"
  ON "ProductSoldEvidence"("storefrontOrderLineItemId");
CREATE UNIQUE INDEX "ProductSoldEvidence_storefrontBookingId_key"
  ON "ProductSoldEvidence"("storefrontBookingId");
CREATE UNIQUE INDEX "ProductSoldEvidence_rentalAgreementId_key"
  ON "ProductSoldEvidence"("rentalAgreementId");
CREATE UNIQUE INDEX "ProductSoldEvidence_id_organizationId_key"
  ON "ProductSoldEvidence"("id", "organizationId");
CREATE UNIQUE INDEX "ProductSoldEvidence_productSoldId_salesOrderId_key"
  ON "ProductSoldEvidence"("productSoldId", "salesOrderId");
CREATE UNIQUE INDEX "ProductSoldEvidence_productSoldId_subscriptionId_key"
  ON "ProductSoldEvidence"("productSoldId", "subscriptionId");
CREATE INDEX "ProductSoldEvidence_organizationId_evidenceKind_observedAt_idx"
  ON "ProductSoldEvidence"("organizationId", "evidenceKind", "observedAt");
CREATE INDEX "ProductSoldEvidence_productSoldId_observedAt_idx"
  ON "ProductSoldEvidence"("productSoldId", "observedAt");
CREATE INDEX "ProductSoldEvidence_salesOrderId_idx"
  ON "ProductSoldEvidence"("salesOrderId");
CREATE INDEX "ProductSoldEvidence_subscriptionId_idx"
  ON "ProductSoldEvidence"("subscriptionId");

CREATE UNIQUE INDEX "ProductSoldParty_partyId_key"
  ON "ProductSoldParty"("partyId");
CREATE UNIQUE INDEX "ProductSoldParty_productSoldId_role_accountId_key"
  ON "ProductSoldParty"("productSoldId", "role", "accountId");
CREATE UNIQUE INDEX "ProductSoldParty_productSoldId_role_contactId_key"
  ON "ProductSoldParty"("productSoldId", "role", "contactId");
CREATE INDEX "ProductSoldParty_organizationId_role_idx"
  ON "ProductSoldParty"("organizationId", "role");
CREATE INDEX "ProductSoldParty_accountId_idx" ON "ProductSoldParty"("accountId");
CREATE INDEX "ProductSoldParty_contactId_idx" ON "ProductSoldParty"("contactId");
CREATE INDEX "ProductSoldParty_evidenceId_idx" ON "ProductSoldParty"("evidenceId");

CREATE UNIQUE INDEX "ProductSoldEntitlement_entitlementId_key"
  ON "ProductSoldEntitlement"("entitlementId");
CREATE UNIQUE INDEX "ProductSoldEntitlement_entitlementKey_key"
  ON "ProductSoldEntitlement"("entitlementKey");
CREATE INDEX "ProductSoldEntitlement_organizationId_status_validFrom_idx"
  ON "ProductSoldEntitlement"("organizationId", "status", "validFrom");
CREATE INDEX "ProductSoldEntitlement_productSoldId_idx"
  ON "ProductSoldEntitlement"("productSoldId");
CREATE INDEX "ProductSoldEntitlement_accountId_idx"
  ON "ProductSoldEntitlement"("accountId");
CREATE INDEX "ProductSoldEntitlement_contactId_idx"
  ON "ProductSoldEntitlement"("contactId");
CREATE INDEX "ProductSoldEntitlement_subscriptionId_idx"
  ON "ProductSoldEntitlement"("subscriptionId");
CREATE INDEX "ProductSoldEntitlement_evidenceId_idx"
  ON "ProductSoldEntitlement"("evidenceId");
CREATE INDEX "ProductSoldEntitlement_validTo_idx"
  ON "ProductSoldEntitlement"("validTo");

CREATE UNIQUE INDEX "ProductFulfillmentInstance_instanceId_key"
  ON "ProductFulfillmentInstance"("instanceId");
CREATE UNIQUE INDEX "ProductFulfillmentInstance_instanceKey_key"
  ON "ProductFulfillmentInstance"("instanceKey");
CREATE INDEX "ProductFulfillmentInstance_organizationId_instanceKind_status_idx"
  ON "ProductFulfillmentInstance"("organizationId", "instanceKind", "status");
CREATE INDEX "ProductFulfillmentInstance_productSoldId_idx"
  ON "ProductFulfillmentInstance"("productSoldId");
CREATE INDEX "ProductFulfillmentInstance_evidenceId_idx"
  ON "ProductFulfillmentInstance"("evidenceId");
CREATE INDEX "ProductFulfillmentInstance_storefrontBookingId_idx"
  ON "ProductFulfillmentInstance"("storefrontBookingId");
CREATE INDEX "ProductFulfillmentInstance_rentalAgreementId_idx"
  ON "ProductFulfillmentInstance"("rentalAgreementId");
CREATE INDEX "ProductFulfillmentInstance_rentableUnitId_idx"
  ON "ProductFulfillmentInstance"("rentableUnitId");
CREATE INDEX "ProductFulfillmentInstance_edgeNodeId_idx"
  ON "ProductFulfillmentInstance"("edgeNodeId");

CREATE UNIQUE INDEX "ProductSoldComponentAllocation_allocationId_key"
  ON "ProductSoldComponentAllocation"("allocationId");
CREATE UNIQUE INDEX "ProductSoldComponentAllocation_productSoldId_componentCatalogItemId_key"
  ON "ProductSoldComponentAllocation"("productSoldId", "componentCatalogItemId");
CREATE INDEX "ProductSoldComponentAllocation_organizationId_componentCatalogItemId_idx"
  ON "ProductSoldComponentAllocation"("organizationId", "componentCatalogItemId");

ALTER TABLE "StorefrontOrder"
  ADD CONSTRAINT "StorefrontOrder_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StorefrontOrderLineItem"
  ADD CONSTRAINT "StorefrontOrderLineItem_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontOrderLineItem"
  ADD CONSTRAINT "StorefrontOrderLineItem_storefrontOrderId_organizationId_fkey"
  FOREIGN KEY ("storefrontOrderId", "organizationId")
  REFERENCES "StorefrontOrder"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontOrderLineItem"
  ADD CONSTRAINT "StorefrontOrderLineItem_catalogItemId_organizationId_fkey"
  FOREIGN KEY ("catalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorefrontOrderLineItem"
  ADD CONSTRAINT "StorefrontOrderLineItem_catalogSkuId_organizationId_fkey"
  FOREIGN KEY ("catalogSkuId", "organizationId")
  REFERENCES "CatalogSku"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_providerOrganizationId_fkey"
  FOREIGN KEY ("providerOrganizationId")
  REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_productId_organizationId_fkey"
  FOREIGN KEY ("productId", "organizationId")
  REFERENCES "Product"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_offeringId_organizationId_fkey"
  FOREIGN KEY ("offeringId", "organizationId")
  REFERENCES "ProductOffering"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_catalogItemId_organizationId_fkey"
  FOREIGN KEY ("catalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_catalogSkuId_organizationId_fkey"
  FOREIGN KEY ("catalogSkuId", "organizationId")
  REFERENCES "CatalogSku"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_configurationId_organizationId_fkey"
  FOREIGN KEY ("configurationId", "organizationId")
  REFERENCES "ProductConfiguration"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_priceListEntryId_organizationId_fkey"
  FOREIGN KEY ("priceListEntryId", "organizationId")
  REFERENCES "CatalogPriceListEntry"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSold"
  ADD CONSTRAINT "ProductSold_promotionId_organizationId_fkey"
  FOREIGN KEY ("promotionId", "organizationId")
  REFERENCES "CatalogPromotion"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_productSoldId_organizationId_fkey"
  FOREIGN KEY ("productSoldId", "organizationId")
  REFERENCES "ProductSold"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_quoteLineItemId_fkey"
  FOREIGN KEY ("quoteLineItemId")
  REFERENCES "QuoteLineItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId")
  REFERENCES "SalesOrder"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_storefrontOrderLineItemId_organizationId_fkey"
  FOREIGN KEY ("storefrontOrderLineItemId", "organizationId")
  REFERENCES "StorefrontOrderLineItem"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_storefrontBookingId_organizationId_fkey"
  FOREIGN KEY ("storefrontBookingId", "organizationId")
  REFERENCES "StorefrontBooking"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_rentalAgreementId_fkey"
  FOREIGN KEY ("rentalAgreementId")
  REFERENCES "RentalAgreement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEvidence"
  ADD CONSTRAINT "ProductSoldEvidence_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId")
  REFERENCES "Subscription"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSoldParty"
  ADD CONSTRAINT "ProductSoldParty_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldParty"
  ADD CONSTRAINT "ProductSoldParty_productSoldId_organizationId_fkey"
  FOREIGN KEY ("productSoldId", "organizationId")
  REFERENCES "ProductSold"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldParty"
  ADD CONSTRAINT "ProductSoldParty_evidenceId_organizationId_fkey"
  FOREIGN KEY ("evidenceId", "organizationId")
  REFERENCES "ProductSoldEvidence"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldParty"
  ADD CONSTRAINT "ProductSoldParty_accountId_fkey"
  FOREIGN KEY ("accountId")
  REFERENCES "CustomerAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldParty"
  ADD CONSTRAINT "ProductSoldParty_contactId_fkey"
  FOREIGN KEY ("contactId")
  REFERENCES "CustomerContact"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSoldEntitlement"
  ADD CONSTRAINT "ProductSoldEntitlement_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEntitlement"
  ADD CONSTRAINT "ProductSoldEntitlement_productSoldId_organizationId_fkey"
  FOREIGN KEY ("productSoldId", "organizationId")
  REFERENCES "ProductSold"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEntitlement"
  ADD CONSTRAINT "ProductSoldEntitlement_evidenceId_organizationId_fkey"
  FOREIGN KEY ("evidenceId", "organizationId")
  REFERENCES "ProductSoldEvidence"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEntitlement"
  ADD CONSTRAINT "ProductSoldEntitlement_accountId_fkey"
  FOREIGN KEY ("accountId")
  REFERENCES "CustomerAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEntitlement"
  ADD CONSTRAINT "ProductSoldEntitlement_contactId_fkey"
  FOREIGN KEY ("contactId")
  REFERENCES "CustomerContact"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSoldEntitlement"
  ADD CONSTRAINT "ProductSoldEntitlement_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId")
  REFERENCES "Subscription"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductFulfillmentInstance"
  ADD CONSTRAINT "ProductFulfillmentInstance_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductFulfillmentInstance"
  ADD CONSTRAINT "ProductFulfillmentInstance_productSoldId_organizationId_fkey"
  FOREIGN KEY ("productSoldId", "organizationId")
  REFERENCES "ProductSold"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductFulfillmentInstance"
  ADD CONSTRAINT "ProductFulfillmentInstance_evidenceId_organizationId_fkey"
  FOREIGN KEY ("evidenceId", "organizationId")
  REFERENCES "ProductSoldEvidence"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductFulfillmentInstance"
  ADD CONSTRAINT "ProductFulfillmentInstance_storefrontBookingId_organizationId_fkey"
  FOREIGN KEY ("storefrontBookingId", "organizationId")
  REFERENCES "StorefrontBooking"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductFulfillmentInstance"
  ADD CONSTRAINT "ProductFulfillmentInstance_rentalAgreementId_fkey"
  FOREIGN KEY ("rentalAgreementId")
  REFERENCES "RentalAgreement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductFulfillmentInstance"
  ADD CONSTRAINT "ProductFulfillmentInstance_rentableUnitId_fkey"
  FOREIGN KEY ("rentableUnitId")
  REFERENCES "RentableUnit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductFulfillmentInstance"
  ADD CONSTRAINT "ProductFulfillmentInstance_edgeNodeId_fkey"
  FOREIGN KEY ("edgeNodeId")
  REFERENCES "EdgeNode"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSoldComponentAllocation"
  ADD CONSTRAINT "ProductSoldComponentAllocation_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldComponentAllocation"
  ADD CONSTRAINT "ProductSoldComponentAllocation_productSoldId_organizationId_fkey"
  FOREIGN KEY ("productSoldId", "organizationId")
  REFERENCES "ProductSold"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSoldComponentAllocation"
  ADD CONSTRAINT "ProductSoldComponentAllocation_componentCatalogItemId_organizationId_fkey"
  FOREIGN KEY ("componentCatalogItemId", "organizationId")
  REFERENCES "CatalogItem"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
