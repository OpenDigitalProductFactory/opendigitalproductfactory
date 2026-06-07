-- CreateTable
CREATE TABLE "OrganizationCapabilityActivation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "decidedVia" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCapabilityActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationCapabilityActivation_organizationId_idx" ON "OrganizationCapabilityActivation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCapabilityActivation_organizationId_capabilityK_key" ON "OrganizationCapabilityActivation"("organizationId", "capabilityKey");

-- AddForeignKey
ALTER TABLE "OrganizationCapabilityActivation" ADD CONSTRAINT "OrganizationCapabilityActivation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
