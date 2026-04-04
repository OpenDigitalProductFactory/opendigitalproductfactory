-- CreateTable
CREATE TABLE "DiscoveryConnection" (
    "id" TEXT NOT NULL,
    "connectionKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collectorType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unconfigured',
    "endpointUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "gatewayEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryConnection_connectionKey_key" ON "DiscoveryConnection"("connectionKey");

-- CreateIndex
CREATE INDEX "DiscoveryConnection_collectorType_idx" ON "DiscoveryConnection"("collectorType");

-- CreateIndex
CREATE INDEX "DiscoveryConnection_status_idx" ON "DiscoveryConnection"("status");

-- AlterTable
ALTER TABLE "InventoryEntity" ADD COLUMN "discoveredViaConnectionId" TEXT;

-- AddForeignKey
ALTER TABLE "DiscoveryConnection" ADD CONSTRAINT "DiscoveryConnection_gatewayEntityId_fkey" FOREIGN KEY ("gatewayEntityId") REFERENCES "InventoryEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEntity" ADD CONSTRAINT "InventoryEntity_discoveredViaConnectionId_fkey" FOREIGN KEY ("discoveredViaConnectionId") REFERENCES "DiscoveryConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
