-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "payType" TEXT,
ADD COLUMN     "hourlyRate" DECIMAL(65,30),
ADD COLUMN     "annualSalary" DECIMAL(65,30),
ADD COLUMN     "standardAnnualHours" INTEGER;

-- AlterTable
ALTER TABLE "TimesheetEntry" ADD COLUMN     "customerAccountId" TEXT,
ADD COLUMN     "billableRateId" TEXT,
ADD COLUMN     "billable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billableHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BillableRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'hour',
    "billRate" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillableRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimesheetEntry_customerAccountId_idx" ON "TimesheetEntry"("customerAccountId");

-- CreateIndex
CREATE INDEX "BillableRate_organizationId_isActive_idx" ON "BillableRate"("organizationId", "isActive");
