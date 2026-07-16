-- BI-HEALTHCARE-010: tenant-safe, multi-resource care appointment authority.
--
-- Fleet safety: StorefrontBooking.organizationId uses expand -> backfill ->
-- assert -> contract. New tables are empty when their constraints land.
-- Existing booking rows are preserved and resolved through their canonical
-- StorefrontConfig.organizationId; no booking state is rewritten.
-- @migration-safety: data-safe: StorefrontBooking ownership is backfilled and
-- asserted non-null before its NOT NULL, unique, and FK constraints land; every
-- other tightening constraint applies only to newly created empty tables.

ALTER TABLE "StorefrontBooking"
  ADD COLUMN "organizationId" TEXT;

UPDATE "StorefrontBooking" booking
SET "organizationId" = storefront."organizationId"
FROM "StorefrontConfig" storefront
WHERE storefront.id = booking."storefrontId"
  AND booking."organizationId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "StorefrontBooking" WHERE "organizationId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'StorefrontBooking organization backfill incomplete; repair orphaned storefront references before retrying';
  END IF;
END $$;

ALTER TABLE "StorefrontBooking"
  ALTER COLUMN "organizationId" SET NOT NULL;

CREATE UNIQUE INDEX "StorefrontBooking_id_organizationId_key"
  ON "StorefrontBooking"("id", "organizationId");
CREATE INDEX "StorefrontBooking_organizationId_status_scheduledAt_idx"
  ON "StorefrontBooking"("organizationId", "status", "scheduledAt");

ALTER TABLE "StorefrontBooking"
  ADD CONSTRAINT "StorefrontBooking_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CareVisitType" (
  "id" TEXT NOT NULL,
  "visitTypeId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "codeSystem" TEXT,
  "codeVersion" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "defaultDurationMinutes" INTEGER NOT NULL,
  "preparationMinutes" INTEGER NOT NULL DEFAULT 0,
  "recoveryMinutes" INTEGER NOT NULL DEFAULT 0,
  "defaultRecallIntervalDays" INTEGER,
  "mode" TEXT NOT NULL DEFAULT 'in-person',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareVisitType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareVisitType_duration_check"
    CHECK ("defaultDurationMinutes" > 0),
  CONSTRAINT "CareVisitType_buffers_check"
    CHECK ("preparationMinutes" >= 0 AND "recoveryMinutes" >= 0),
  CONSTRAINT "CareVisitType_recall_check"
    CHECK ("defaultRecallIntervalDays" IS NULL OR "defaultRecallIntervalDays" > 0),
  CONSTRAINT "CareVisitType_mode_check"
    CHECK ("mode" IN ('in-person', 'virtual', 'home-visit'))
);

CREATE TABLE "CareLocation" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "address" JSONB,
  "accessibilityNotes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareResource" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareResource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareResource_type_check"
    CHECK ("resourceType" IN ('room', 'equipment')),
  CONSTRAINT "CareResource_capacity_check" CHECK ("capacity" > 0)
);

CREATE TABLE "CareSchedulingPolicy" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "locationId" TEXT,
  "allowControlledOverbooking" BOOLEAN NOT NULL DEFAULT false,
  "maxConcurrentAppointments" INTEGER NOT NULL DEFAULT 1,
  "requiresHumanApproval" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareSchedulingPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareSchedulingPolicy_max_concurrent_check"
    CHECK ("maxConcurrentAppointments" > 0),
  CONSTRAINT "CareSchedulingPolicy_effective_window_check"
    CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);

