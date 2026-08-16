-- @migration-safety: data-safe: PayRun and Payslip are brand-new tables created in this migration; the ADD FOREIGN KEY constraints (Payslip→PayRun, Payslip→EmployeeProfile) are on freshly-created empty tables, so no existing row can violate them. No backfill or NOT VALID needed.

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "payRunRef" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "payRunId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "grossPay" DECIMAL(65,30) NOT NULL,
    "taxablePay" DECIMAL(65,30) NOT NULL,
    "netPay" DECIMAL(65,30) NOT NULL,
    "totalEmployerCost" DECIMAL(65,30) NOT NULL,
    "earnings" JSONB NOT NULL,
    "employeeDeductions" JSONB NOT NULL,
    "employerCosts" JSONB NOT NULL,
    "disbursementStatus" TEXT NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_payRunRef_key" ON "PayRun"("payRunRef");

-- CreateIndex
CREATE INDEX "PayRun_status_idx" ON "PayRun"("status");

-- CreateIndex
CREATE INDEX "PayRun_periodStart_idx" ON "PayRun"("periodStart");

-- CreateIndex
CREATE INDEX "Payslip_employeeProfileId_idx" ON "Payslip"("employeeProfileId");

-- CreateIndex
CREATE INDEX "Payslip_disbursementStatus_idx" ON "Payslip"("disbursementStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payRunId_employeeProfileId_key" ON "Payslip"("payRunId", "employeeProfileId");

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
