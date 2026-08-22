-- BI-2C80E6EA / DI-F289DBB51DCB — make the open subject vocabulary and
-- non-relational reference explicit, then restore tenant-safe patient
-- provenance constraints on generic intake evidence.
--
-- @migration-safety: remediated: column and index renames preserve existing
-- values; nullable patient foreign keys are added NOT VALID and validated only
-- after their supporting indexes exist. The preceding migration backfilled all
-- care roots and retained the prior patient-profile referential guarantees.
--
-- Rollback is forward-only. Application rollback remains compatible while it
-- writes through patientSubjectReference. Reversing the public column names
-- requires a coordinated application release; the restored constraints and
-- indexes are safe to retain.

ALTER TABLE "CareAppointment"
  RENAME COLUMN "subjectType" TO "subjectKindSlug";
ALTER TABLE "CareAppointment"
  RENAME COLUMN "subjectId" TO "subjectRef";
ALTER TABLE "CareIntakePacket"
  RENAME COLUMN "subjectType" TO "subjectKindSlug";
ALTER TABLE "CareIntakePacket"
  RENAME COLUMN "subjectId" TO "subjectRef";

ALTER INDEX "CareAppointment_organizationId_subjectType_subjectId_schedu_idx"
  RENAME TO "CareAppointment_organizationId_subjectKindSlug_subjectRef_idx";
ALTER INDEX "CareIntakePacket_organizationId_subjectType_subjectId_statu_idx"
  RENAME TO "CareIntakePacket_organizationId_subjectKindSlug_subjectRef_idx";

DROP INDEX "CareIntakeResponse_supersedesResponseId_idx";
CREATE INDEX "CareIntakeResponse_supersedesResponseId_organizationId_idx"
  ON "CareIntakeResponse"("supersedesResponseId", "organizationId");
CREATE INDEX "CareIntakeAccessGrant_patientProfileId_organizationId_idx"
  ON "CareIntakeAccessGrant"("patientProfileId", "organizationId");
CREATE INDEX "CareIntakeStatusEvent_patientProfileId_organizationId_idx"
  ON "CareIntakeStatusEvent"("patientProfileId", "organizationId");

ALTER TABLE "CareIntakeAccessGrant"
  ADD CONSTRAINT "CareIntakeAccessGrant_patientProfileId_organizationId_fkey"
  FOREIGN KEY ("patientProfileId", "organizationId")
  REFERENCES "PatientProfile"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CareIntakeStatusEvent"
  ADD CONSTRAINT "CareIntakeStatusEvent_patientProfileId_organizationId_fkey"
  FOREIGN KEY ("patientProfileId", "organizationId")
  REFERENCES "PatientProfile"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CareIntakeAccessGrant"
  VALIDATE CONSTRAINT "CareIntakeAccessGrant_patientProfileId_organizationId_fkey";
ALTER TABLE "CareIntakeStatusEvent"
  VALIDATE CONSTRAINT "CareIntakeStatusEvent_patientProfileId_organizationId_fkey";
