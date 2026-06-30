-- Coworker Service Catalog, Offer Catalog, and Engagement records.
-- String values are guarded in application code to match the DPF enum doctrine
-- without introducing provider-specific database enums.

CREATE TABLE "CoworkerService" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "providerAgentId" TEXT NOT NULL,
  "digitalProductId" TEXT,
  "serviceOfferingId" TEXT,
  "portfolioId" TEXT,
  "name" TEXT NOT NULL,
  "summary" TEXT,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "riskTier" TEXT NOT NULL DEFAULT 'low',
  "hitlTier" INTEGER,
  "authorityBoundary" TEXT NOT NULL DEFAULT 'advice-only',
  "availabilityScope" TEXT NOT NULL DEFAULT 'internal',
  "personas" JSONB NOT NULL DEFAULT '[]',
  "portfolioRoles" JSONB NOT NULL DEFAULT '[]',
  "valueStreams" JSONB NOT NULL DEFAULT '[]',
  "archetypes" JSONB NOT NULL DEFAULT '[]',
  "jurisdictions" JSONB NOT NULL DEFAULT '[]',
  "requiredInputs" JSONB NOT NULL DEFAULT '[]',
  "producedOutputs" JSONB NOT NULL DEFAULT '[]',
  "backingSkillIds" JSONB NOT NULL DEFAULT '[]',
  "backingToolNames" JSONB NOT NULL DEFAULT '[]',
  "backingGrantKeys" JSONB NOT NULL DEFAULT '[]',
  "costModel" JSONB NOT NULL DEFAULT '{}',
  "contractTerms" JSONB NOT NULL DEFAULT '{}',
  "dataBoundary" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoworkerService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoworkerOffer" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "digitalProductId" TEXT,
  "name" TEXT NOT NULL,
  "summary" TEXT,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" TEXT NOT NULL DEFAULT '1.0.0',
  "providerOrganization" TEXT,
  "availabilityScope" TEXT NOT NULL DEFAULT 'internal',
  "riskTier" TEXT NOT NULL DEFAULT 'low',
  "authorityBoundary" TEXT NOT NULL DEFAULT 'advice-only',
  "eligibleConsumers" JSONB NOT NULL DEFAULT '[]',
  "budgetEnvelope" JSONB NOT NULL DEFAULT '{}',
  "sla" JSONB NOT NULL DEFAULT '{}',
  "requiredApprovals" JSONB NOT NULL DEFAULT '[]',
  "legalTerms" JSONB NOT NULL DEFAULT '{}',
  "dataBoundary" JSONB NOT NULL DEFAULT '{}',
  "deliverables" JSONB NOT NULL DEFAULT '[]',
  "filters" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoworkerOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoworkerEngagement" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "providerAgentId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "requestedByAgentId" TEXT,
  "requestedForPersona" TEXT,
  "requestedOutcome" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'requested',
  "inputPayload" JSONB NOT NULL DEFAULT '{}',
  "fundingContext" JSONB NOT NULL DEFAULT '{}',
  "contractContext" JSONB NOT NULL DEFAULT '{}',
  "approvalContext" JSONB NOT NULL DEFAULT '{}',
  "proposalId" TEXT,
  "envelopeId" TEXT,
  "workCapsuleId" TEXT,
  "toolExecutionId" TEXT,
  "auditRefs" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "CoworkerEngagement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoworkerService_serviceId_key" ON "CoworkerService"("serviceId");
CREATE INDEX "CoworkerService_providerAgentId_idx" ON "CoworkerService"("providerAgentId");
CREATE INDEX "CoworkerService_digitalProductId_idx" ON "CoworkerService"("digitalProductId");
CREATE INDEX "CoworkerService_serviceOfferingId_idx" ON "CoworkerService"("serviceOfferingId");
CREATE INDEX "CoworkerService_portfolioId_idx" ON "CoworkerService"("portfolioId");
CREATE INDEX "CoworkerService_status_idx" ON "CoworkerService"("status");
CREATE INDEX "CoworkerService_riskTier_idx" ON "CoworkerService"("riskTier");
CREATE INDEX "CoworkerService_availabilityScope_idx" ON "CoworkerService"("availabilityScope");

CREATE UNIQUE INDEX "CoworkerOffer_offerId_key" ON "CoworkerOffer"("offerId");
CREATE INDEX "CoworkerOffer_serviceId_idx" ON "CoworkerOffer"("serviceId");
CREATE INDEX "CoworkerOffer_digitalProductId_idx" ON "CoworkerOffer"("digitalProductId");
CREATE INDEX "CoworkerOffer_status_idx" ON "CoworkerOffer"("status");
CREATE INDEX "CoworkerOffer_riskTier_idx" ON "CoworkerOffer"("riskTier");
CREATE INDEX "CoworkerOffer_availabilityScope_idx" ON "CoworkerOffer"("availabilityScope");

CREATE UNIQUE INDEX "CoworkerEngagement_engagementId_key" ON "CoworkerEngagement"("engagementId");
CREATE INDEX "CoworkerEngagement_offerId_idx" ON "CoworkerEngagement"("offerId");
CREATE INDEX "CoworkerEngagement_serviceId_idx" ON "CoworkerEngagement"("serviceId");
CREATE INDEX "CoworkerEngagement_providerAgentId_idx" ON "CoworkerEngagement"("providerAgentId");
CREATE INDEX "CoworkerEngagement_requestedByUserId_createdAt_idx" ON "CoworkerEngagement"("requestedByUserId", "createdAt" DESC);
CREATE INDEX "CoworkerEngagement_requestedByAgentId_createdAt_idx" ON "CoworkerEngagement"("requestedByAgentId", "createdAt" DESC);
CREATE INDEX "CoworkerEngagement_status_createdAt_idx" ON "CoworkerEngagement"("status", "createdAt" DESC);
CREATE INDEX "CoworkerEngagement_proposalId_idx" ON "CoworkerEngagement"("proposalId");
CREATE INDEX "CoworkerEngagement_envelopeId_idx" ON "CoworkerEngagement"("envelopeId");
CREATE INDEX "CoworkerEngagement_workCapsuleId_idx" ON "CoworkerEngagement"("workCapsuleId");
CREATE INDEX "CoworkerEngagement_toolExecutionId_idx" ON "CoworkerEngagement"("toolExecutionId");

ALTER TABLE "CoworkerService" ADD CONSTRAINT "CoworkerService_providerAgentId_fkey" FOREIGN KEY ("providerAgentId") REFERENCES "Agent"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoworkerService" ADD CONSTRAINT "CoworkerService_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("productId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoworkerService" ADD CONSTRAINT "CoworkerService_serviceOfferingId_fkey" FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"("offeringId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoworkerService" ADD CONSTRAINT "CoworkerService_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CoworkerOffer" ADD CONSTRAINT "CoworkerOffer_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "CoworkerService"("serviceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoworkerOffer" ADD CONSTRAINT "CoworkerOffer_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("productId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CoworkerEngagement" ADD CONSTRAINT "CoworkerEngagement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CoworkerOffer"("offerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoworkerEngagement" ADD CONSTRAINT "CoworkerEngagement_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "CoworkerService"("serviceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoworkerEngagement" ADD CONSTRAINT "CoworkerEngagement_providerAgentId_fkey" FOREIGN KEY ("providerAgentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;
