-- Subscription = the support contract for a customer's own instance of DPF.
-- Created from an accepted SalesOrder; scoped to a CustomerAccount; optionally
-- covers one or more EdgeNodes (the provisioned DPF instances).

-- AlterTable
ALTER TABLE "EdgeNode" ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "subscriptionRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "planName" TEXT NOT NULL,
    "billingCadence" TEXT NOT NULL DEFAULT 'annual',
    "totalValue" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewalDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriptionRef_key" ON "Subscription"("subscriptionRef");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_salesOrderId_key" ON "Subscription"("salesOrderId");

-- CreateIndex
CREATE INDEX "Subscription_accountId_idx" ON "Subscription"("accountId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_renewalDate_idx" ON "Subscription"("renewalDate");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: subscriptionId was just added as a nullable column in this same migration, so every pre-existing EdgeNode row holds NULL, and a NULL foreign key never violates the constraint. No backfill or NOT VALID needed.
ALTER TABLE "EdgeNode" ADD CONSTRAINT "EdgeNode_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
