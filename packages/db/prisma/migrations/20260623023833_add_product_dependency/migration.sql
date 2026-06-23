-- Product-to-product dependency graph (BI-PORTPRIO-2) — the rail for the DPPM
-- line-of-sight priority cascade. Additive: a new table only.

-- CreateTable
CREATE TABLE "ProductDependency" (
    "id" TEXT NOT NULL,
    "fromProductId" TEXT NOT NULL,
    "toProductId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductDependency_fromProductId_idx" ON "ProductDependency"("fromProductId");

-- CreateIndex
CREATE INDEX "ProductDependency_toProductId_idx" ON "ProductDependency"("toProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDependency_fromProductId_toProductId_relationType_key" ON "ProductDependency"("fromProductId", "toProductId", "relationType");

-- AddForeignKey
ALTER TABLE "ProductDependency" ADD CONSTRAINT "ProductDependency_fromProductId_fkey" FOREIGN KEY ("fromProductId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDependency" ADD CONSTRAINT "ProductDependency_toProductId_fkey" FOREIGN KEY ("toProductId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