CREATE TABLE "CareAppointment" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontBookingId" TEXT,
  "patientProfileId" TEXT NOT NULL,
  "visitTypeId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "scheduledEnd" TIMESTAMP(3) NOT NULL,
  "preparationMinutes" INTEGER NOT NULL DEFAULT 0,
  "recoveryMinutes" INTEGER NOT NULL DEFAULT 0,
  "footprintStart" TIMESTAMP(3) NOT NULL,
  "footprintEnd" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "recurrenceScheduleId" TEXT,
  "recallAt" TIMESTAMP(3),
  "rescheduledFromAppointmentId" TEXT,
  "encounterRef" TEXT,
  "overbookAuthorizedByPrincipalId" TEXT,
  "overbookReason" TEXT,
  "cancellationReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "enteredInErrorAt" TIMESTAMP(3),
  "createdByPrincipalId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareAppointment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareAppointment_status_check" CHECK (
    "status" IN (
      'proposed', 'pending', 'booked', 'arrived', 'fulfilled',
      'no-show', 'cancelled', 'entered-in-error'
    )
  ),
  CONSTRAINT "CareAppointment_version_check" CHECK ("version" > 0),
  CONSTRAINT "CareAppointment_window_check" CHECK (
    "scheduledEnd" > "scheduledStart"
    AND "footprintStart" <= "scheduledStart"
    AND "footprintEnd" >= "scheduledEnd"
  ),
  CONSTRAINT "CareAppointment_buffers_check" CHECK (
    "preparationMinutes" >= 0 AND "recoveryMinutes" >= 0
  ),
  CONSTRAINT "CareAppointment_overbook_evidence_check" CHECK (
    (
      "overbookAuthorizedByPrincipalId" IS NULL
      AND "overbookReason" IS NULL
    )
    OR (
      "overbookAuthorizedByPrincipalId" IS NOT NULL
      AND length(trim("overbookReason")) > 0
    )
  ),
  CONSTRAINT "CareAppointment_cancelled_state_check" CHECK (
    ("status" = 'cancelled' AND "cancelledAt" IS NOT NULL)
    OR "status" <> 'cancelled'
  ),
  CONSTRAINT "CareAppointment_entered_error_state_check" CHECK (
    ("status" = 'entered-in-error' AND "enteredInErrorAt" IS NOT NULL)
    OR "status" <> 'entered-in-error'
  ),
  CONSTRAINT "CareAppointment_no_self_reschedule_check" CHECK (
    "rescheduledFromAppointmentId" IS NULL
    OR "rescheduledFromAppointmentId" <> "id"
  )
);

CREATE TABLE "CareAppointmentParticipant" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "participationStatus" TEXT NOT NULL DEFAULT 'needs-action',
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "allocationState" TEXT NOT NULL DEFAULT 'active',
  "footprintStart" TIMESTAMP(3) NOT NULL,
  "footprintEnd" TIMESTAMP(3) NOT NULL,
  "overbooked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareAppointmentParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareAppointmentParticipant_role_check" CHECK (
    "role" IN (
      'primary-practitioner', 'practitioner', 'nurse',
      'dental-hygienist', 'assistant', 'observer'
    )
  ),
  CONSTRAINT "CareAppointmentParticipant_participation_status_check" CHECK (
    "participationStatus" IN (
      'needs-action', 'accepted', 'declined', 'tentative'
    )
  ),
  CONSTRAINT "CareAppointmentParticipant_state_check"
    CHECK ("allocationState" IN ('active', 'released', 'cancelled')),
  CONSTRAINT "CareAppointmentParticipant_window_check"
    CHECK ("footprintEnd" > "footprintStart")
);

CREATE TABLE "CareAppointmentResource" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "allocationState" TEXT NOT NULL DEFAULT 'active',
  "footprintStart" TIMESTAMP(3) NOT NULL,
  "footprintEnd" TIMESTAMP(3) NOT NULL,
  "overbooked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareAppointmentResource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareAppointmentResource_state_check"
    CHECK ("allocationState" IN ('active', 'released', 'cancelled')),
  CONSTRAINT "CareAppointmentResource_window_check"
    CHECK ("footprintEnd" > "footprintStart")
);

CREATE TABLE "CareAppointmentStatusEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "appointmentVersion" INTEGER NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "reason" TEXT,
  "actorPrincipalId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareAppointmentStatusEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CareAppointmentStatusEvent_version_check"
    CHECK ("appointmentVersion" > 0),
  CONSTRAINT "CareAppointmentStatusEvent_from_status_check" CHECK (
    "fromStatus" IS NULL OR "fromStatus" IN (
      'proposed', 'pending', 'booked', 'arrived', 'fulfilled',
      'no-show', 'cancelled', 'entered-in-error'
    )
  ),
  CONSTRAINT "CareAppointmentStatusEvent_to_status_check" CHECK (
    "toStatus" IN (
      'proposed', 'pending', 'booked', 'arrived', 'fulfilled',
      'no-show', 'cancelled', 'entered-in-error'
    )
  )
);

