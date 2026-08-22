-- BI-2C80E6EA — subject-agnostic scheduling and canonical hospitality resources.
--
-- @migration-safety: data-safe. This is an expand/backfill/constrain migration.
-- It preserves every Care* table, clinical scheduling field, evidence row,
-- compatibility projection, RLS policy, retention field, and legal-hold field.
-- Existing care roots are backfilled as patient-profile subjects before the
-- new identity columns become required. Hospitality clones remain in place and
-- are copied idempotently into the W19 canonical Resource family by sourceRef.
--
-- Rollback is forward-only. Application code may revert while all roots remain
-- patient-profile; restoring the former NOT NULL clinical columns first requires
-- a preflight proving no non-patient root exists. Canonical hospitality copies
-- may be removed by their Hospitality* sourceRef only while clone rows remain.

-- ── Subject identity: expand, backfill, reconcile, constrain ────────────────
ALTER TABLE "CareAppointment"
  ADD COLUMN "subjectType" TEXT,
  ADD COLUMN "subjectId" TEXT;

ALTER TABLE "CareIntakePacket"
  ADD COLUMN "subjectType" TEXT,
  ADD COLUMN "subjectId" TEXT;

UPDATE "CareAppointment" SET "subjectType" = 'patient-profile',
  "subjectId" = "patientProfileId"
WHERE "subjectType" IS NULL OR "subjectId" IS NULL;

UPDATE "CareIntakePacket" SET "subjectType" = 'patient-profile',
  "subjectId" = "patientProfileId"
WHERE "subjectType" IS NULL OR "subjectId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CareAppointment"
    WHERE "subjectType" IS NULL OR "subjectId" IS NULL
  ) THEN
    RAISE EXCEPTION 'CareAppointment subject backfill incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CareIntakePacket"
    WHERE "subjectType" IS NULL OR "subjectId" IS NULL
  ) THEN
    RAISE EXCEPTION 'CareIntakePacket subject backfill incomplete';
  END IF;
END $$;

ALTER TABLE "CareAppointment" ALTER COLUMN "subjectType" SET NOT NULL;
ALTER TABLE "CareAppointment" ALTER COLUMN "subjectId" SET NOT NULL;
ALTER TABLE "CareIntakePacket" ALTER COLUMN "subjectType" SET NOT NULL;
ALTER TABLE "CareIntakePacket" ALTER COLUMN "subjectId" SET NOT NULL;

-- Patient-backed writes retain the complete clinical tuple. Non-patient rows
-- cannot accidentally point at a PatientProfile. Recall, overbooking approval,
-- and preparation/recovery footprint columns are deliberately untouched.
ALTER TABLE "CareAppointment"
  ALTER COLUMN "patientProfileId" DROP NOT NULL,
  ALTER COLUMN "visitTypeId" DROP NOT NULL,
  ALTER COLUMN "locationId" DROP NOT NULL;

ALTER TABLE "CareAppointment"
  ADD CONSTRAINT "CareAppointment_subject_contract_check"
  CHECK (
    char_length("subjectType") BETWEEN 1 AND 63
    AND "subjectType" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND char_length(btrim("subjectId")) > 0
    AND (
      (
        "subjectType" = 'patient-profile'
        AND "patientProfileId" IS NOT NULL
        AND "visitTypeId" IS NOT NULL
        AND "locationId" IS NOT NULL
        AND "subjectId" = "patientProfileId"
      )
      OR (
        "subjectType" <> 'patient-profile'
        AND "patientProfileId" IS NULL
      )
    )
  ) NOT VALID;
ALTER TABLE "CareAppointment"
  VALIDATE CONSTRAINT "CareAppointment_subject_contract_check";

ALTER TABLE "CareIntakePacket" ALTER COLUMN "patientProfileId" DROP NOT NULL;
ALTER TABLE "CareIntakePacket"
  ADD CONSTRAINT "CareIntakePacket_subject_contract_check"
  CHECK (
    char_length("subjectType") BETWEEN 1 AND 63
    AND "subjectType" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND char_length(btrim("subjectId")) > 0
    AND (
      (
        "subjectType" = 'patient-profile'
        AND "patientProfileId" IS NOT NULL
        AND "subjectId" = "patientProfileId"
      )
      OR (
        "subjectType" <> 'patient-profile'
        AND "patientProfileId" IS NULL
      )
    )
  ) NOT VALID;
ALTER TABLE "CareIntakePacket"
  VALIDATE CONSTRAINT "CareIntakePacket_subject_contract_check";

CREATE INDEX "CareAppointment_organizationId_subjectType_subjectId_schedu_idx"
  ON "CareAppointment"("organizationId", "subjectType", "subjectId", "scheduledStart");
CREATE INDEX "CareIntakePacket_organizationId_subjectType_subjectId_statu_idx"
  ON "CareIntakePacket"("organizationId", "subjectType", "subjectId", "status");

-- ── Generic intake packet joins; patient-specific branches stay composite ──
CREATE UNIQUE INDEX "CareIntakePacket_id_organizationId_key"
  ON "CareIntakePacket"("id", "organizationId");
