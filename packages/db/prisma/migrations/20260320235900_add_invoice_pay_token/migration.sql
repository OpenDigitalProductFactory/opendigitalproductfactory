-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "payToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_payToken_key" ON "Invoice"("payToken");
