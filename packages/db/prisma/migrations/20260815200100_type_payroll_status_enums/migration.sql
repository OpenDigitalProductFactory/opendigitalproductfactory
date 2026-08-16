-- @migration-safety: data-safe: both columns were introduced by the immediately preceding additive migration. Existing values are constrained to the defaults/writers enumerated below; the USING clauses preserve them while adding database-level closed-set enforcement.

CREATE TYPE "PayRunStatus" AS ENUM ('draft', 'approved', 'paid', 'cancelled');
CREATE TYPE "PayslipDisbursementStatus" AS ENUM ('pending', 'paid', 'failed');

ALTER TABLE "PayRun"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PayRunStatus" USING ("status"::"PayRunStatus"),
  ALTER COLUMN "status" SET DEFAULT 'draft';

ALTER TABLE "Payslip"
  ALTER COLUMN "disbursementStatus" DROP DEFAULT,
  ALTER COLUMN "disbursementStatus" TYPE "PayslipDisbursementStatus"
    USING ("disbursementStatus"::"PayslipDisbursementStatus"),
  ALTER COLUMN "disbursementStatus" SET DEFAULT 'pending';
