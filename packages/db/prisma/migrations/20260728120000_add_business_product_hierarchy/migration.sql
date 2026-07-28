-- EP-ED496EB0 Phase 1 / BI-AD7F9D34
-- Expand-first: all existing tables receive nullable columns only. The new
-- hierarchy tables begin empty; existing business data is reconciled by the
-- idempotent application writer only when confirmed storefront evidence exists.

ALTER TABLE "StorefrontArchetype"
ADD COLUMN "productMix" JSONB;

ALTER TABLE "StorefrontArchetypeComposition"
ADD COLUMN "productLineId" TEXT;

CREATE TABLE "ProductLine" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceKind" TEXT,
    "sourceRef" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productLineId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceKind" TEXT,
    "sourceRef" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductDigitalProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "digitalProductId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDigitalProduct_pkey" PRIMARY KEY ("id")
);

-- @migration-safety: data-safe: all UNIQUE constraints below target new,
-- empty tables, except the nullable composition link where PostgreSQL permits
-- multiple NULL values and no existing non-NULL value exists.
CREATE UNIQUE INDEX "ProductLine_lineId_key" ON "ProductLine"("lineId");
CREATE UNIQUE INDEX "ProductLine_organizationId_key_key" ON "ProductLine"("organizationId", "key");
CREATE UNIQUE INDEX "ProductLine_id_organizationId_key" ON "ProductLine"("id", "organizationId");
CREATE UNIQUE INDEX "Product_productId_key" ON "Product"("productId");
CREATE UNIQUE INDEX "Product_productLineId_key_key" ON "Product"("productLineId", "key");
CREATE UNIQUE INDEX "ProductDigitalProduct_productId_digitalProductId_key" ON "ProductDigitalProduct"("productId", "digitalProductId");
CREATE UNIQUE INDEX "StorefrontArchetypeComposition_productLineId_key" ON "StorefrontArchetypeComposition"("productLineId");

CREATE INDEX "ProductLine_organizationId_sortOrder_idx" ON "ProductLine"("organizationId", "sortOrder");
CREATE INDEX "ProductLine_parentId_idx" ON "ProductLine"("parentId");
CREATE INDEX "ProductLine_effectiveTo_idx" ON "ProductLine"("effectiveTo");
CREATE INDEX "Product_organizationId_sortOrder_idx" ON "Product"("organizationId", "sortOrder");
CREATE INDEX "Product_productLineId_sortOrder_idx" ON "Product"("productLineId", "sortOrder");
CREATE INDEX "Product_effectiveTo_idx" ON "Product"("effectiveTo");
CREATE INDEX "ProductDigitalProduct_digitalProductId_idx" ON "ProductDigitalProduct"("digitalProductId");

-- @migration-safety: data-safe: ProductLine and ProductDigitalProduct are new
-- empty tables; adding their foreign keys cannot reject existing rows.
ALTER TABLE "ProductLine"
ADD CONSTRAINT "ProductLine_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductLine"
ADD CONSTRAINT "ProductLine_parentId_organizationId_fkey"
FOREIGN KEY ("parentId", "organizationId")
REFERENCES "ProductLine"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_productLineId_organizationId_fkey"
FOREIGN KEY ("productLineId", "organizationId")
REFERENCES "ProductLine"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDigitalProduct"
ADD CONSTRAINT "ProductDigitalProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDigitalProduct"
ADD CONSTRAINT "ProductDigitalProduct_digitalProductId_fkey"
FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- @migration-safety: data-safe: productLineId is a newly-added nullable
-- column, so every existing composition satisfies the foreign key.
ALTER TABLE "StorefrontArchetypeComposition"
ADD CONSTRAINT "StorefrontArchetypeComposition_productLineId_fkey"
FOREIGN KEY ("productLineId") REFERENCES "ProductLine"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
