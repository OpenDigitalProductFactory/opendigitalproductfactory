-- CreateTable
CREATE TABLE "Regulation" (
    "id" TEXT NOT NULL,
    "regulationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "industry" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'external',
    "effectiveDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "notes" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Regulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "regulationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "category" TEXT,
    "frequency" TEXT,
    "applicability" TEXT,
    "penaltySummary" TEXT,
    "ownerEmployeeId" TEXT,
    "reviewDate" TIMESTAMP(3),
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Control" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "controlType" TEXT NOT NULL,
    "implementationStatus" TEXT NOT NULL DEFAULT 'planned',
    "ownerEmployeeId" TEXT,
    "reviewFrequency" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewDate" TIMESTAMP(3),
    "effectiveness" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlObligationLink" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlObligationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceEvidence" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "description" TEXT,
    "obligationId" TEXT,
    "controlId" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedByEmployeeId" TEXT,
    "fileRef" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "supersededById" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "hazard" TEXT NOT NULL,
    "likelihood" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "inherentRisk" TEXT NOT NULL,
    "residualRisk" TEXT,
    "assessedByEmployeeId" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextReviewDate" TIMESTAMP(3),
    "notes" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskControl" (
    "id" TEXT NOT NULL,
    "riskAssessmentId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "mitigationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceIncident" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3),
    "severity" TEXT NOT NULL,
    "category" TEXT,
    "regulatoryNotifiable" BOOLEAN NOT NULL DEFAULT false,
    "notificationDeadline" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "rootCause" TEXT,
    "riskAssessmentId" TEXT,
    "reportedByEmployeeId" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectiveAction" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rootCause" TEXT,
    "sourceType" TEXT NOT NULL,
    "incidentId" TEXT,
    "auditFindingId" TEXT,
    "ownerEmployeeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verificationMethod" TEXT,
    "verificationDate" TIMESTAMP(3),
    "verifiedByEmployeeId" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "auditType" TEXT NOT NULL,
    "scope" TEXT,
    "auditorName" TEXT,
    "auditorEmployeeId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "conductedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "overallRating" TEXT,
    "notes" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "controlId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "findingType" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatorySubmission" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "regulationId" TEXT,
    "recipientBody" TEXT NOT NULL,
    "submissionType" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "submittedByEmployeeId" TEXT,
    "confirmationRef" TEXT,
    "responseReceived" BOOLEAN NOT NULL DEFAULT false,
    "responseDate" TIMESTAMP(3),
    "responseSummary" TEXT,
    "notes" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatorySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "performedByEmployeeId" TEXT,
    "agentId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "ComplianceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Regulation_regulationId_key" ON "Regulation"("regulationId");
CREATE INDEX "Regulation_status_idx" ON "Regulation"("status");
CREATE INDEX "Regulation_jurisdiction_idx" ON "Regulation"("jurisdiction");
CREATE INDEX "Regulation_sourceType_idx" ON "Regulation"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_obligationId_key" ON "Obligation"("obligationId");
CREATE INDEX "Obligation_regulationId_idx" ON "Obligation"("regulationId");
CREATE INDEX "Obligation_ownerEmployeeId_idx" ON "Obligation"("ownerEmployeeId");
CREATE INDEX "Obligation_status_idx" ON "Obligation"("status");
CREATE INDEX "Obligation_category_idx" ON "Obligation"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Control_controlId_key" ON "Control"("controlId");
CREATE INDEX "Control_ownerEmployeeId_idx" ON "Control"("ownerEmployeeId");
CREATE INDEX "Control_status_idx" ON "Control"("status");
CREATE INDEX "Control_implementationStatus_idx" ON "Control"("implementationStatus");
CREATE INDEX "Control_controlType_idx" ON "Control"("controlType");

-- CreateIndex
CREATE UNIQUE INDEX "ControlObligationLink_controlId_obligationId_key" ON "ControlObligationLink"("controlId", "obligationId");
CREATE INDEX "ControlObligationLink_controlId_idx" ON "ControlObligationLink"("controlId");
CREATE INDEX "ControlObligationLink_obligationId_idx" ON "ControlObligationLink"("obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceEvidence_evidenceId_key" ON "ComplianceEvidence"("evidenceId");
CREATE INDEX "ComplianceEvidence_obligationId_idx" ON "ComplianceEvidence"("obligationId");
CREATE INDEX "ComplianceEvidence_controlId_idx" ON "ComplianceEvidence"("controlId");
CREATE INDEX "ComplianceEvidence_collectedByEmployeeId_idx" ON "ComplianceEvidence"("collectedByEmployeeId");
CREATE INDEX "ComplianceEvidence_status_idx" ON "ComplianceEvidence"("status");
CREATE INDEX "ComplianceEvidence_evidenceType_idx" ON "ComplianceEvidence"("evidenceType");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_assessmentId_key" ON "RiskAssessment"("assessmentId");
CREATE INDEX "RiskAssessment_assessedByEmployeeId_idx" ON "RiskAssessment"("assessedByEmployeeId");
CREATE INDEX "RiskAssessment_status_idx" ON "RiskAssessment"("status");
CREATE INDEX "RiskAssessment_inherentRisk_idx" ON "RiskAssessment"("inherentRisk");

-- CreateIndex
CREATE UNIQUE INDEX "RiskControl_riskAssessmentId_controlId_key" ON "RiskControl"("riskAssessmentId", "controlId");
CREATE INDEX "RiskControl_riskAssessmentId_idx" ON "RiskControl"("riskAssessmentId");
CREATE INDEX "RiskControl_controlId_idx" ON "RiskControl"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceIncident_incidentId_key" ON "ComplianceIncident"("incidentId");
CREATE INDEX "ComplianceIncident_riskAssessmentId_idx" ON "ComplianceIncident"("riskAssessmentId");
CREATE INDEX "ComplianceIncident_reportedByEmployeeId_idx" ON "ComplianceIncident"("reportedByEmployeeId");
CREATE INDEX "ComplianceIncident_status_idx" ON "ComplianceIncident"("status");
CREATE INDEX "ComplianceIncident_severity_idx" ON "ComplianceIncident"("severity");
CREATE INDEX "ComplianceIncident_regulatoryNotifiable_idx" ON "ComplianceIncident"("regulatoryNotifiable");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectiveAction_actionId_key" ON "CorrectiveAction"("actionId");
CREATE INDEX "CorrectiveAction_incidentId_idx" ON "CorrectiveAction"("incidentId");
CREATE INDEX "CorrectiveAction_auditFindingId_idx" ON "CorrectiveAction"("auditFindingId");
CREATE INDEX "CorrectiveAction_ownerEmployeeId_idx" ON "CorrectiveAction"("ownerEmployeeId");
CREATE INDEX "CorrectiveAction_verifiedByEmployeeId_idx" ON "CorrectiveAction"("verifiedByEmployeeId");
CREATE INDEX "CorrectiveAction_status_idx" ON "CorrectiveAction"("status");
CREATE INDEX "CorrectiveAction_dueDate_idx" ON "CorrectiveAction"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceAudit_auditId_key" ON "ComplianceAudit"("auditId");
CREATE INDEX "ComplianceAudit_auditorEmployeeId_idx" ON "ComplianceAudit"("auditorEmployeeId");
CREATE INDEX "ComplianceAudit_status_idx" ON "ComplianceAudit"("status");
CREATE INDEX "ComplianceAudit_auditType_idx" ON "ComplianceAudit"("auditType");

-- CreateIndex
CREATE UNIQUE INDEX "AuditFinding_findingId_key" ON "AuditFinding"("findingId");
CREATE INDEX "AuditFinding_auditId_idx" ON "AuditFinding"("auditId");
CREATE INDEX "AuditFinding_controlId_idx" ON "AuditFinding"("controlId");
CREATE INDEX "AuditFinding_status_idx" ON "AuditFinding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySubmission_submissionId_key" ON "RegulatorySubmission"("submissionId");
CREATE INDEX "RegulatorySubmission_regulationId_idx" ON "RegulatorySubmission"("regulationId");
CREATE INDEX "RegulatorySubmission_submittedByEmployeeId_idx" ON "RegulatorySubmission"("submittedByEmployeeId");
CREATE INDEX "RegulatorySubmission_status_idx" ON "RegulatorySubmission"("status");
CREATE INDEX "RegulatorySubmission_dueDate_idx" ON "RegulatorySubmission"("dueDate");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_entityType_entityId_idx" ON "ComplianceAuditLog"("entityType", "entityId");
CREATE INDEX "ComplianceAuditLog_performedByEmployeeId_idx" ON "ComplianceAuditLog"("performedByEmployeeId");
CREATE INDEX "ComplianceAuditLog_performedAt_idx" ON "ComplianceAuditLog"("performedAt");

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "Regulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlObligationLink" ADD CONSTRAINT "ControlObligationLink_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ControlObligationLink" ADD CONSTRAINT "ControlObligationLink_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_collectedByEmployeeId_fkey" FOREIGN KEY ("collectedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "ComplianceEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_assessedByEmployeeId_fkey" FOREIGN KEY ("assessedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "RiskAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIncident" ADD CONSTRAINT "ComplianceIncident_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "RiskAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceIncident" ADD CONSTRAINT "ComplianceIncident_reportedByEmployeeId_fkey" FOREIGN KEY ("reportedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ComplianceIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_auditFindingId_fkey" FOREIGN KEY ("auditFindingId") REFERENCES "AuditFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_verifiedByEmployeeId_fkey" FOREIGN KEY ("verifiedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAudit" ADD CONSTRAINT "ComplianceAudit_auditorEmployeeId_fkey" FOREIGN KEY ("auditorEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "ComplianceAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatorySubmission" ADD CONSTRAINT "RegulatorySubmission_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "Regulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RegulatorySubmission" ADD CONSTRAINT "RegulatorySubmission_submittedByEmployeeId_fkey" FOREIGN KEY ("submittedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditLog" ADD CONSTRAINT "ComplianceAuditLog_performedByEmployeeId_fkey" FOREIGN KEY ("performedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