CREATE TABLE "AppointmentSyncEvent" (
  "id" TEXT NOT NULL,
  "syncEventId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "storefrontBookingId" TEXT,
  "correlationId" TEXT NOT NULL,
  "sourceChannel" TEXT NOT NULL,
  "requestedTransition" TEXT,
  "sourceVersion" TEXT,
  "expectedVersion" INTEGER,
  "resultingVersion" INTEGER,
  "outcome" TEXT NOT NULL,
  "conflictCode" TEXT,
  "detail" JSONB,
  "actorType" TEXT NOT NULL,
  "actorRef" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentSyncEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentSyncEvent_outcome_check"
    CHECK ("outcome" IN ('applied', 'duplicate', 'conflict', 'rejected')),
  CONSTRAINT "AppointmentSyncEvent_versions_check" CHECK (
    ("expectedVersion" IS NULL OR "expectedVersion" > 0)
    AND ("resultingVersion" IS NULL OR "resultingVersion" > 0)
  )
);

CREATE UNIQUE INDEX "CareVisitType_visitTypeId_key"
  ON "CareVisitType"("visitTypeId");
CREATE UNIQUE INDEX "CareVisitType_organizationId_code_key"
  ON "CareVisitType"("organizationId", "code");
CREATE UNIQUE INDEX "CareVisitType_id_organizationId_key"
  ON "CareVisitType"("id", "organizationId");
CREATE INDEX "CareVisitType_organizationId_isActive_idx"
  ON "CareVisitType"("organizationId", "isActive");

CREATE UNIQUE INDEX "CareLocation_locationId_key"
  ON "CareLocation"("locationId");
CREATE UNIQUE INDEX "CareLocation_organizationId_code_key"
  ON "CareLocation"("organizationId", "code");
CREATE UNIQUE INDEX "CareLocation_id_organizationId_key"
  ON "CareLocation"("id", "organizationId");
CREATE INDEX "CareLocation_organizationId_isActive_idx"
  ON "CareLocation"("organizationId", "isActive");

CREATE UNIQUE INDEX "CareResource_resourceId_key"
  ON "CareResource"("resourceId");
CREATE UNIQUE INDEX "CareResource_organizationId_code_key"
  ON "CareResource"("organizationId", "code");
CREATE UNIQUE INDEX "CareResource_id_organizationId_key"
  ON "CareResource"("id", "organizationId");
CREATE INDEX "CareResource_organizationId_locationId_isActive_idx"
  ON "CareResource"("organizationId", "locationId", "isActive");

CREATE UNIQUE INDEX "CareSchedulingPolicy_policyId_key"
  ON "CareSchedulingPolicy"("policyId");
CREATE UNIQUE INDEX "CareSchedulingPolicy_organizationId_locationId_key"
  ON "CareSchedulingPolicy"("organizationId", "locationId");
CREATE INDEX "CareSchedulingPolicy_organizationId_isActive_idx"
  ON "CareSchedulingPolicy"("organizationId", "isActive");

CREATE UNIQUE INDEX "CareAppointment_appointmentId_key"
  ON "CareAppointment"("appointmentId");
CREATE UNIQUE INDEX "CareAppointment_storefrontBookingId_key"
  ON "CareAppointment"("storefrontBookingId");
CREATE UNIQUE INDEX "CareAppointment_id_organizationId_key"
  ON "CareAppointment"("id", "organizationId");
CREATE UNIQUE INDEX "CareAppointment_storefrontBookingId_organizationId_key"
  ON "CareAppointment"("storefrontBookingId", "organizationId");
CREATE INDEX "CareAppointment_organizationId_patientProfileId_scheduled_idx"
  ON "CareAppointment"("organizationId", "patientProfileId", "scheduledStart");
CREATE INDEX "CareAppointment_organizationId_locationId_scheduledStart_idx"
  ON "CareAppointment"("organizationId", "locationId", "scheduledStart");
CREATE INDEX "CareAppointment_organizationId_status_scheduledStart_idx"
  ON "CareAppointment"("organizationId", "status", "scheduledStart");
