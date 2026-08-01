-- BI-SPEND-003 (first slice): stock coverage starter.
--
-- Adds the smallest honest model of "are we about to run out of what we sell":
--   StockItem                — a stocked supply the operator counts (unit, on-hand,
--                              reorder point/quantity, optional supplier).
--   StorefrontItemComponent  — one recipe line: selling one unit of a StorefrontItem
--                              consumes quantityPerUnit of a StockItem.
--
-- Consumption is DERIVED from actual sales (StorefrontOrder.items) rather than from a
-- decrement ledger, so this slice carries no partial-fulfilment or reversal semantics.
-- Receipts, adjustments, valuation, and COGS posting stay in BI-SPEND-003 scope.
--
-- @migration-safety: data-safe: purely additive. Two NEW tables — no existing row can
-- violate a constraint that did not previously apply to it, and no existing table is
-- altered except by the FK constraints these new tables own (which reference existing
-- primary keys and take only brief catalog locks). No backfill, no data movement, no
-- column added to an existing table, no tightening of an existing constraint.

CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "onHandQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reorderPoint" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reorderQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorefrontItemComponent" (
    "id" TEXT NOT NULL,
    "storefrontItemId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantityPerUnit" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontItemComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockItem_stockItemId_key" ON "StockItem"("stockItemId");
CREATE UNIQUE INDEX "StockItem_organizationId_name_key" ON "StockItem"("organizationId", "name");
CREATE INDEX "StockItem_organizationId_isActive_idx" ON "StockItem"("organizationId", "isActive");
CREATE INDEX "StockItem_supplierId_idx" ON "StockItem"("supplierId");

CREATE UNIQUE INDEX "StorefrontItemComponent_storefrontItemId_stockItemId_key" ON "StorefrontItemComponent"("storefrontItemId", "stockItemId");
CREATE INDEX "StorefrontItemComponent_stockItemId_idx" ON "StorefrontItemComponent"("stockItemId");

ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StorefrontItemComponent" ADD CONSTRAINT "StorefrontItemComponent_storefrontItemId_fkey" FOREIGN KEY ("storefrontItemId") REFERENCES "StorefrontItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontItemComponent" ADD CONSTRAINT "StorefrontItemComponent_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
