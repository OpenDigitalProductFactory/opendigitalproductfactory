-- CreateTable
CREATE TABLE "DeviceCodeSession" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeviceCodeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCodeSession_deviceCode_key" ON "DeviceCodeSession"("deviceCode");

-- CreateIndex
CREATE INDEX "DeviceCodeSession_expiresAt_idx" ON "DeviceCodeSession"("expiresAt");
