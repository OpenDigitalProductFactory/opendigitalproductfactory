-- AlterTable: drop authEndpoint, add category/baseUrl/authMethod/supportedAuthMethods to ModelProvider
ALTER TABLE "ModelProvider" DROP COLUMN "authEndpoint",
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN     "baseUrl" TEXT,
ADD COLUMN     "authMethod" TEXT NOT NULL DEFAULT 'api_key',
ADD COLUMN     "supportedAuthMethods" JSONB NOT NULL DEFAULT '["api_key"]';

-- AlterTable: add OAuth fields to CredentialEntry
ALTER TABLE "CredentialEntry" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "clientSecret" TEXT,
ADD COLUMN     "tokenEndpoint" TEXT,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "cachedToken" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

-- CreateTable: DiscoveredModel
CREATE TABLE "DiscoveredModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "rawMetadata" JSONB NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ModelProfile
CREATE TABLE "ModelProfile" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "friendlyName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "capabilityTier" TEXT NOT NULL,
    "costTier" TEXT NOT NULL,
    "bestFor" JSONB NOT NULL,
    "avoidFor" JSONB NOT NULL,
    "contextWindow" TEXT,
    "speedRating" TEXT,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: DiscoveredModel unique(providerId, modelId)
CREATE UNIQUE INDEX "DiscoveredModel_providerId_modelId_key" ON "DiscoveredModel"("providerId", "modelId");

-- CreateIndex: ModelProfile unique(providerId, modelId)
CREATE UNIQUE INDEX "ModelProfile_providerId_modelId_key" ON "ModelProfile"("providerId", "modelId");
