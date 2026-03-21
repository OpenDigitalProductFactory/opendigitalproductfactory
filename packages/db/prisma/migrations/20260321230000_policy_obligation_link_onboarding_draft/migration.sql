-- CreateTable
CREATE TABLE "PolicyObligationLink" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyObligationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingDraft" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyObligationLink_policyId_idx" ON "PolicyObligationLink"("policyId");

-- CreateIndex
CREATE INDEX "PolicyObligationLink_obligationId_idx" ON "PolicyObligationLink"("obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyObligationLink_policyId_obligationId_key" ON "PolicyObligationLink"("policyId", "obligationId");

-- AddForeignKey
ALTER TABLE "PolicyObligationLink" ADD CONSTRAINT "PolicyObligationLink_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyObligationLink" ADD CONSTRAINT "PolicyObligationLink_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
