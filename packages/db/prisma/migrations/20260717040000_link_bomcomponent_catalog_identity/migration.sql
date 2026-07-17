-- EP-ASSET-INTELLIGENCE / BI-877FE5D4: link each SBOM BomComponent to the canonical
-- CatalogIdentity the bridge resolves it to (spec §4.8). Additive only — the column is
-- nullable and back-fills on the next catalog sweep / enrich pass.
-- @migration-safety: data-safe: the added column is nullable and the FK is ON DELETE
-- SET NULL, so no existing BomComponent row is invalidated and no constraint can fail
-- on current data.

-- AlterTable
ALTER TABLE "BomComponent" ADD COLUMN     "catalogIdentityId" TEXT;

-- CreateIndex
CREATE INDEX "BomComponent_catalogIdentityId_idx" ON "BomComponent"("catalogIdentityId");

-- AddForeignKey
ALTER TABLE "BomComponent" ADD CONSTRAINT "BomComponent_catalogIdentityId_fkey" FOREIGN KEY ("catalogIdentityId") REFERENCES "CatalogIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
