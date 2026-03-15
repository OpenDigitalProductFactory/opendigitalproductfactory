-- AlterTable
ALTER TABLE "DigitalProduct" ADD COLUMN     "version" TEXT NOT NULL DEFAULT '1.0.0';

-- AlterTable
ALTER TABLE "FeatureBuild" ADD COLUMN     "digitalProductId" TEXT;

-- CreateIndex
CREATE INDEX "FeatureBuild_digitalProductId_idx" ON "FeatureBuild"("digitalProductId");

-- AddForeignKey
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
