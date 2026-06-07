-- Reference-data / locations merge supersede pointer (MDM-5, spec §6.6/§7 step 5).
-- Additive: records the survivor a tombstoned Region/City was merged into, so a
-- merge is auditable and reversible. status='superseded' marks a merged-away row.

-- AlterTable
ALTER TABLE "Region" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "City" ADD COLUMN "mergedIntoId" TEXT;

-- CreateIndex
CREATE INDEX "Region_mergedIntoId_idx" ON "Region"("mergedIntoId");
CREATE INDEX "City_mergedIntoId_idx" ON "City"("mergedIntoId");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "City" ADD CONSTRAINT "City_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
