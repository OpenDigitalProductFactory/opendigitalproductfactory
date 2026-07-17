-- BI-HEALTHCARE-012: tenant-safe digital intake, consent attestation, and
-- staged coverage evidence.
--
-- @migration-safety: data-safe: this migration only creates empty tables,
-- indexes, foreign keys, checks, RLS policies, and append-only evidence
-- triggers; no existing row can violate the new constraints.

-- CreateTable
CREATE TABLE "CareIntakePacket" (
    "id" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceMode" TEXT NOT NULL,
    "purposeOfUse" TEXT NOT NULL,
    "allowedDataCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requirementSnapshot" JSONB NOT NULL,
    "requiredConsentCount" INTEGER NOT NULL DEFAULT 0,
    "requiresCoverageEvidence" BOOLEAN NOT NULL DEFAULT false,
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "enteredInErrorAt" TIMESTAMP(3),
    "sourcePrincipalId" TEXT,
    "recordedByPrincipalId" TEXT NOT NULL,
    "sourceSystem" TEXT,
    "sourceId" TEXT,
    "sourceVersion" TEXT,
    "sensitivityLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retentionClass" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareIntakePacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntakeResponse" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "dynamicFormId" TEXT NOT NULL,
    "dynamicFormVersion" INTEGER NOT NULL,
    "formSnapshot" JSONB NOT NULL,
    "formDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in-progress',
    "version" INTEGER NOT NULL DEFAULT 1,
    "answers" JSONB NOT NULL,
    "answeredLinkIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceMode" TEXT NOT NULL,
    "sourcePrincipalId" TEXT,
    "recordedByPrincipalId" TEXT NOT NULL,
    "authoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "supersedesResponseId" TEXT,
    "sourceSystem" TEXT,
    "sourceId" TEXT,
    "sourceVersion" TEXT,
    "sensitivityLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retentionClass" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "enteredInErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareIntakeResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntakeAccessGrant" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "granteePrincipalId" TEXT,
    "permittedOperations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issuedByPrincipalId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareIntakeAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareConsentAttestation" (
    "id" TEXT NOT NULL,
    "attestationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "responseId" TEXT,
    "patientConsentDirectiveId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending-review',
    "documentRef" TEXT NOT NULL,
    "documentDigest" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "signatureEvidenceRef" TEXT NOT NULL,
    "signatureDigest" TEXT NOT NULL,
    "signatureMethod" TEXT NOT NULL,
    "signerPrincipalId" TEXT NOT NULL,
    "witnessPrincipalId" TEXT,
    "acceptedByPrincipalId" TEXT,
    "attestedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareConsentAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareCoverageEvidence" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending-review',
    "fundingType" TEXT NOT NULL,
    "payerOrProgramName" TEXT,
    "memberIdentifierLast4" TEXT,
    "responsiblePartyPrincipalId" TEXT,
    "evidenceRef" TEXT NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "sourceSystem" TEXT,
    "sourceId" TEXT,
    "sourceVersion" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByPrincipalId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareCoverageEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntakeException" (
    "id" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "exceptionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL DEFAULT 'routine',
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "assignedToPrincipalId" TEXT,
    "resolvedByPrincipalId" TEXT,
    "resolution" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareIntakeException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntakeStatusEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "packetVersion" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "sourceMode" TEXT NOT NULL,
    "actorPrincipalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareIntakeStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakePacket_packetId_key" ON "CareIntakePacket"("packetId");

-- CreateIndex
CREATE INDEX "CareIntakePacket_organizationId_patientProfileId_status_idx" ON "CareIntakePacket"("organizationId", "patientProfileId", "status");

-- CreateIndex
CREATE INDEX "CareIntakePacket_organizationId_appointmentId_idx" ON "CareIntakePacket"("organizationId", "appointmentId");

-- CreateIndex
CREATE INDEX "CareIntakePacket_organizationId_status_dueAt_idx" ON "CareIntakePacket"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakePacket_id_organizationId_patientProfileId_key" ON "CareIntakePacket"("id", "organizationId", "patientProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakePacket_organizationId_sourceSystem_sourceId_key" ON "CareIntakePacket"("organizationId", "sourceSystem", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeResponse_responseId_key" ON "CareIntakeResponse"("responseId");

-- CreateIndex
CREATE UNIQUE INDEX "DynamicForm_id_version_key" ON "DynamicForm"("id", "version");

-- CreateIndex
CREATE INDEX "CareIntakeResponse_organizationId_packetId_status_idx" ON "CareIntakeResponse"("organizationId", "packetId", "status");

-- CreateIndex
CREATE INDEX "CareIntakeResponse_organizationId_patientProfileId_authored_idx" ON "CareIntakeResponse"("organizationId", "patientProfileId", "authoredAt");

-- CreateIndex
CREATE INDEX "CareIntakeResponse_dynamicFormId_dynamicFormVersion_idx" ON "CareIntakeResponse"("dynamicFormId", "dynamicFormVersion");

-- CreateIndex
CREATE INDEX "CareIntakeResponse_supersedesResponseId_idx" ON "CareIntakeResponse"("supersedesResponseId");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeResponse_id_organizationId_patientProfileId_key" ON "CareIntakeResponse"("id", "organizationId", "patientProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeResponse_organizationId_sourceSystem_sourceId_key" ON "CareIntakeResponse"("organizationId", "sourceSystem", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeAccessGrant_grantId_key" ON "CareIntakeAccessGrant"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeAccessGrant_tokenDigest_key" ON "CareIntakeAccessGrant"("tokenDigest");

-- CreateIndex
CREATE INDEX "CareIntakeAccessGrant_organizationId_packetId_expiresAt_idx" ON "CareIntakeAccessGrant"("organizationId", "packetId", "expiresAt");

-- CreateIndex
CREATE INDEX "CareIntakeAccessGrant_granteePrincipalId_expiresAt_idx" ON "CareIntakeAccessGrant"("granteePrincipalId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareConsentAttestation_attestationId_key" ON "CareConsentAttestation"("attestationId");

-- CreateIndex
CREATE INDEX "CareConsentAttestation_organizationId_packetId_status_idx" ON "CareConsentAttestation"("organizationId", "packetId", "status");

-- CreateIndex
CREATE INDEX "CareConsentAttestation_organizationId_patientProfileId_atte_idx" ON "CareConsentAttestation"("organizationId", "patientProfileId", "attestedAt");

-- CreateIndex
CREATE INDEX "CareConsentAttestation_patientConsentDirectiveId_idx" ON "CareConsentAttestation"("patientConsentDirectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "CareCoverageEvidence_evidenceId_key" ON "CareCoverageEvidence"("evidenceId");

-- CreateIndex
CREATE INDEX "CareCoverageEvidence_organizationId_packetId_status_idx" ON "CareCoverageEvidence"("organizationId", "packetId", "status");

-- CreateIndex
CREATE INDEX "CareCoverageEvidence_organizationId_patientProfileId_status_idx" ON "CareCoverageEvidence"("organizationId", "patientProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareCoverageEvidence_organizationId_sourceSystem_sourceId_key" ON "CareCoverageEvidence"("organizationId", "sourceSystem", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeException_exceptionId_key" ON "CareIntakeException"("exceptionId");

-- CreateIndex
CREATE INDEX "CareIntakeException_organizationId_status_openedAt_idx" ON "CareIntakeException"("organizationId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "CareIntakeException_organizationId_packetId_status_idx" ON "CareIntakeException"("organizationId", "packetId", "status");

-- CreateIndex
CREATE INDEX "CareIntakeException_assignedToPrincipalId_status_idx" ON "CareIntakeException"("assignedToPrincipalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeStatusEvent_eventId_key" ON "CareIntakeStatusEvent"("eventId");

-- CreateIndex
CREATE INDEX "CareIntakeStatusEvent_organizationId_packetId_occurredAt_idx" ON "CareIntakeStatusEvent"("organizationId", "packetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeStatusEvent_organizationId_packetId_packetVersion_key" ON "CareIntakeStatusEvent"("organizationId", "packetId", "packetVersion");

-- AddForeignKey
ALTER TABLE "CareIntakePacket" ADD CONSTRAINT "CareIntakePacket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakePacket" ADD CONSTRAINT "CareIntakePacket_patientProfileId_organizationId_fkey" FOREIGN KEY ("patientProfileId", "organizationId") REFERENCES "PatientProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakePacket" ADD CONSTRAINT "CareIntakePacket_appointmentId_organizationId_fkey" FOREIGN KEY ("appointmentId", "organizationId") REFERENCES "CareAppointment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakePacket" ADD CONSTRAINT "CareIntakePacket_sourcePrincipalId_fkey" FOREIGN KEY ("sourcePrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakePacket" ADD CONSTRAINT "CareIntakePacket_recordedByPrincipalId_fkey" FOREIGN KEY ("recordedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeResponse" ADD CONSTRAINT "CareIntakeResponse_packetId_organizationId_patientProfileI_fkey" FOREIGN KEY ("packetId", "organizationId", "patientProfileId") REFERENCES "CareIntakePacket"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeResponse" ADD CONSTRAINT "CareIntakeResponse_patientProfileId_organizationId_fkey" FOREIGN KEY ("patientProfileId", "organizationId") REFERENCES "PatientProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeResponse" ADD CONSTRAINT "CareIntakeResponse_dynamicFormId_dynamicFormVersion_fkey" FOREIGN KEY ("dynamicFormId", "dynamicFormVersion") REFERENCES "DynamicForm"("id", "version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CareIntakeResponse" ADD CONSTRAINT "CareIntakeResponse_sourcePrincipalId_fkey" FOREIGN KEY ("sourcePrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeResponse" ADD CONSTRAINT "CareIntakeResponse_recordedByPrincipalId_fkey" FOREIGN KEY ("recordedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeResponse" ADD CONSTRAINT "CareIntakeResponse_supersedesResponseId_organizationId_pat_fkey" FOREIGN KEY ("supersedesResponseId", "organizationId", "patientProfileId") REFERENCES "CareIntakeResponse"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeAccessGrant" ADD CONSTRAINT "CareIntakeAccessGrant_packetId_organizationId_patientProfi_fkey" FOREIGN KEY ("packetId", "organizationId", "patientProfileId") REFERENCES "CareIntakePacket"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeAccessGrant" ADD CONSTRAINT "CareIntakeAccessGrant_granteePrincipalId_fkey" FOREIGN KEY ("granteePrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeAccessGrant" ADD CONSTRAINT "CareIntakeAccessGrant_issuedByPrincipalId_fkey" FOREIGN KEY ("issuedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareConsentAttestation" ADD CONSTRAINT "CareConsentAttestation_packetId_organizationId_patientProf_fkey" FOREIGN KEY ("packetId", "organizationId", "patientProfileId") REFERENCES "CareIntakePacket"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareConsentAttestation" ADD CONSTRAINT "CareConsentAttestation_patientProfileId_organizationId_fkey" FOREIGN KEY ("patientProfileId", "organizationId") REFERENCES "PatientProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareConsentAttestation" ADD CONSTRAINT "CareConsentAttestation_responseId_organizationId_patientPr_fkey" FOREIGN KEY ("responseId", "organizationId", "patientProfileId") REFERENCES "CareIntakeResponse"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareConsentAttestation" ADD CONSTRAINT "CareConsentAttestation_patientConsentDirectiveId_organizat_fkey" FOREIGN KEY ("patientConsentDirectiveId", "organizationId", "patientProfileId") REFERENCES "PatientConsentDirective"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareConsentAttestation" ADD CONSTRAINT "CareConsentAttestation_signerPrincipalId_fkey" FOREIGN KEY ("signerPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareConsentAttestation" ADD CONSTRAINT "CareConsentAttestation_witnessPrincipalId_fkey" FOREIGN KEY ("witnessPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareConsentAttestation" ADD CONSTRAINT "CareConsentAttestation_acceptedByPrincipalId_fkey" FOREIGN KEY ("acceptedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCoverageEvidence" ADD CONSTRAINT "CareCoverageEvidence_packetId_organizationId_patientProfil_fkey" FOREIGN KEY ("packetId", "organizationId", "patientProfileId") REFERENCES "CareIntakePacket"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCoverageEvidence" ADD CONSTRAINT "CareCoverageEvidence_patientProfileId_organizationId_fkey" FOREIGN KEY ("patientProfileId", "organizationId") REFERENCES "PatientProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCoverageEvidence" ADD CONSTRAINT "CareCoverageEvidence_responsiblePartyPrincipalId_fkey" FOREIGN KEY ("responsiblePartyPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCoverageEvidence" ADD CONSTRAINT "CareCoverageEvidence_verifiedByPrincipalId_fkey" FOREIGN KEY ("verifiedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeException" ADD CONSTRAINT "CareIntakeException_packetId_organizationId_patientProfile_fkey" FOREIGN KEY ("packetId", "organizationId", "patientProfileId") REFERENCES "CareIntakePacket"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeException" ADD CONSTRAINT "CareIntakeException_patientProfileId_organizationId_fkey" FOREIGN KEY ("patientProfileId", "organizationId") REFERENCES "PatientProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeException" ADD CONSTRAINT "CareIntakeException_assignedToPrincipalId_fkey" FOREIGN KEY ("assignedToPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeException" ADD CONSTRAINT "CareIntakeException_resolvedByPrincipalId_fkey" FOREIGN KEY ("resolvedByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeStatusEvent" ADD CONSTRAINT "CareIntakeStatusEvent_packetId_organizationId_patientProfi_fkey" FOREIGN KEY ("packetId", "organizationId", "patientProfileId") REFERENCES "CareIntakePacket"("id", "organizationId", "patientProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeStatusEvent" ADD CONSTRAINT "CareIntakeStatusEvent_actorPrincipalId_fkey" FOREIGN KEY ("actorPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareIntakePacket"
  ADD CONSTRAINT "CareIntakePacket_status_check" CHECK (
    "status" IN (
      'assigned', 'in-progress', 'completed', 'amended',
      'entered-in-error', 'stopped'
    )
  ),
  ADD CONSTRAINT "CareIntakePacket_source_mode_check" CHECK (
    "sourceMode" IN (
      'patient-mobile', 'patient-web', 'proxy-mobile', 'proxy-web',
      'kiosk', 'staff-assisted', 'paper-transcribed'
    )
  ),
  ADD CONSTRAINT "CareIntakePacket_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "CareIntakePacket_completion_check"
    CHECK ("completionPercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "CareIntakePacket_required_consent_check"
    CHECK ("requiredConsentCount" >= 0),
  ADD CONSTRAINT "CareIntakePacket_terminal_time_check" CHECK (
    ("status" = 'completed' AND "completedAt" IS NOT NULL)
    OR ("status" = 'stopped' AND "stoppedAt" IS NOT NULL)
    OR ("status" = 'entered-in-error' AND "enteredInErrorAt" IS NOT NULL)
    OR "status" NOT IN ('completed', 'stopped', 'entered-in-error')
  );

ALTER TABLE "CareIntakeResponse"
  ADD CONSTRAINT "CareIntakeResponse_status_check" CHECK (
    "status" IN (
      'in-progress', 'completed', 'amended', 'entered-in-error', 'stopped'
    )
  ),
  ADD CONSTRAINT "CareIntakeResponse_source_mode_check" CHECK (
    "sourceMode" IN (
      'patient-mobile', 'patient-web', 'proxy-mobile', 'proxy-web',
      'kiosk', 'staff-assisted', 'paper-transcribed'
    )
  ),
  ADD CONSTRAINT "CareIntakeResponse_version_check"
    CHECK ("version" > 0 AND "dynamicFormVersion" > 0),
  ADD CONSTRAINT "CareIntakeResponse_form_digest_check"
    CHECK (length(trim("formDigest")) > 0),
  ADD CONSTRAINT "CareIntakeResponse_terminal_time_check" CHECK (
    ("status" IN ('completed', 'amended') AND "completedAt" IS NOT NULL)
    OR ("status" = 'entered-in-error' AND "enteredInErrorAt" IS NOT NULL)
    OR "status" NOT IN ('completed', 'amended', 'entered-in-error')
  ),
  ADD CONSTRAINT "CareIntakeResponse_no_self_supersede_check" CHECK (
    "supersedesResponseId" IS NULL OR "supersedesResponseId" <> "id"
  );

ALTER TABLE "CareIntakeAccessGrant"
  ADD CONSTRAINT "CareIntakeAccessGrant_expiry_check"
    CHECK ("expiresAt" > "issuedAt"),
  ADD CONSTRAINT "CareIntakeAccessGrant_revocation_check"
    CHECK ("revokedAt" IS NULL OR "revokedAt" >= "issuedAt");

ALTER TABLE "CareConsentAttestation"
  ADD CONSTRAINT "CareConsentAttestation_status_check" CHECK (
    "status" IN ('pending-review', 'accepted', 'rejected', 'entered-in-error')
  ),
  ADD CONSTRAINT "CareConsentAttestation_digest_check" CHECK (
    length(trim("documentDigest")) > 0
    AND length(trim("signatureDigest")) > 0
    AND length(trim("signatureEvidenceRef")) > 0
  ),
  ADD CONSTRAINT "CareConsentAttestation_review_check" CHECK (
    (
      "status" = 'accepted'
      AND "acceptedAt" IS NOT NULL
      AND "acceptedByPrincipalId" IS NOT NULL
    )
    OR (
      "status" = 'rejected'
      AND length(trim("rejectionReason")) > 0
    )
    OR "status" NOT IN ('accepted', 'rejected')
  );

ALTER TABLE "CareCoverageEvidence"
  ADD CONSTRAINT "CareCoverageEvidence_status_check" CHECK (
    "status" IN ('pending-review', 'accepted', 'rejected', 'entered-in-error')
  ),
  ADD CONSTRAINT "CareCoverageEvidence_funding_type_check" CHECK (
    "fundingType" IN (
      'commercial', 'public-entitlement', 'private', 'supplemental',
      'self-pay', 'other'
    )
  ),
  ADD CONSTRAINT "CareCoverageEvidence_member_last4_check" CHECK (
    "memberIdentifierLast4" IS NULL
    OR length("memberIdentifierLast4") BETWEEN 1 AND 4
  ),
  ADD CONSTRAINT "CareCoverageEvidence_effective_window_check" CHECK (
    "effectiveUntil" IS NULL
    OR "effectiveFrom" IS NULL
    OR "effectiveUntil" >= "effectiveFrom"
  ),
  ADD CONSTRAINT "CareCoverageEvidence_review_check" CHECK (
    (
      "status" = 'accepted'
      AND "verifiedAt" IS NOT NULL
      AND "verifiedByPrincipalId" IS NOT NULL
    )
    OR (
      "status" = 'rejected'
      AND length(trim("rejectionReason")) > 0
    )
    OR "status" NOT IN ('accepted', 'rejected')
  );

ALTER TABLE "CareIntakeException"
  ADD CONSTRAINT "CareIntakeException_type_check" CHECK (
    "exceptionType" IN (
      'identity-review', 'proxy-authority', 'required-answer', 'consent',
      'coverage', 'document-quality', 'reconciliation'
    )
  ),
  ADD CONSTRAINT "CareIntakeException_status_check" CHECK (
    "status" IN ('open', 'in-progress', 'resolved', 'waived', 'entered-in-error')
  ),
  ADD CONSTRAINT "CareIntakeException_severity_check"
    CHECK ("severity" IN ('routine', 'urgent')),
  ADD CONSTRAINT "CareIntakeException_resolution_check" CHECK (
    (
      "status" IN ('resolved', 'waived')
      AND "resolvedAt" IS NOT NULL
      AND "resolvedByPrincipalId" IS NOT NULL
      AND length(trim("resolution")) > 0
    )
    OR "status" NOT IN ('resolved', 'waived')
  );

ALTER TABLE "CareIntakeStatusEvent"
  ADD CONSTRAINT "CareIntakeStatusEvent_version_check"
    CHECK ("packetVersion" > 0),
  ADD CONSTRAINT "CareIntakeStatusEvent_from_status_check" CHECK (
    "fromStatus" IS NULL OR "fromStatus" IN (
      'assigned', 'in-progress', 'completed', 'amended',
      'entered-in-error', 'stopped'
    )
  ),
  ADD CONSTRAINT "CareIntakeStatusEvent_to_status_check" CHECK (
    "toStatus" IN (
      'assigned', 'in-progress', 'completed', 'amended',
      'entered-in-error', 'stopped'
    )
  ),
  ADD CONSTRAINT "CareIntakeStatusEvent_source_mode_check" CHECK (
    "sourceMode" IN (
      'patient-mobile', 'patient-web', 'proxy-mobile', 'proxy-web',
      'kiosk', 'staff-assisted', 'paper-transcribed'
    )
  );

CREATE OR REPLACE FUNCTION prevent_care_intake_status_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CareIntakeStatusEvent is append-only';
END;
$$;

CREATE TRIGGER "CareIntakeStatusEvent_append_only_update"
  BEFORE UPDATE ON "CareIntakeStatusEvent"
  FOR EACH ROW EXECUTE FUNCTION prevent_care_intake_status_event_mutation();

CREATE TRIGGER "CareIntakeStatusEvent_append_only_delete"
  BEFORE DELETE ON "CareIntakeStatusEvent"
  FOR EACH ROW EXECUTE FUNCTION prevent_care_intake_status_event_mutation();

-- Intake is PHI-bearing. Each repository transaction must set the canonical
-- organization context; the PatientProfile subquery then applies the existing
-- patient-subject RLS context. Missing context fails closed.
DO $$
DECLARE
  table_name TEXT;
  policy_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'CareIntakePacket',
    'CareIntakeResponse',
    'CareIntakeAccessGrant',
    'CareConsentAttestation',
    'CareCoverageEvidence',
    'CareIntakeException',
    'CareIntakeStatusEvent'
  ]
  LOOP
    policy_name := table_name || '_context_policy';
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I '
      || 'USING ("organizationId" = NULLIF(current_setting(''app.organization_id'', true), '''') '
      || 'AND EXISTS (SELECT 1 FROM "PatientProfile" profile '
      || 'WHERE profile.id = %I."patientProfileId" '
      || 'AND profile."organizationId" = %I."organizationId")) '
      || 'WITH CHECK ("organizationId" = NULLIF(current_setting(''app.organization_id'', true), '''') '
      || 'AND EXISTS (SELECT 1 FROM "PatientProfile" profile '
      || 'WHERE profile.id = %I."patientProfileId" '
      || 'AND profile."organizationId" = %I."organizationId"))',
      policy_name,
      table_name,
      table_name,
      table_name,
      table_name,
      table_name
    );
  END LOOP;
END $$;
