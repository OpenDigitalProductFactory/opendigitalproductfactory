\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "CareAppointment"
    WHERE id = 'appointment-subject-fixture'
      AND "subjectKindSlug" = 'patient-profile'
      AND "subjectRef" = "patientProfileId"
      AND "recallAt" = '2027-09-01 15:00:00'
      AND "overbookAuthorizedByPrincipalId" = 'principal-subject-fixture'
      AND "overbookReason" = 'Fixture controlled overbooking'
      AND "preparationMinutes" = 10
      AND "recoveryMinutes" = 15
      AND "footprintStart" = '2026-09-01 14:50:00'
      AND "footprintEnd" = '2026-09-01 16:00:00'
  ) THEN
    RAISE EXCEPTION 'patient appointment backfill or clinical invariant changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CareIntakePacket"
    WHERE id = 'packet-subject-fixture'
      AND "subjectKindSlug" = 'patient-profile'
      AND "subjectRef" = "patientProfileId"
      AND "legalHold" = true
      AND "retentionClass" = 'restricted-care'
  ) THEN
    RAISE EXCEPTION 'patient intake backfill or lifecycle evidence changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Resource"
    WHERE "sourceRef" = 'HospitalityResource:hospitality-blocked-fixture'
      AND lifecycle = 'active'
      AND "blockedReason" = 'Repairs in progress'
      AND capacity = 4
      AND "capacityUnit" = 'seats'
  ) THEN
    RAISE EXCEPTION 'blocked hospitality resource mapping changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Resource"
    WHERE "sourceRef" = 'HospitalityResource:hospitality-unknown-fixture'
      AND lifecycle = 'archived'
      AND "lifecycleReason" = 'legacy-status:paused-by-operator'
  ) THEN
    RAISE EXCEPTION 'unknown hospitality status was not preserved visibly';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "ResourceAvailability"
    WHERE "sourceRef" =
      'HospitalityResourceAvailability:hospitality-unknown-window-fixture'
      AND "windowKind" = 'blocked'
      AND timezone = 'America/Chicago'
      AND "lifecycleReason" = 'legacy-kind:weather-hold'
      AND reason = 'Storm response; legacy-kind:weather-hold'
  ) THEN
    RAISE EXCEPTION 'unknown hospitality availability kind was not preserved';
  END IF;

  IF (
    SELECT count(*) FROM "HospitalityResource"
  ) <> (
    SELECT count(*) FROM "Resource"
    WHERE "sourceRef" LIKE 'HospitalityResource:%'
  ) THEN
    RAISE EXCEPTION 'hospitality resource row counts do not reconcile';
  END IF;

  IF (
    SELECT count(*) FROM "HospitalityResourceAvailability"
  ) <> (
    SELECT count(*) FROM "ResourceAvailability"
    WHERE "sourceRef" LIKE 'HospitalityResourceAvailability:%'
  ) THEN
    RAISE EXCEPTION 'hospitality availability row counts do not reconcile';
  END IF;
END $$;

-- Exercise both discriminator branches inside a transaction that rolls back.
BEGIN;

INSERT INTO "CareAppointment" (
  id, "appointmentId", "organizationId", "subjectKindSlug", "subjectRef",
  "patientProfileId", "visitTypeId", "locationId", "scheduledStart",
  "scheduledEnd", "preparationMinutes", "recoveryMinutes", "footprintStart",
  "footprintEnd", version, "createdByPrincipalId", "createdAt", "updatedAt"
) VALUES (
  'appointment-animal-fixture', 'CAP-ANIMAL-FIXTURE', 'org-subject-fixture',
  'animal', 'animal-fixture', NULL, NULL, NULL,
  '2026-09-02 15:00:00', '2026-09-02 15:45:00', 10, 15,
  '2026-09-02 14:50:00', '2026-09-02 16:00:00', 1,
  'principal-subject-fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "CareIntakePacket" (
  id, "packetId", "organizationId", "subjectKindSlug", "subjectRef",
  "patientProfileId", "sourceMode", "purposeOfUse", "requirementSnapshot",
  "recordedByPrincipalId", "createdAt", "updatedAt"
) VALUES (
  'packet-animal-fixture', 'CIP-ANIMAL-FIXTURE', 'org-subject-fixture',
  'animal', 'animal-fixture', NULL, 'staff-assisted', 'animal-care',
  '[]'::jsonb, 'principal-subject-fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

DO $$
BEGIN
  BEGIN
    UPDATE "CareAppointment"
    SET "subjectRef" = 'wrong-patient'
    WHERE id = 'appointment-subject-fixture';
    RAISE EXCEPTION 'patient appointment mismatch was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE "CareAppointment"
    SET "subjectKindSlug" = 'animal', "subjectRef" = 'animal-fixture'
    WHERE id = 'appointment-subject-fixture';
    RAISE EXCEPTION 'non-patient appointment retained a patient relation';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE "CareAppointment"
    SET "visitTypeId" = NULL
    WHERE id = 'appointment-subject-fixture';
    RAISE EXCEPTION 'patient appointment without visit type was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

ROLLBACK;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'CareIntakePacket'
      AND policyname = 'CareIntakePacket_context_policy'
      AND qual LIKE '%app.patient_profile_ids%'
  ) THEN
    RAISE EXCEPTION 'patient-context intake RLS policy is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'CareIntakePacket'
      AND cmd = 'SELECT'
      AND qual LIKE '%app.care_intake_access_purpose%'
  ) THEN
    RAISE EXCEPTION 'purpose-bound staff intake RLS policy is missing';
  END IF;
END $$;
