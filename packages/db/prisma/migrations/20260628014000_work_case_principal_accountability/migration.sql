-- AlterTable
ALTER TABLE "Principal" ADD COLUMN     "authorityMode" TEXT,
ADD COLUMN     "sponsorPrincipalId" TEXT;

-- CreateIndex
CREATE INDEX "Principal_sponsorPrincipalId_idx" ON "Principal"("sponsorPrincipalId");

-- CreateIndex
CREATE INDEX "Principal_kind_authorityMode_idx" ON "Principal"("kind", "authorityMode");

-- AddForeignKey
ALTER TABLE "Principal" ADD CONSTRAINT "Principal_sponsorPrincipalId_fkey" FOREIGN KEY ("sponsorPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
