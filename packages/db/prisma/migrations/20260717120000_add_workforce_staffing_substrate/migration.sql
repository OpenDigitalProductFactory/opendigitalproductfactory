-- CreateTable
CREATE TABLE "StaffingDemand" (
    "id" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "demandShape" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "localDateContext" TEXT,
    "workLocationId" TEXT,
    "occupationProfileId" TEXT,
    "roleKey" TEXT,
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredCredentials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "targetQuantity" INTEGER,
    "quantityFormula" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "provenance" JSONB,
    "effectiveVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingDemand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingShift" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffingDemandId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "localDateContext" TEXT,
    "workLocationId" TEXT,
    "requiredQuantity" INTEGER NOT NULL DEFAULT 1,
    "lifecycle" TEXT NOT NULL DEFAULT 'draft',
    "publicationVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingAssignment" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffingShiftId" TEXT NOT NULL,
    "assigneeType" TEXT NOT NULL DEFAULT 'employee',
    "employeeProfileId" TEXT,
    "staffingCrewId" TEXT,
    "lifecycle" TEXT NOT NULL DEFAULT 'proposed',
    "assignmentMode" TEXT NOT NULL DEFAULT 'assigned',
    "decisionInteractionId" TEXT,
    "approverEmployeeId" TEXT,
    "acknowledgementState" TEXT NOT NULL DEFAULT 'none',
    "source" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingAssignmentEvent" (
    "id" TEXT NOT NULL,
    "staffingAssignmentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "atVersion" INTEGER NOT NULL,
    "actorRef" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffingAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingCrew" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "crewType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingCrew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingCrewMember" (
    "id" TEXT NOT NULL,
    "staffingCrewId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "roleInCrew" TEXT,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffingCrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingResourceLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffingShiftId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffingResourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAvailabilityWindow" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "localInterval" TEXT,
    "recurrence" TEXT,
    "source" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "ownerRef" TEXT,
    "confirmationState" TEXT NOT NULL DEFAULT 'confirmed',
    "supersededById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAvailabilityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSchedulingPreference" (
    "id" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "preferenceType" TEXT NOT NULL,
    "scope" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL DEFAULT 'explicit',
    "consentState" TEXT NOT NULL DEFAULT 'pending',
    "confidence" DOUBLE PRECISION,
    "evidenceRefs" JSONB,
    "effectiveFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSchedulingPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingConstraintRule" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "organizationId" TEXT,
    "predicateType" TEXT NOT NULL,
    "family" TEXT,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "severity" TEXT NOT NULL DEFAULT 'hard',
    "applicability" JSONB NOT NULL DEFAULT '{}',
    "sourcePolicyUrl" TEXT,
    "legallyWaivable" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "validationState" TEXT NOT NULL DEFAULT 'draft',
    "reviewOwnerRef" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingConstraintRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingProposalRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inputSnapshotHash" TEXT NOT NULL,
    "inputVersion" TEXT,
    "solverProvider" TEXT,
    "solverVersion" TEXT,
    "timeLimitMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scoreComponents" JSONB,
    "unfilledDemand" JSONB,
    "violations" JSONB,
    "explanation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingProposalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingProposalOption" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "staffingProposalRunId" TEXT NOT NULL,
    "rank" INTEGER,
    "scoreComponents" JSONB,
    "coverage" JSONB,
    "unfilledDemand" JSONB,
    "violations" JSONB,
    "explanation" JSONB,
    "comparison" JSONB,
    "terminalStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffingProposalOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingExceptionRequest" (
    "id" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "staffingConstraintRuleId" TEXT,
    "staffingShiftId" TEXT,
    "staffingAssignmentId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedScope" TEXT,
    "expiresAt" TIMESTAMP(3),
    "approvingAuthorityRef" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decisionInteractionId" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceCandidateFact" (
    "id" TEXT NOT NULL,
    "candidateFactId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectEmployeeProfileId" TEXT,
    "kind" TEXT NOT NULL,
    "extractedValue" JSONB,
    "confidence" DOUBLE PRECISION,
    "sourceEnvelope" JSONB,
    "identityResolution" TEXT NOT NULL DEFAULT 'unresolved',
    "reviewState" TEXT NOT NULL DEFAULT 'pending',
    "extractionModelVersion" TEXT,
    "inferenceAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "correctionOf" TEXT,
    "promotionTargetType" TEXT,
    "promotionTargetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceCandidateFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffingDemand_demandId_key" ON "StaffingDemand"("demandId");

-- CreateIndex
CREATE INDEX "StaffingDemand_organizationId_status_idx" ON "StaffingDemand"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StaffingDemand_demandShape_idx" ON "StaffingDemand"("demandShape");

-- CreateIndex
CREATE INDEX "StaffingDemand_startAt_endAt_idx" ON "StaffingDemand"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "StaffingDemand_workLocationId_idx" ON "StaffingDemand"("workLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingShift_shiftId_key" ON "StaffingShift"("shiftId");

-- CreateIndex
CREATE INDEX "StaffingShift_organizationId_lifecycle_idx" ON "StaffingShift"("organizationId", "lifecycle");

-- CreateIndex
CREATE INDEX "StaffingShift_staffingDemandId_idx" ON "StaffingShift"("staffingDemandId");

-- CreateIndex
CREATE INDEX "StaffingShift_startAt_endAt_idx" ON "StaffingShift"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingAssignment_assignmentId_key" ON "StaffingAssignment"("assignmentId");

-- CreateIndex
CREATE INDEX "StaffingAssignment_organizationId_lifecycle_idx" ON "StaffingAssignment"("organizationId", "lifecycle");

-- CreateIndex
CREATE INDEX "StaffingAssignment_staffingShiftId_idx" ON "StaffingAssignment"("staffingShiftId");

-- CreateIndex
CREATE INDEX "StaffingAssignment_employeeProfileId_idx" ON "StaffingAssignment"("employeeProfileId");

-- CreateIndex
CREATE INDEX "StaffingAssignment_staffingCrewId_idx" ON "StaffingAssignment"("staffingCrewId");

-- CreateIndex
CREATE INDEX "StaffingAssignmentEvent_staffingAssignmentId_createdAt_idx" ON "StaffingAssignmentEvent"("staffingAssignmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingCrew_crewId_key" ON "StaffingCrew"("crewId");

-- CreateIndex
CREATE INDEX "StaffingCrew_organizationId_idx" ON "StaffingCrew"("organizationId");

-- CreateIndex
CREATE INDEX "StaffingCrewMember_employeeProfileId_idx" ON "StaffingCrewMember"("employeeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingCrewMember_staffingCrewId_employeeProfileId_key" ON "StaffingCrewMember"("staffingCrewId", "employeeProfileId");

-- CreateIndex
CREATE INDEX "StaffingResourceLink_staffingShiftId_idx" ON "StaffingResourceLink"("staffingShiftId");

-- CreateIndex
CREATE INDEX "StaffingResourceLink_resourceType_resourceRef_idx" ON "StaffingResourceLink"("resourceType", "resourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAvailabilityWindow_windowId_key" ON "EmployeeAvailabilityWindow"("windowId");

-- CreateIndex
CREATE INDEX "EmployeeAvailabilityWindow_employeeProfileId_idx" ON "EmployeeAvailabilityWindow"("employeeProfileId");

-- CreateIndex
CREATE INDEX "EmployeeAvailabilityWindow_organizationId_kind_idx" ON "EmployeeAvailabilityWindow"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "EmployeeAvailabilityWindow_startAt_endAt_idx" ON "EmployeeAvailabilityWindow"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSchedulingPreference_preferenceId_key" ON "EmployeeSchedulingPreference"("preferenceId");

-- CreateIndex
CREATE INDEX "EmployeeSchedulingPreference_employeeProfileId_idx" ON "EmployeeSchedulingPreference"("employeeProfileId");

-- CreateIndex
CREATE INDEX "EmployeeSchedulingPreference_organizationId_preferenceType_idx" ON "EmployeeSchedulingPreference"("organizationId", "preferenceType");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingConstraintRule_ruleId_key" ON "StaffingConstraintRule"("ruleId");

-- CreateIndex
CREATE INDEX "StaffingConstraintRule_organizationId_idx" ON "StaffingConstraintRule"("organizationId");

-- CreateIndex
CREATE INDEX "StaffingConstraintRule_predicateType_idx" ON "StaffingConstraintRule"("predicateType");

-- CreateIndex
CREATE INDEX "StaffingConstraintRule_severity_validationState_idx" ON "StaffingConstraintRule"("severity", "validationState");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingProposalRun_runId_key" ON "StaffingProposalRun"("runId");

-- CreateIndex
CREATE INDEX "StaffingProposalRun_organizationId_status_idx" ON "StaffingProposalRun"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingProposalOption_optionId_key" ON "StaffingProposalOption"("optionId");

-- CreateIndex
CREATE INDEX "StaffingProposalOption_staffingProposalRunId_rank_idx" ON "StaffingProposalOption"("staffingProposalRunId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingExceptionRequest_exceptionId_key" ON "StaffingExceptionRequest"("exceptionId");

-- CreateIndex
CREATE INDEX "StaffingExceptionRequest_organizationId_decision_idx" ON "StaffingExceptionRequest"("organizationId", "decision");

-- CreateIndex
CREATE INDEX "StaffingExceptionRequest_staffingConstraintRuleId_idx" ON "StaffingExceptionRequest"("staffingConstraintRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceCandidateFact_candidateFactId_key" ON "WorkforceCandidateFact"("candidateFactId");

-- CreateIndex
CREATE INDEX "WorkforceCandidateFact_organizationId_reviewState_idx" ON "WorkforceCandidateFact"("organizationId", "reviewState");

-- CreateIndex
CREATE INDEX "WorkforceCandidateFact_subjectEmployeeProfileId_idx" ON "WorkforceCandidateFact"("subjectEmployeeProfileId");

-- CreateIndex
CREATE INDEX "WorkforceCandidateFact_kind_idx" ON "WorkforceCandidateFact"("kind");

-- AddForeignKey
ALTER TABLE "StaffingShift" ADD CONSTRAINT "StaffingShift_staffingDemandId_fkey" FOREIGN KEY ("staffingDemandId") REFERENCES "StaffingDemand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingAssignment" ADD CONSTRAINT "StaffingAssignment_staffingShiftId_fkey" FOREIGN KEY ("staffingShiftId") REFERENCES "StaffingShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingAssignment" ADD CONSTRAINT "StaffingAssignment_staffingCrewId_fkey" FOREIGN KEY ("staffingCrewId") REFERENCES "StaffingCrew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingAssignmentEvent" ADD CONSTRAINT "StaffingAssignmentEvent_staffingAssignmentId_fkey" FOREIGN KEY ("staffingAssignmentId") REFERENCES "StaffingAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingCrewMember" ADD CONSTRAINT "StaffingCrewMember_staffingCrewId_fkey" FOREIGN KEY ("staffingCrewId") REFERENCES "StaffingCrew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingResourceLink" ADD CONSTRAINT "StaffingResourceLink_staffingShiftId_fkey" FOREIGN KEY ("staffingShiftId") REFERENCES "StaffingShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingProposalOption" ADD CONSTRAINT "StaffingProposalOption_staffingProposalRunId_fkey" FOREIGN KEY ("staffingProposalRunId") REFERENCES "StaffingProposalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