CREATE UNIQUE INDEX "CareIntakeResponse_id_organizationId_key"
  ON "CareIntakeResponse"("id", "organizationId");

ALTER TABLE "CareIntakeAccessGrant"
  DROP CONSTRAINT "CareIntakeAccessGrant_packetId_organizationId_patientProfi_fkey";
ALTER TABLE "CareIntakeException"
  DROP CONSTRAINT "CareIntakeException_packetId_organizationId_patientProfile_fkey";
ALTER TABLE "CareIntakeResponse"
  DROP CONSTRAINT "CareIntakeResponse_packetId_organizationId_patientProfileI_fkey";
ALTER TABLE "CareIntakeResponse"
  DROP CONSTRAINT "CareIntakeResponse_supersedesResponseId_organizationId_pat_fkey";
ALTER TABLE "CareIntakeStatusEvent"
  DROP CONSTRAINT "CareIntakeStatusEvent_packetId_organizationId_patientProfi_fkey";

ALTER TABLE "CareIntakeAccessGrant" ALTER COLUMN "patientProfileId" DROP NOT NULL;
ALTER TABLE "CareIntakeException" ALTER COLUMN "patientProfileId" DROP NOT NULL;
ALTER TABLE "CareIntakeResponse" ALTER COLUMN "patientProfileId" DROP NOT NULL;
ALTER TABLE "CareIntakeStatusEvent" ALTER COLUMN "patientProfileId" DROP NOT NULL;

ALTER TABLE "CareIntakeResponse"
  ADD CONSTRAINT "CareIntakeResponse_packetId_organizationId_fkey"
  FOREIGN KEY ("packetId", "organizationId")
  REFERENCES "CareIntakePacket"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CareIntakeResponse"
  ADD CONSTRAINT "CareIntakeResponse_supersedesResponseId_organizationId_fkey"
  FOREIGN KEY ("supersedesResponseId", "organizationId")
  REFERENCES "CareIntakeResponse"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CareIntakeAccessGrant"
  ADD CONSTRAINT "CareIntakeAccessGrant_packetId_organizationId_fkey"
  FOREIGN KEY ("packetId", "organizationId")
  REFERENCES "CareIntakePacket"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CareIntakeException"
  ADD CONSTRAINT "CareIntakeException_packetId_organizationId_fkey"
  FOREIGN KEY ("packetId", "organizationId")
  REFERENCES "CareIntakePacket"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CareIntakeStatusEvent"
  ADD CONSTRAINT "CareIntakeStatusEvent_packetId_organizationId_fkey"
  FOREIGN KEY ("packetId", "organizationId")
  REFERENCES "CareIntakePacket"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CareIntakeResponse"
  VALIDATE CONSTRAINT "CareIntakeResponse_packetId_organizationId_fkey";
ALTER TABLE "CareIntakeResponse"
  VALIDATE CONSTRAINT "CareIntakeResponse_supersedesResponseId_organizationId_fkey";
ALTER TABLE "CareIntakeAccessGrant"
  VALIDATE CONSTRAINT "CareIntakeAccessGrant_packetId_organizationId_fkey";
ALTER TABLE "CareIntakeException"
  VALIDATE CONSTRAINT "CareIntakeException_packetId_organizationId_fkey";
ALTER TABLE "CareIntakeStatusEvent"
  VALIDATE CONSTRAINT "CareIntakeStatusEvent_packetId_organizationId_fkey";

-- CareConsentAttestation and CareCoverageEvidence deliberately retain their
-- packet + organization + patientProfile composite foreign keys.

-- ── Hospitality clone → canonical Resource reconciliation ──────────────────
INSERT INTO "Resource" (
  "id", "resourceKey", "organizationId", "storefrontId", "domain",
  "kindSlug", "label", "capacity", "capacityUnit", "serviceArea",
  "blockedReason", "attributes", "subjectRef", "sourceRef", "lifecycle",
  "lifecycleAt", "lifecycleReason", "version", "createdAt", "updatedAt"
)
SELECT
  'resource_hospitality_' || md5(legacy.id),
  legacy."resourceId",
  legacy."organizationId",
  legacy."storefrontId",
  'hospitality'::"ResourceDomain",
  legacy.kind,
  legacy.label,
  legacy.capacity,
  legacy."capacityUnit",
  legacy."serviceArea",
  legacy."blockedReason",
  legacy.attributes,
  CASE WHEN legacy."legacyServiceProviderId" IS NULL THEN NULL
    ELSE 'ServiceProvider:' || legacy."legacyServiceProviderId" END,
  'HospitalityResource:' || legacy.id,
  CASE legacy.status
    WHEN 'active' THEN 'active'::"RecordLifecycle"
    WHEN 'blocked' THEN 'active'::"RecordLifecycle"
    WHEN 'retired' THEN 'retired'::"RecordLifecycle"
    WHEN 'archived' THEN 'archived'::"RecordLifecycle"
    ELSE 'archived'::"RecordLifecycle"
  END,
  NULL,
  CASE WHEN legacy.status IN ('active', 'blocked', 'retired', 'archived')
    THEN NULL ELSE 'legacy-status:' || legacy.status END,
  legacy.version,
  legacy."createdAt",
  legacy."updatedAt"
