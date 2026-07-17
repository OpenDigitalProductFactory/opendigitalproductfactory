-- BI-HEALTHCARE-012 Phase 2C: evidence references, digests, provenance, and
-- patient/packet linkage are immutable after staging. Human reviewers may
-- change only the review status and its reviewer/timestamp/reason fields.
-- @migration-safety: data-safe: adds trigger functions and triggers only; no existing rows or constraints are changed.

CREATE OR REPLACE FUNCTION prevent_care_consent_attestation_payload_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."attestationId" IS DISTINCT FROM NEW."attestationId"
    OR OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR OLD."packetId" IS DISTINCT FROM NEW."packetId"
    OR OLD."patientProfileId" IS DISTINCT FROM NEW."patientProfileId"
    OR OLD."responseId" IS DISTINCT FROM NEW."responseId"
    OR OLD."patientConsentDirectiveId" IS DISTINCT FROM NEW."patientConsentDirectiveId"
    OR OLD."documentRef" IS DISTINCT FROM NEW."documentRef"
    OR OLD."documentDigest" IS DISTINCT FROM NEW."documentDigest"
    OR OLD."documentVersion" IS DISTINCT FROM NEW."documentVersion"
    OR OLD."signatureEvidenceRef" IS DISTINCT FROM NEW."signatureEvidenceRef"
    OR OLD."signatureDigest" IS DISTINCT FROM NEW."signatureDigest"
    OR OLD."signatureMethod" IS DISTINCT FROM NEW."signatureMethod"
    OR OLD."signerPrincipalId" IS DISTINCT FROM NEW."signerPrincipalId"
    OR OLD."witnessPrincipalId" IS DISTINCT FROM NEW."witnessPrincipalId"
    OR OLD."attestedAt" IS DISTINCT FROM NEW."attestedAt"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  THEN
    RAISE EXCEPTION 'CareConsentAttestation evidence payload is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_care_coverage_evidence_payload_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."evidenceId" IS DISTINCT FROM NEW."evidenceId"
    OR OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR OLD."packetId" IS DISTINCT FROM NEW."packetId"
    OR OLD."patientProfileId" IS DISTINCT FROM NEW."patientProfileId"
    OR OLD."fundingType" IS DISTINCT FROM NEW."fundingType"
    OR OLD."payerOrProgramName" IS DISTINCT FROM NEW."payerOrProgramName"
    OR OLD."memberIdentifierLast4" IS DISTINCT FROM NEW."memberIdentifierLast4"
    OR OLD."responsiblePartyPrincipalId" IS DISTINCT FROM NEW."responsiblePartyPrincipalId"
    OR OLD."evidenceRef" IS DISTINCT FROM NEW."evidenceRef"
    OR OLD."evidenceDigest" IS DISTINCT FROM NEW."evidenceDigest"
    OR OLD."effectiveFrom" IS DISTINCT FROM NEW."effectiveFrom"
    OR OLD."effectiveUntil" IS DISTINCT FROM NEW."effectiveUntil"
    OR OLD."sourceSystem" IS DISTINCT FROM NEW."sourceSystem"
    OR OLD."sourceId" IS DISTINCT FROM NEW."sourceId"
    OR OLD."sourceVersion" IS DISTINCT FROM NEW."sourceVersion"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  THEN
    RAISE EXCEPTION 'CareCoverageEvidence evidence payload is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_care_intake_evidence_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% evidence is append-retained and cannot be deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CareConsentAttestation_payload_immutable" ON "CareConsentAttestation";
CREATE TRIGGER "CareConsentAttestation_payload_immutable"
  BEFORE UPDATE ON "CareConsentAttestation"
  FOR EACH ROW EXECUTE FUNCTION prevent_care_consent_attestation_payload_mutation();

DROP TRIGGER IF EXISTS "CareConsentAttestation_no_delete" ON "CareConsentAttestation";
CREATE TRIGGER "CareConsentAttestation_no_delete"
  BEFORE DELETE ON "CareConsentAttestation"
  FOR EACH ROW EXECUTE FUNCTION prevent_care_intake_evidence_delete();

DROP TRIGGER IF EXISTS "CareCoverageEvidence_payload_immutable" ON "CareCoverageEvidence";
CREATE TRIGGER "CareCoverageEvidence_payload_immutable"
  BEFORE UPDATE ON "CareCoverageEvidence"
  FOR EACH ROW EXECUTE FUNCTION prevent_care_coverage_evidence_payload_mutation();

DROP TRIGGER IF EXISTS "CareCoverageEvidence_no_delete" ON "CareCoverageEvidence";
CREATE TRIGGER "CareCoverageEvidence_no_delete"
  BEFORE DELETE ON "CareCoverageEvidence"
  FOR EACH ROW EXECUTE FUNCTION prevent_care_intake_evidence_delete();