CREATE INDEX "CareAppointment_recallAt_idx"
  ON "CareAppointment"("recallAt");
CREATE INDEX "CareAppointment_rescheduledFromAppointmentId_idx"
  ON "CareAppointment"("rescheduledFromAppointmentId");

CREATE UNIQUE INDEX "CareAppointmentParticipant_appointmentId_providerId_key"
  ON "CareAppointmentParticipant"("appointmentId", "providerId");
CREATE INDEX "CareAppointmentParticipant_organizationId_providerId_foot_idx"
  ON "CareAppointmentParticipant"(
    "organizationId", "providerId", "footprintStart"
  );

CREATE UNIQUE INDEX "CareAppointmentResource_appointmentId_resourceId_key"
  ON "CareAppointmentResource"("appointmentId", "resourceId");
CREATE INDEX "CareAppointmentResource_organizationId_resourceId_footprin_idx"
  ON "CareAppointmentResource"(
    "organizationId", "resourceId", "footprintStart"
  );

CREATE UNIQUE INDEX "CareAppointmentStatusEvent_eventId_key"
  ON "CareAppointmentStatusEvent"("eventId");
CREATE UNIQUE INDEX "CareAppointmentStatusEvent_org_appointment_version_key"
  ON "CareAppointmentStatusEvent"(
    "organizationId", "appointmentId", "appointmentVersion"
  );
CREATE INDEX "CareAppointmentStatusEvent_org_appointment_occurred_idx"
  ON "CareAppointmentStatusEvent"(
    "organizationId", "appointmentId", "occurredAt"
  );

CREATE UNIQUE INDEX "AppointmentSyncEvent_syncEventId_key"
  ON "AppointmentSyncEvent"("syncEventId");
CREATE UNIQUE INDEX "AppointmentSyncEvent_organizationId_correlationId_key"
  ON "AppointmentSyncEvent"("organizationId", "correlationId");
CREATE INDEX "AppointmentSyncEvent_org_appointment_occurred_idx"
  ON "AppointmentSyncEvent"(
    "organizationId", "appointmentId", "occurredAt"
  );
CREATE INDEX "AppointmentSyncEvent_org_outcome_occurred_idx"
  ON "AppointmentSyncEvent"("organizationId", "outcome", "occurredAt");

