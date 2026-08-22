-- Representative populated state immediately before
-- 20260822164000_subject_agnostic_scheduling_and_resources.
INSERT INTO "Organization" (
  id, "orgId", name, slug, "updatedAt"
) VALUES (
  'org-subject-fixture', 'ORG-SUBJECT-FIXTURE', 'Subject Fixture',
  'subject-fixture', CURRENT_TIMESTAMP
);

INSERT INTO "Principal" (
  id, "principalId", kind, "displayName", "updatedAt"
) VALUES (
  'principal-subject-fixture', 'PRN-SUBJECT-FIXTURE', 'human',
  'Subject Fixture Recorder', CURRENT_TIMESTAMP
);

INSERT INTO "PatientProfile" (
  id, "patientId", "organizationId", "principalId", "recordedByPrincipalId",
  "updatedAt"
) VALUES (
  'patient-subject-fixture', 'PAT-SUBJECT-FIXTURE', 'org-subject-fixture',
  'principal-subject-fixture', 'principal-subject-fixture', CURRENT_TIMESTAMP
);

INSERT INTO "CareVisitType" (
  id, "visitTypeId", "organizationId", code, name,
  "defaultDurationMinutes", "preparationMinutes", "recoveryMinutes", "updatedAt"
) VALUES (
  'visit-subject-fixture', 'CVT-SUBJECT-FIXTURE', 'org-subject-fixture',
  'fixture-checkup', 'Fixture checkup', 45, 10, 15, CURRENT_TIMESTAMP
);

INSERT INTO "CareLocation" (
  id, "locationId", "organizationId", code, name, timezone, "updatedAt"
) VALUES (
  'location-subject-fixture', 'LOC-SUBJECT-FIXTURE', 'org-subject-fixture',
  'fixture-room', 'Fixture room', 'America/Chicago', CURRENT_TIMESTAMP
);

INSERT INTO "CareAppointment" (
  id, "appointmentId", "organizationId", "patientProfileId", "visitTypeId",
  "locationId", "scheduledStart", "scheduledEnd", "preparationMinutes",
  "recoveryMinutes", "footprintStart", "footprintEnd", "recallAt",
  "overbookAuthorizedByPrincipalId", "overbookReason", "createdByPrincipalId",
  "updatedAt"
) VALUES (
  'appointment-subject-fixture', 'CAP-SUBJECT-FIXTURE', 'org-subject-fixture',
  'patient-subject-fixture', 'visit-subject-fixture', 'location-subject-fixture',
  '2026-09-01 15:00:00', '2026-09-01 15:45:00', 10, 15,
  '2026-09-01 14:50:00', '2026-09-01 16:00:00', '2027-09-01 15:00:00',
  'principal-subject-fixture', 'Fixture controlled overbooking',
  'principal-subject-fixture', CURRENT_TIMESTAMP
);

INSERT INTO "CareIntakePacket" (
  id, "packetId", "organizationId", "patientProfileId", "appointmentId",
  "sourceMode", "purposeOfUse", "requirementSnapshot", "recordedByPrincipalId",
  "retentionClass", "legalHold", "updatedAt"
) VALUES (
  'packet-subject-fixture', 'CIP-SUBJECT-FIXTURE', 'org-subject-fixture',
  'patient-subject-fixture', 'appointment-subject-fixture', 'staff-assisted',
  'care-delivery', '[]'::jsonb, 'principal-subject-fixture',
  'restricted-care', true, CURRENT_TIMESTAMP
);

INSERT INTO "StorefrontArchetype" (
  id, "archetypeId", name, category, "ctaType", "itemTemplates",
  "sectionTemplates", "formSchema", "updatedAt"
) VALUES (
  'archetype-subject-fixture', 'ARCH-SUBJECT-FIXTURE', 'Fixture Restaurant',
  'food-hospitality', 'book', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  CURRENT_TIMESTAMP
);

INSERT INTO "StorefrontConfig" (
  id, "organizationId", "archetypeId", timezone, "updatedAt"
) VALUES (
  'storefront-subject-fixture', 'org-subject-fixture',
  'archetype-subject-fixture', 'America/Chicago', CURRENT_TIMESTAMP
);

INSERT INTO "HospitalityResource" (
  id, "resourceId", "organizationId", "storefrontId", kind, label, status,
  capacity, "capacityUnit", "blockedReason", attributes, version, "updatedAt"
) VALUES
  (
    'hospitality-blocked-fixture', 'table-blocked', 'org-subject-fixture',
    'storefront-subject-fixture', 'table', 'Blocked table', 'blocked', 4,
    'seats', 'Repairs in progress', '{"shape":"round"}'::jsonb, 3,
    CURRENT_TIMESTAMP
  ),
  (
    'hospitality-unknown-fixture', 'table-unknown', 'org-subject-fixture',
    'storefront-subject-fixture', 'table', 'Unknown-state table',
    'paused-by-operator', 6, 'seats', NULL, '{"shape":"rectangle"}'::jsonb,
    2, CURRENT_TIMESTAMP
  );

INSERT INTO "HospitalityResourceAvailability" (
  id, "availabilityId", "organizationId", "resourceId", kind, days,
  "startTime", "endTime", reason, version, "updatedAt"
) VALUES
  (
    'hospitality-availability-fixture', 'HRA-SUBJECT-FIXTURE-1',
    'org-subject-fixture', 'hospitality-blocked-fixture', 'available',
    ARRAY[1,2,3,4,5], '11:00', '22:00', NULL, 1, CURRENT_TIMESTAMP
  ),
  (
    'hospitality-unknown-window-fixture', 'HRA-SUBJECT-FIXTURE-2',
    'org-subject-fixture', 'hospitality-unknown-fixture', 'weather-hold',
    ARRAY[]::INTEGER[], '00:00', '23:59', 'Storm response', 2,
    CURRENT_TIMESTAMP
  );