FROM "HospitalityResource" legacy
ON CONFLICT ("sourceRef") DO UPDATE SET
  "resourceKey" = EXCLUDED."resourceKey",
  "organizationId" = EXCLUDED."organizationId",
  "storefrontId" = EXCLUDED."storefrontId",
  "kindSlug" = EXCLUDED."kindSlug",
  "label" = EXCLUDED."label",
  "capacity" = EXCLUDED."capacity",
  "capacityUnit" = EXCLUDED."capacityUnit",
  "serviceArea" = EXCLUDED."serviceArea",
  "blockedReason" = EXCLUDED."blockedReason",
  "attributes" = EXCLUDED."attributes",
  "subjectRef" = EXCLUDED."subjectRef",
  "lifecycle" = EXCLUDED."lifecycle",
  "lifecycleReason" = EXCLUDED."lifecycleReason",
  "version" = EXCLUDED."version",
  "updatedAt" = EXCLUDED."updatedAt";

INSERT INTO "ResourceAvailability" (
  "id", "organizationId", "resourceId", "windowKind", "days",
  "startTime", "endTime", "timezone", "date", "startsAt", "endsAt",
  "reason", "sourceRef", "lifecycle", "lifecycleAt", "lifecycleReason",
  "version", "createdAt", "updatedAt"
)
SELECT
  'resource_availability_hospitality_' || md5(legacy.id),
  legacy."organizationId",
  canonical.id,
  CASE WHEN legacy.kind = 'available' THEN 'available'::"AvailabilityWindowKind"
    ELSE 'blocked'::"AvailabilityWindowKind" END,
  legacy.days,
  legacy."startTime",
  legacy."endTime",
  storefront.timezone,
  legacy.date,
  legacy."startsAt",
  legacy."endsAt",
  CASE WHEN legacy.kind IN ('available', 'blocked') THEN legacy.reason
    ELSE COALESCE(legacy.reason || '; ', '') || 'legacy-kind:' || legacy.kind END,
  'HospitalityResourceAvailability:' || legacy.id,
  'active'::"RecordLifecycle",
  NULL,
  CASE WHEN legacy.kind IN ('available', 'blocked') THEN NULL
    ELSE 'legacy-kind:' || legacy.kind END,
  legacy.version,
  legacy."createdAt",
  legacy."updatedAt"
FROM "HospitalityResourceAvailability" legacy
JOIN "HospitalityResource" owner ON owner.id = legacy."resourceId"
  AND owner."organizationId" = legacy."organizationId"
JOIN "Resource" canonical
  ON canonical."sourceRef" = 'HospitalityResource:' || owner.id
JOIN "StorefrontConfig" storefront ON storefront.id = owner."storefrontId"
  AND storefront."organizationId" = owner."organizationId"
ON CONFLICT ("sourceRef") DO UPDATE SET
  "organizationId" = EXCLUDED."organizationId",
  "resourceId" = EXCLUDED."resourceId",
  "windowKind" = EXCLUDED."windowKind",
  "days" = EXCLUDED."days",
  "startTime" = EXCLUDED."startTime",
  "endTime" = EXCLUDED."endTime",
  "timezone" = EXCLUDED."timezone",
  "date" = EXCLUDED."date",
  "startsAt" = EXCLUDED."startsAt",
  "endsAt" = EXCLUDED."endsAt",
  "reason" = EXCLUDED."reason",
  "lifecycle" = EXCLUDED."lifecycle",
  "lifecycleReason" = EXCLUDED."lifecycleReason",
  "version" = EXCLUDED."version",
  "updatedAt" = EXCLUDED."updatedAt";

DO $$
DECLARE
  legacy_resources BIGINT;
  canonical_resources BIGINT;
  legacy_availability BIGINT;
  canonical_availability BIGINT;
BEGIN
  SELECT count(*) INTO legacy_resources FROM "HospitalityResource";
  SELECT count(*) INTO canonical_resources FROM "Resource"
    WHERE "sourceRef" LIKE 'HospitalityResource:%';
  IF legacy_resources <> canonical_resources THEN
    RAISE EXCEPTION
      'hospitality resource reconciliation failed: legacy %, canonical %',
      legacy_resources, canonical_resources;
  END IF;

  SELECT count(*) INTO legacy_availability FROM "HospitalityResourceAvailability";
  SELECT count(*) INTO canonical_availability FROM "ResourceAvailability"
    WHERE "sourceRef" LIKE 'HospitalityResourceAvailability:%';
  IF legacy_availability <> canonical_availability THEN
    RAISE EXCEPTION
      'hospitality availability reconciliation failed: legacy %, canonical %',
      legacy_availability, canonical_availability;
  END IF;
END $$;
