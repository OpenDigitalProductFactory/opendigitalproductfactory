-- BI-7111AF0C: animal intake reuses the subject-neutral CareIntakePacket family.
--
-- The patient context policy (20260717024000) admits a row only when its
-- "patientProfileId" is in app.patient_profile_ids, so a packet for a
-- non-patient subject (patientProfileId IS NULL) was unreadable and unwritable
-- under the forced row-level security these tables carry. This adds the one
-- narrowly scoped policy the animal repository needs: same-organization rows
-- whose subject is an animal profile and which carry no patient binding.
-- Patient rows are untouched; an animal row can never satisfy the patient
-- policy and a patient row can never satisfy this one.
--
-- @migration-safety: data-safe: adds RLS policies only; no rows or constraints are changed.

CREATE POLICY "CareIntakePacket_animal_subject_policy" ON "CareIntakePacket"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "subjectKindSlug" = 'animal-profile'
    AND "patientProfileId" IS NULL
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "subjectKindSlug" = 'animal-profile'
    AND "patientProfileId" IS NULL
  );

CREATE POLICY "CareIntakeException_animal_subject_policy" ON "CareIntakeException"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "patientProfileId" IS NULL
    AND EXISTS (
      SELECT 1 FROM "CareIntakePacket" p
      WHERE p."id" = "CareIntakeException"."packetId"
        AND p."organizationId" = "CareIntakeException"."organizationId"
        AND p."subjectKindSlug" = 'animal-profile'
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "patientProfileId" IS NULL
    AND EXISTS (
      SELECT 1 FROM "CareIntakePacket" p
      WHERE p."id" = "CareIntakeException"."packetId"
        AND p."organizationId" = "CareIntakeException"."organizationId"
        AND p."subjectKindSlug" = 'animal-profile'
    )
  );

CREATE POLICY "CareIntakeStatusEvent_animal_subject_policy" ON "CareIntakeStatusEvent"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "patientProfileId" IS NULL
    AND EXISTS (
      SELECT 1 FROM "CareIntakePacket" p
      WHERE p."id" = "CareIntakeStatusEvent"."packetId"
        AND p."organizationId" = "CareIntakeStatusEvent"."organizationId"
        AND p."subjectKindSlug" = 'animal-profile'
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "patientProfileId" IS NULL
    AND EXISTS (
      SELECT 1 FROM "CareIntakePacket" p
      WHERE p."id" = "CareIntakeStatusEvent"."packetId"
        AND p."organizationId" = "CareIntakeStatusEvent"."organizationId"
        AND p."subjectKindSlug" = 'animal-profile'
    )
  );
