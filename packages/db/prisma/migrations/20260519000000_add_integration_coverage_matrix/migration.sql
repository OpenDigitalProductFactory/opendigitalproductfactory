-- CreateEnum
CREATE TYPE "WriteGateRequirement" AS ENUM ('credential_verified', 'read_probe_passed', 'audit_log_enabled', 'approval_binding');

-- CreateTable
CREATE TABLE "IntegrationCoverageProvider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "posture" TEXT NOT NULL,
    "replacementIntent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCoverageProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRoleCoverage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "readPosture" TEXT NOT NULL,
    "writeGates" "WriteGateRequirement"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationRoleCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCoverageProvider_organizationId_providerKey_key" ON "IntegrationCoverageProvider"("organizationId", "providerKey");

-- CreateIndex
CREATE INDEX "IntegrationCoverageProvider_organizationId_idx" ON "IntegrationCoverageProvider"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationRoleCoverage_organizationId_providerKey_role_surface" ON "IntegrationRoleCoverage"("organizationId", "providerKey", "role", "surface");

-- CreateIndex
CREATE INDEX "IntegrationRoleCoverage_organizationId_idx" ON "IntegrationRoleCoverage"("organizationId");

-- AddForeignKey
ALTER TABLE "IntegrationCoverageProvider" ADD CONSTRAINT "IntegrationCoverageProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationRoleCoverage" ADD CONSTRAINT "IntegrationRoleCoverage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
