-- AlterTable
ALTER TABLE "Regulation" ADD COLUMN     "changeDetected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastKnownVersion" TEXT,
ADD COLUMN     "sourceCheckDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'draft',
    "ownerEmployeeId" TEXT,
    "approvedByEmployeeId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "reviewFrequency" TEXT,
    "fileRef" TEXT,
    "obligationId" TEXT,
    "notes" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRequirement" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT,
    "applicability" TEXT,
    "dueDays" INTEGER,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementCompletion" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "method" TEXT NOT NULL,
    "notes" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRequirement" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "trainingTitle" TEXT NOT NULL,
    "provider" TEXT,
    "deliveryMethod" TEXT,
    "durationMinutes" INTEGER,
    "externalUrl" TEXT,
    "passingScore" DOUBLE PRECISION,
    "certificateRequired" BOOLEAN NOT NULL DEFAULT false,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAcknowledgment" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "policyVersion" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'digital-signature',
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryMonitorScan" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "triggeredByEmployeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "regulationsChecked" INTEGER NOT NULL DEFAULT 0,
    "alertsGenerated" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "agentId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryMonitorScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryAlert" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "regulationId" TEXT,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceUrl" TEXT,
    "sourceSnippet" TEXT,
    "suggestedAction" TEXT,
    "reviewedByEmployeeId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "resolutionNotes" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Policy_policyId_key" ON "Policy"("policyId");

-- CreateIndex
CREATE INDEX "Policy_ownerEmployeeId_idx" ON "Policy"("ownerEmployeeId");

-- CreateIndex
CREATE INDEX "Policy_approvedByEmployeeId_idx" ON "Policy"("approvedByEmployeeId");

-- CreateIndex
CREATE INDEX "Policy_obligationId_idx" ON "Policy"("obligationId");

-- CreateIndex
CREATE INDEX "Policy_lifecycleStatus_idx" ON "Policy"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "Policy_category_idx" ON "Policy"("category");

-- CreateIndex
CREATE INDEX "Policy_status_idx" ON "Policy"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRequirement_requirementId_key" ON "PolicyRequirement"("requirementId");

-- CreateIndex
CREATE INDEX "PolicyRequirement_policyId_idx" ON "PolicyRequirement"("policyId");

-- CreateIndex
CREATE INDEX "PolicyRequirement_requirementType_idx" ON "PolicyRequirement"("requirementType");

-- CreateIndex
CREATE INDEX "PolicyRequirement_status_idx" ON "PolicyRequirement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCompletion_completionId_key" ON "RequirementCompletion"("completionId");

-- CreateIndex
CREATE INDEX "RequirementCompletion_requirementId_idx" ON "RequirementCompletion"("requirementId");

-- CreateIndex
CREATE INDEX "RequirementCompletion_employeeProfileId_idx" ON "RequirementCompletion"("employeeProfileId");

-- CreateIndex
CREATE INDEX "RequirementCompletion_status_idx" ON "RequirementCompletion"("status");

-- CreateIndex
CREATE INDEX "RequirementCompletion_expiresAt_idx" ON "RequirementCompletion"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCompletion_requirementId_employeeProfileId_statu_key" ON "RequirementCompletion"("requirementId", "employeeProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRequirement_requirementId_key" ON "TrainingRequirement"("requirementId");

-- CreateIndex
CREATE INDEX "TrainingRequirement_requirementId_idx" ON "TrainingRequirement"("requirementId");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgment_policyId_idx" ON "PolicyAcknowledgment"("policyId");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgment_employeeProfileId_idx" ON "PolicyAcknowledgment"("employeeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcknowledgment_policyId_employeeProfileId_policyVersi_key" ON "PolicyAcknowledgment"("policyId", "employeeProfileId", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryMonitorScan_scanId_key" ON "RegulatoryMonitorScan"("scanId");

-- CreateIndex
CREATE INDEX "RegulatoryMonitorScan_triggeredByEmployeeId_idx" ON "RegulatoryMonitorScan"("triggeredByEmployeeId");

-- CreateIndex
CREATE INDEX "RegulatoryMonitorScan_status_idx" ON "RegulatoryMonitorScan"("status");

-- CreateIndex
CREATE INDEX "RegulatoryMonitorScan_startedAt_idx" ON "RegulatoryMonitorScan"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryAlert_alertId_key" ON "RegulatoryAlert"("alertId");

-- CreateIndex
CREATE INDEX "RegulatoryAlert_scanId_idx" ON "RegulatoryAlert"("scanId");

-- CreateIndex
CREATE INDEX "RegulatoryAlert_regulationId_idx" ON "RegulatoryAlert"("regulationId");

-- CreateIndex
CREATE INDEX "RegulatoryAlert_reviewedByEmployeeId_idx" ON "RegulatoryAlert"("reviewedByEmployeeId");

-- CreateIndex
CREATE INDEX "RegulatoryAlert_status_idx" ON "RegulatoryAlert"("status");

-- CreateIndex
CREATE INDEX "RegulatoryAlert_severity_idx" ON "RegulatoryAlert"("severity");

-- CreateIndex
CREATE INDEX "RegulatoryAlert_alertType_idx" ON "RegulatoryAlert"("alertType");

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_approvedByEmployeeId_fkey" FOREIGN KEY ("approvedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRequirement" ADD CONSTRAINT "PolicyRequirement_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCompletion" ADD CONSTRAINT "RequirementCompletion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PolicyRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCompletion" ADD CONSTRAINT "RequirementCompletion_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequirement" ADD CONSTRAINT "TrainingRequirement_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PolicyRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgment" ADD CONSTRAINT "PolicyAcknowledgment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgment" ADD CONSTRAINT "PolicyAcknowledgment_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryMonitorScan" ADD CONSTRAINT "RegulatoryMonitorScan_triggeredByEmployeeId_fkey" FOREIGN KEY ("triggeredByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryAlert" ADD CONSTRAINT "RegulatoryAlert_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "RegulatoryMonitorScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryAlert" ADD CONSTRAINT "RegulatoryAlert_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "Regulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryAlert" ADD CONSTRAINT "RegulatoryAlert_reviewedByEmployeeId_fkey" FOREIGN KEY ("reviewedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
