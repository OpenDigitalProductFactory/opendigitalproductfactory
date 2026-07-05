-- AlterTable
ALTER TABLE "TimesheetEntry" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "invoicedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TimesheetEntry_invoiceId_idx" ON "TimesheetEntry"("invoiceId");
