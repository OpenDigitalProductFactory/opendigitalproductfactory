-- Link a RecurringSchedule to the Subscription (support contract) it renews,
-- so the existing daily recurring-invoice cron can drive contract renewals.

-- AlterTable
ALTER TABLE "RecurringSchedule" ADD COLUMN     "subscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSchedule_subscriptionId_key" ON "RecurringSchedule"("subscriptionId");

-- AddForeignKey
-- @migration-safety: data-safe: subscriptionId is added as a nullable column in this same migration, so every pre-existing RecurringSchedule row holds NULL and a NULL FK never violates the constraint; the unique index over all-NULL values is also trivially satisfied.
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
