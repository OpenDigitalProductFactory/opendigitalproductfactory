-- EP-STORE-003: Add booking calendar models
-- ServiceProvider, ProviderService, ProviderAvailability, BookingHold
-- Plus extensions to StorefrontConfig, StorefrontItem, StorefrontBooking

-- AlterTable
ALTER TABLE "StorefrontBooking" ADD COLUMN     "assignmentMode" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "fromReschedule" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "parentBookingId" TEXT,
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "recurrenceEndDate" TIMESTAMP(3),
ADD COLUMN     "recurrenceRule" TEXT;

-- AlterTable
ALTER TABLE "StorefrontConfig" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/London';

-- CreateTable
CREATE TABLE "ServiceProvider" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "employeeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderService" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "ProviderService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAvailability" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingHold" (
    "id" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "providerId" TEXT,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "holderToken" TEXT NOT NULL,
    "holderIp" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProvider_providerId_key" ON "ServiceProvider"("providerId");

-- CreateIndex
CREATE INDEX "ServiceProvider_storefrontId_idx" ON "ServiceProvider"("storefrontId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderService_providerId_itemId_key" ON "ProviderService"("providerId", "itemId");

-- CreateIndex
CREATE INDEX "ProviderAvailability_providerId_idx" ON "ProviderAvailability"("providerId");

-- CreateIndex
CREATE INDEX "ProviderAvailability_providerId_date_idx" ON "ProviderAvailability"("providerId", "date");

-- CreateIndex
CREATE INDEX "BookingHold_storefrontId_slotStart_slotEnd_idx" ON "BookingHold"("storefrontId", "slotStart", "slotEnd");

-- CreateIndex
CREATE INDEX "BookingHold_expiresAt_idx" ON "BookingHold"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontBooking_idempotencyKey_key" ON "StorefrontBooking"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "StorefrontBooking" ADD CONSTRAINT "StorefrontBooking_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontBooking" ADD CONSTRAINT "StorefrontBooking_parentBookingId_fkey" FOREIGN KEY ("parentBookingId") REFERENCES "StorefrontBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderService" ADD CONSTRAINT "ProviderService_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderService" ADD CONSTRAINT "ProviderService_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StorefrontItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StorefrontItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