ALTER TABLE "CareVisitType"
  ADD CONSTRAINT "CareVisitType_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareLocation"
  ADD CONSTRAINT "CareLocation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareResource"
  ADD CONSTRAINT "CareResource_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareResource_locationId_organizationId_fkey"
  FOREIGN KEY ("locationId", "organizationId")
  REFERENCES "CareLocation"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareSchedulingPolicy"
  ADD CONSTRAINT "CareSchedulingPolicy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareSchedulingPolicy_locationId_organizationId_fkey"
  FOREIGN KEY ("locationId", "organizationId")
  REFERENCES "CareLocation"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareAppointment"
  ADD CONSTRAINT "CareAppointment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_storefrontBookingId_organizationId_fkey"
  FOREIGN KEY ("storefrontBookingId", "organizationId")
  REFERENCES "StorefrontBooking"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_patientProfileId_organizationId_fkey"
  FOREIGN KEY ("patientProfileId", "organizationId")
  REFERENCES "PatientProfile"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_visitTypeId_organizationId_fkey"
  FOREIGN KEY ("visitTypeId", "organizationId")
  REFERENCES "CareVisitType"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_locationId_organizationId_fkey"
  FOREIGN KEY ("locationId", "organizationId")
  REFERENCES "CareLocation"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_recurrenceScheduleId_fkey"
  FOREIGN KEY ("recurrenceScheduleId") REFERENCES "RecurrenceSchedule"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_rescheduledFromAppointmentId_org_fkey"
  FOREIGN KEY ("rescheduledFromAppointmentId", "organizationId")
  REFERENCES "CareAppointment"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_overbookAuthorizedByPrincipalId_fkey"
  FOREIGN KEY ("overbookAuthorizedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointment_createdByPrincipalId_fkey"
  FOREIGN KEY ("createdByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareAppointmentParticipant"
  ADD CONSTRAINT "CareAppointmentParticipant_appointmentId_org_fkey"
  FOREIGN KEY ("appointmentId", "organizationId")
  REFERENCES "CareAppointment"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointmentParticipant_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareAppointmentResource"
  ADD CONSTRAINT "CareAppointmentResource_appointmentId_org_fkey"
  FOREIGN KEY ("appointmentId", "organizationId")
  REFERENCES "CareAppointment"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointmentResource_resourceId_org_fkey"
  FOREIGN KEY ("resourceId", "organizationId")
  REFERENCES "CareResource"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareAppointmentStatusEvent"
  ADD CONSTRAINT "CareAppointmentStatusEvent_appointmentId_org_fkey"
  FOREIGN KEY ("appointmentId", "organizationId")
  REFERENCES "CareAppointment"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CareAppointmentStatusEvent_actorPrincipalId_fkey"
  FOREIGN KEY ("actorPrincipalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppointmentSyncEvent"
  ADD CONSTRAINT "AppointmentSyncEvent_appointmentId_org_fkey"
  FOREIGN KEY ("appointmentId", "organizationId")
  REFERENCES "CareAppointment"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "CareAppointmentParticipant"
  ADD CONSTRAINT "CareAppointmentParticipant_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("footprintStart", "footprintEnd") WITH &&
  )
  WHERE (
    "allocationState" = 'active'
    AND "overbooked" = false
  );

ALTER TABLE "CareAppointmentResource"
  ADD CONSTRAINT "CareAppointmentResource_no_overlap"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("footprintStart", "footprintEnd") WITH &&
  )
  WHERE (
    "allocationState" = 'active'
    AND "overbooked" = false
  );

-- Patient-bearing tables fail closed unless both organization and patient
-- principal context are set in the transaction, matching PatientProfile RLS.
ALTER TABLE "CareAppointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareAppointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CareAppointment_context_policy" ON "CareAppointment"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "PatientProfile" profile
      WHERE profile.id = "CareAppointment"."patientProfileId"
        AND profile."organizationId" = "CareAppointment"."organizationId"
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "PatientProfile" profile
      WHERE profile.id = "CareAppointment"."patientProfileId"
        AND profile."organizationId" = "CareAppointment"."organizationId"
    )
  );

ALTER TABLE "CareAppointmentParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareAppointmentParticipant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CareAppointmentParticipant_context_policy"
  ON "CareAppointmentParticipant"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "CareAppointmentParticipant"."appointmentId"
        AND appointment."organizationId" =
          "CareAppointmentParticipant"."organizationId"
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "CareAppointmentParticipant"."appointmentId"
        AND appointment."organizationId" =
          "CareAppointmentParticipant"."organizationId"
    )
  );

ALTER TABLE "CareAppointmentResource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareAppointmentResource" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CareAppointmentResource_context_policy"
  ON "CareAppointmentResource"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "CareAppointmentResource"."appointmentId"
        AND appointment."organizationId" =
          "CareAppointmentResource"."organizationId"
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "CareAppointmentResource"."appointmentId"
        AND appointment."organizationId" =
          "CareAppointmentResource"."organizationId"
    )
  );

ALTER TABLE "CareAppointmentStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareAppointmentStatusEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CareAppointmentStatusEvent_context_policy"
  ON "CareAppointmentStatusEvent"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "CareAppointmentStatusEvent"."appointmentId"
        AND appointment."organizationId" =
          "CareAppointmentStatusEvent"."organizationId"
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "CareAppointmentStatusEvent"."appointmentId"
        AND appointment."organizationId" =
          "CareAppointmentStatusEvent"."organizationId"
    )
  );

ALTER TABLE "AppointmentSyncEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentSyncEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AppointmentSyncEvent_context_policy"
  ON "AppointmentSyncEvent"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "AppointmentSyncEvent"."appointmentId"
        AND appointment."organizationId" =
          "AppointmentSyncEvent"."organizationId"
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM "CareAppointment" appointment
      WHERE appointment.id = "AppointmentSyncEvent"."appointmentId"
        AND appointment."organizationId" =
          "AppointmentSyncEvent"."organizationId"
    )
  );
