-- Add monitoring timestamps for deduped tax-remittance reminders.
ALTER TABLE "TaxObligationPeriod"
ADD COLUMN "dueSoonNotifiedAt" TIMESTAMP(3),
ADD COLUMN "overdueNotifiedAt" TIMESTAMP(3);
