-- EP-ED496EB0 Phase 2 / BI-6C5C648B
-- Expand-first commercial catalog contract. Product remains the business
-- authority; DigitalProduct and ServiceOffering retain digital architecture
-- and operational-commitment ownership respectively.

ALTER TABLE "StorefrontItem"
ADD COLUMN "catalogItemId" TEXT;

ALTER TABLE "QuoteLineItem"
ADD COLUMN "catalogItemId" TEXT,
ADD COLUMN "configurationSnapshot" JSONB;

ALTER TABLE "RentableUnit"
ADD COLUMN "catalogSkuId" TEXT;

CREATE TABLE "ProductOffering" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "providerOrganizationId" TEXT NOT NULL,
    "operationalServiceOfferingId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "terms" JSONB,
    "sourceKind" TEXT,
    "sourceRef" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOffering_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priceType" TEXT,
    "priceAmount" DECIMAL(65,30),
    "priceCurrency" TEXT NOT NULL DEFAULT 'USD',
    "quoteRequired" BOOLEAN NOT NULL DEFAULT false,
    "availabilityPolicy" JSONB,
    "sourceKind" TEXT,
    "sourceRef" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductConfiguration" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'reusable',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "specification" JSONB NOT NULL,
    "sourceKind" TEXT,
    "sourceRef" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogSku" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "configurationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceKind" TEXT,
    "sourceRef" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSku_pkey" PRIMARY KEY ("id")
);

-- @migration-safety: data-safe: Product.id is already a primary key, so the
-- added composite uniqueness cannot reject any existing Product row. Every
-- other UNIQUE constraint below targets a new empty table or a new nullable
-- compatibility column, for which PostgreSQL permits multiple NULL values.
CREATE UNIQUE INDEX "Product_id_organizationId_key"
ON "Product"("id", "organizationId");

CREATE UNIQUE INDEX "ProductOffering_offeringId_key"
ON "ProductOffering"("offeringId");
CREATE UNIQUE INDEX "ProductOffering_operationalServiceOfferingId_key"
ON "ProductOffering"("operationalServiceOfferingId");
CREATE UNIQUE INDEX "ProductOffering_productId_key_key"
ON "ProductOffering"("productId", "key");
CREATE UNIQUE INDEX "ProductOffering_id_organizationId_key"
ON "ProductOffering"("id", "organizationId");

CREATE UNIQUE INDEX "CatalogItem_catalogItemId_key"
ON "CatalogItem"("catalogItemId");
CREATE UNIQUE INDEX "CatalogItem_offeringId_key_key"
ON "CatalogItem"("offeringId", "key");
CREATE UNIQUE INDEX "CatalogItem_id_organizationId_key"
ON "CatalogItem"("id", "organizationId");

CREATE UNIQUE INDEX "ProductConfiguration_configurationId_key"
ON "ProductConfiguration"("configurationId");
CREATE UNIQUE INDEX "ProductConfiguration_catalogItemId_key_key"
ON "ProductConfiguration"("catalogItemId", "key");
CREATE UNIQUE INDEX "ProductConfiguration_id_organizationId_key"
ON "ProductConfiguration"("id", "organizationId");

CREATE UNIQUE INDEX "CatalogSku_skuId_key"
ON "CatalogSku"("skuId");
CREATE UNIQUE INDEX "CatalogSku_organizationId_code_key"
ON "CatalogSku"("organizationId", "code");

CREATE INDEX "ProductOffering_organizationId_status_idx"
ON "ProductOffering"("organizationId", "status");
CREATE INDEX "ProductOffering_providerOrganizationId_idx"
ON "ProductOffering"("providerOrganizationId");
CREATE INDEX "ProductOffering_effectiveTo_idx"
ON "ProductOffering"("effectiveTo");

CREATE INDEX "CatalogItem_organizationId_status_idx"
ON "CatalogItem"("organizationId", "status");
CREATE INDEX "CatalogItem_effectiveTo_idx"
ON "CatalogItem"("effectiveTo");

CREATE INDEX "ProductConfiguration_organizationId_status_idx"
ON "ProductConfiguration"("organizationId", "status");
CREATE INDEX "ProductConfiguration_effectiveTo_idx"
ON "ProductConfiguration"("effectiveTo");

CREATE INDEX "CatalogSku_catalogItemId_status_idx"
ON "CatalogSku"("catalogItemId", "status");
CREATE INDEX "CatalogSku_configurationId_idx"
ON "CatalogSku"("configurationId");
CREATE INDEX "CatalogSku_effectiveTo_idx"
ON "CatalogSku"("effectiveTo");

CREATE INDEX "StorefrontItem_catalogItemId_idx"
ON "StorefrontItem"("catalogItemId");
CREATE INDEX "QuoteLineItem_catalogItemId_idx"
ON "QuoteLineItem"("catalogItemId");
CREATE INDEX "RentableUnit_catalogSkuId_idx"
ON "RentableUnit"("catalogSkuId");

-- @migration-safety: data-safe: the four commercial tables are newly created
-- and therefore empty. The two compatibility foreign keys use newly-added
-- nullable columns, so every existing StorefrontItem, QuoteLineItem, and
-- RentableUnit satisfies them without remediation.
ALTER TABLE "ProductOffering"
ADD CONSTRAINT "ProductOffering_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductOffering"
ADD CONSTRAINT "ProductOffering_providerOrganizationId_fkey"
FOREIGN KEY ("providerOrganizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductOffering"
ADD CONSTRAINT "ProductOffering_productId_organizationId_fkey"
FOREIGN KEY ("productId", "organizationId")
REFERENCES "Product"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductOffering"
ADD CONSTRAINT "ProductOffering_operationalServiceOfferingId_fkey"
FOREIGN KEY ("operationalServiceOfferingId") REFERENCES "ServiceOffering"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogItem"
ADD CONSTRAINT "CatalogItem_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogItem"
ADD CONSTRAINT "CatalogItem_offeringId_organizationId_fkey"
FOREIGN KEY ("offeringId", "organizationId")
REFERENCES "ProductOffering"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductConfiguration"
ADD CONSTRAINT "ProductConfiguration_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductConfiguration"
ADD CONSTRAINT "ProductConfiguration_catalogItemId_organizationId_fkey"
FOREIGN KEY ("catalogItemId", "organizationId")
REFERENCES "CatalogItem"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogSku"
ADD CONSTRAINT "CatalogSku_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogSku"
ADD CONSTRAINT "CatalogSku_catalogItemId_organizationId_fkey"
FOREIGN KEY ("catalogItemId", "organizationId")
REFERENCES "CatalogItem"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogSku"
ADD CONSTRAINT "CatalogSku_configurationId_organizationId_fkey"
FOREIGN KEY ("configurationId", "organizationId")
REFERENCES "ProductConfiguration"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StorefrontItem"
ADD CONSTRAINT "StorefrontItem_catalogItemId_fkey"
FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuoteLineItem"
ADD CONSTRAINT "QuoteLineItem_catalogItemId_fkey"
FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RentableUnit"
ADD CONSTRAINT "RentableUnit_catalogSkuId_fkey"
FOREIGN KEY ("catalogSkuId") REFERENCES "CatalogSku"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
