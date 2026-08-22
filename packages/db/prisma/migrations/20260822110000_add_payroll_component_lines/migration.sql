-- Payslip component lines and deduction elections (BI-EAC670F1)
-- EXPAND half of an expand->contract migration: new tables only. Payslip's
-- existing Json columns are untouched; a later migration backfills rows and
-- drops them. Purely additive, so it applies against any existing data state.

-- CreateEnum
CREATE TYPE "PayComponentKind" AS ENUM ('earning', 'pre_tax_deduction', 'statutory', 'post_tax_deduction', 'employer_cost', 'reimbursement');

-- CreateEnum
CREATE TYPE "DeductionElectionKind" AS ENUM ('benefit', 'retirement', 'garnishment', 'charitable', 'loan_repayment', 'other');

-- CreateTable
CREATE TABLE "PayComponentLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "componentKind" "PayComponentKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "ledgerAccountId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayComponentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDeductionElection" (
    "id" TEXT NOT NULL,
    "employeeDeductionElectionId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "electionKind" "DeductionElectionKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "percentOfGross" DECIMAL(6,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "preTax" BOOLEAN NOT NULL DEFAULT false,
    "annualCapAmount" DECIMAL(14,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDeductionElection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayComponentLine_payslipId_componentKind_sortOrder_idx" ON "PayComponentLine"("payslipId", "componentKind", "sortOrder");

-- CreateIndex
CREATE INDEX "PayComponentLine_ledgerAccountId_idx" ON "PayComponentLine"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponentLine_payslipId_code_key" ON "PayComponentLine"("payslipId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDeductionElection_employeeDeductionElectionId_key" ON "EmployeeDeductionElection"("employeeDeductionElectionId");

-- CreateIndex
CREATE INDEX "EmployeeDeductionElection_employeeProfileId_lifecycle_effec_idx" ON "EmployeeDeductionElection"("employeeProfileId", "lifecycle", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "PayComponentLine" ADD CONSTRAINT "PayComponentLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponentLine" ADD CONSTRAINT "PayComponentLine_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeductionElection" ADD CONSTRAINT "EmployeeDeductionElection_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

