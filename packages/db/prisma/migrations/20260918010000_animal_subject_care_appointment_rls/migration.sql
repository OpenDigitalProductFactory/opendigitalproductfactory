-- BI-97290291: veterinary appointments for animals reuse CareAppointment.
--
-- The patient context policy admits a row only when its patientProfileId
-- resolves to a same-organization PatientProfile, so an animal appointment
-- (patientProfileId IS NULL, subjectKindSlug 'animal-profile') was unreadable
-- and unwritable under the forced row-level security these tables carry. This
-- adds the narrowly scoped animal-subject policy to CareAppointment and its
-- status-event table. Patient rows are untouched: an animal row can never
-- satisfy the patient policy and a patient row can never satisfy this one.
--
-- @migration-safety: data-safe: adds RLS policies only; no rows or constraints are changed.

CREATE POLICY "CareAppointment_animal_subject_policy" ON "CareAppointment"
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

CREATE POLICY "CareAppointmentStatusEvent_animal_subject_policy" ON "CareAppointmentStatusEvent"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" a
      WHERE a."id" = "CareAppointmentStatusEvent"."appointmentId"
        AND a."organizationId" = "CareAppointmentStatusEvent"."organizationId"
        AND a."subjectKindSlug" = 'animal-profile'
        AND a."patientProfileId" IS NULL
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" a
      WHERE a."id" = "CareAppointmentStatusEvent"."appointmentId"
        AND a."organizationId" = "CareAppointmentStatusEvent"."organizationId"
        AND a."subjectKindSlug" = 'animal-profile'
        AND a."patientProfileId" IS NULL
    )
  );
