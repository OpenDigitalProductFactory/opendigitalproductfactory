-- BI-57F34A00 — Food & Hospitality resource and capacity substrate.
--
-- Fleet safety: expand -> backfill -> constrain. Legacy ServiceProvider rows,
-- providerId booking links, and customer records are preserved for rolling
-- compatibility. Existing conflicts are quarantined, never deleted or silently
-- cancelled.
--
-- @migration-safety: data-safe: composite id/organization unique indexes extend
-- existing primary-key uniqueness; BookingHold organization ownership is
-- backfilled from its required StorefrontConfig before SET NOT NULL; every
-- remaining constraint applies to new tables after deterministic remediation.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Expand existing reservation rows with nullable compatibility columns.
ALTER TABLE "BookingHold" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "BookingHold" ADD COLUMN "hospitalityResourceId" TEXT;
ALTER TABLE "StorefrontBooking" ADD COLUMN "hospitalityResourceId" TEXT;

UPDATE "BookingHold" hold
SET "organizationId" = storefront."organizationId"
FROM "StorefrontConfig" storefront
WHERE storefront.id = hold."storefrontId"
  AND hold."organizationId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BookingHold" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION
      'BookingHold organization backfill incomplete; repair orphaned storefront references before retrying';
  END IF;
END $$;

ALTER TABLE "BookingHold" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE UNIQUE INDEX "StorefrontConfig_id_organizationId_key"
  ON "StorefrontConfig"("id", "organizationId");
CREATE UNIQUE INDEX "BookingHold_id_organizationId_key"
  ON "BookingHold"("id", "organizationId");

-- 2. Create the owning Food & Hospitality substrate.
CREATE TABLE "HospitalityResource" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "capacityUnit" TEXT NOT NULL DEFAULT 'seats',
  "serviceArea" TEXT,
  "blockedReason" TEXT,
  "attributes" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "legacyServiceProviderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HospitalityResource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HospitalityResource_capacity_check" CHECK ("capacity" > 0),
  CONSTRAINT "HospitalityResource_version_check" CHECK ("version" > 0)
);

CREATE TABLE "HospitalityCapacityPool" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "capacityUnit" TEXT NOT NULL,
  "intervalMinutes" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "attributes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HospitalityCapacityPool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HospitalityCapacityPool_capacity_check" CHECK ("capacity" > 0),
  CONSTRAINT "HospitalityCapacityPool_interval_check"
    CHECK ("intervalMinutes" IS NULL OR "intervalMinutes" > 0),
  CONSTRAINT "HospitalityCapacityPool_version_check" CHECK ("version" > 0)
);

CREATE TABLE "HospitalityResourceAvailability" (
  "id" TEXT NOT NULL,
  "availabilityId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'available',
  "days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "startTime" TEXT,
  "endTime" TEXT,
  "date" TIMESTAMP(3),
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HospitalityResourceAvailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HospitalityResourceAvailability_version_check" CHECK ("version" > 0),
  CONSTRAINT "HospitalityResourceAvailability_interval_check"
    CHECK (
      ("startsAt" IS NULL AND "endsAt" IS NULL)
      OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt")
    )
);

CREATE TABLE "HospitalityCapacityAllocation" (
  "id" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontId" TEXT NOT NULL,
  "resourceId" TEXT,
  "poolId" TEXT,
  "bookingId" TEXT,
  "bookingHoldId" TEXT,
  "demandType" TEXT NOT NULL,
  "demandRef" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "lifecycle" TEXT NOT NULL DEFAULT 'reserved',
  "idempotencyKey" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  "conflictQuarantinedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HospitalityCapacityAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HospitalityCapacityAllocation_one_target_check"
    CHECK (("resourceId" IS NOT NULL) <> ("poolId" IS NOT NULL)),
  CONSTRAINT "HospitalityCapacityAllocation_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "HospitalityCapacityAllocation_interval_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "HospitalityCapacityAllocation_version_check" CHECK ("version" > 0)
);

-- 3. Keys and ownership boundaries required by the backfill.
CREATE UNIQUE INDEX "HospitalityResource_legacyServiceProviderId_key"
  ON "HospitalityResource"("legacyServiceProviderId");
CREATE UNIQUE INDEX "HospitalityResource_id_organizationId_key"
  ON "HospitalityResource"("id", "organizationId");
CREATE UNIQUE INDEX "HospitalityResource_storefrontId_resourceId_key"
  ON "HospitalityResource"("storefrontId", "resourceId");
CREATE INDEX "HospitalityResource_organizationId_kind_status_idx"
  ON "HospitalityResource"("organizationId", "kind", "status");
CREATE INDEX "HospitalityResource_storefrontId_kind_status_idx"
  ON "HospitalityResource"("storefrontId", "kind", "status");

CREATE UNIQUE INDEX "HospitalityCapacityPool_id_organizationId_key"
  ON "HospitalityCapacityPool"("id", "organizationId");
CREATE UNIQUE INDEX "HospitalityCapacityPool_storefrontId_poolId_key"
  ON "HospitalityCapacityPool"("storefrontId", "poolId");
CREATE INDEX "HospitalityCapacityPool_organizationId_kind_status_idx"
  ON "HospitalityCapacityPool"("organizationId", "kind", "status");
CREATE INDEX "HospitalityCapacityPool_storefrontId_kind_status_idx"
  ON "HospitalityCapacityPool"("storefrontId", "kind", "status");

CREATE UNIQUE INDEX "HospitalityResourceAvailability_availabilityId_key"
  ON "HospitalityResourceAvailability"("availabilityId");
CREATE INDEX "HospitalityResourceAvailability_resourceId_date_idx"
  ON "HospitalityResourceAvailability"("resourceId", "date");
CREATE INDEX "HospitalityResourceAvailability_organizationId_kind_idx"
  ON "HospitalityResourceAvailability"("organizationId", "kind");
CREATE INDEX "HospitalityResourceAvailability_startsAt_endsAt_idx"
  ON "HospitalityResourceAvailability"("startsAt", "endsAt");

CREATE UNIQUE INDEX "HospitalityCapacityAllocation_allocationId_key"
  ON "HospitalityCapacityAllocation"("allocationId");
CREATE UNIQUE INDEX "HospitalityCapacityAllocation_organizationId_idempotencyKey_key"
  ON "HospitalityCapacityAllocation"("organizationId", "idempotencyKey");
CREATE INDEX "HospitalityCapacityAllocation_resourceId_startsAt_endsAt_idx"
  ON "HospitalityCapacityAllocation"("resourceId", "startsAt", "endsAt");
CREATE INDEX "HospitalityCapacityAllocation_poolId_startsAt_endsAt_idx"
  ON "HospitalityCapacityAllocation"("poolId", "startsAt", "endsAt");
CREATE INDEX "HospitalityCapacityAllocation_organizationId_lifecycle_startsAt_idx"
  ON "HospitalityCapacityAllocation"("organizationId", "lifecycle", "startsAt");
CREATE INDEX "HospitalityCapacityAllocation_storefrontId_demandType_demandRef_idx"
  ON "HospitalityCapacityAllocation"("storefrontId", "demandType", "demandRef");

ALTER TABLE "HospitalityResource"
  ADD CONSTRAINT "HospitalityResource_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityResource"
  ADD CONSTRAINT "HospitalityResource_storefrontId_organizationId_fkey"
  FOREIGN KEY ("storefrontId", "organizationId")
  REFERENCES "StorefrontConfig"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityResource"
  ADD CONSTRAINT "HospitalityResource_legacyServiceProviderId_fkey"
  FOREIGN KEY ("legacyServiceProviderId") REFERENCES "ServiceProvider"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HospitalityCapacityPool"
  ADD CONSTRAINT "HospitalityCapacityPool_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityCapacityPool"
  ADD CONSTRAINT "HospitalityCapacityPool_storefrontId_organizationId_fkey"
  FOREIGN KEY ("storefrontId", "organizationId")
  REFERENCES "StorefrontConfig"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityResourceAvailability"
  ADD CONSTRAINT "HospitalityResourceAvailability_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityResourceAvailability"
  ADD CONSTRAINT "HospitalityResourceAvailability_resourceId_organizationId_fkey"
  FOREIGN KEY ("resourceId", "organizationId")
  REFERENCES "HospitalityResource"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Convert only explicit Food & Hospitality table-shaped legacy rows. A row
-- linked to an employee remains a person even if its display name is unusual.
INSERT INTO "HospitalityResource" (
  "id",
  "resourceId",
  "organizationId",
  "storefrontId",
  "kind",
  "label",
  "status",
  "capacity",
  "capacityUnit",
  "blockedReason",
  "legacyServiceProviderId",
  "createdAt",
  "updatedAt"
)
SELECT
  'hres_' || md5(provider.id),
  'legacy-' || provider."providerId",
  storefront."organizationId",
  provider."storefrontId",
  'table',
  provider.name,
  CASE
    WHEN NOT provider."isActive" OR capacity_hint.inferred_capacity IS NULL
      THEN 'blocked'
    ELSE 'active'
  END,
  COALESCE(capacity_hint.inferred_capacity, 1),
  'seats',
  CASE
    WHEN capacity_hint.inferred_capacity IS NULL
      THEN 'Confirm seat capacity after migration'
    WHEN NOT provider."isActive"
      THEN 'Legacy table was inactive before migration'
    ELSE NULL
  END,
  provider.id,
  provider."createdAt",
  provider."updatedAt"
FROM "ServiceProvider" provider
JOIN "StorefrontConfig" storefront ON storefront.id = provider."storefrontId"
JOIN "StorefrontArchetype" archetype ON archetype.id = storefront."archetypeId"
LEFT JOIN LATERAL (
  SELECT NULLIF(
    substring(
      provider.name
      FROM '(?i)(?:for|seats?|covers?|pax)[[:space:]]*([0-9]{1,2})'
    ),
    ''
  )::INTEGER AS inferred_capacity
) capacity_hint ON TRUE
WHERE archetype.category = 'food-hospitality'
  AND provider."employeeId" IS NULL
  AND (
    provider.name ~* '(^|[^[:alnum:]])(table|booth|window[[:space:]]*seat|bar[[:space:]]*seat|counter[[:space:]]*seat|patio|terrace|banquette)([^[:alnum:]]|$)'
    OR provider."providerId" ~* '^(table|tbl|booth|seat)[-_ ]?[0-9]+'
  )
ON CONFLICT ("storefrontId", "resourceId") DO UPDATE
SET
  "label" = EXCLUDED."label",
  "status" = EXCLUDED."status",
  "capacity" = EXCLUDED."capacity",
  "blockedReason" = EXCLUDED."blockedReason",
  "legacyServiceProviderId" = EXCLUDED."legacyServiceProviderId",
  "updatedAt" = EXCLUDED."updatedAt";

UPDATE "StorefrontBooking" booking
SET "hospitalityResourceId" = resource.id
FROM "HospitalityResource" resource
WHERE resource."legacyServiceProviderId" = booking."providerId"
  AND resource."organizationId" = booking."organizationId"
  AND booking."hospitalityResourceId" IS NULL;

UPDATE "BookingHold" hold
SET "hospitalityResourceId" = resource.id
FROM "HospitalityResource" resource
WHERE resource."legacyServiceProviderId" = hold."providerId"
  AND resource."organizationId" = hold."organizationId"
  AND hold."hospitalityResourceId" IS NULL;

-- 5. Backfill the live capacity ledger. Quarantined legacy bookings remain in
-- their operator review queue and do not silently re-enter capacity.
INSERT INTO "HospitalityCapacityAllocation" (
  "id",
  "allocationId",
  "organizationId",
  "storefrontId",
  "resourceId",
  "bookingId",
  "demandType",
  "demandRef",
  "startsAt",
  "endsAt",
  "quantity",
  "lifecycle",
  "idempotencyKey",
  "createdAt",
  "updatedAt"
)
SELECT
  'halloc_booking_' || md5(booking.id),
  'HA-BK-' || md5(booking.id),
  booking."organizationId",
  booking."storefrontId",
  booking."hospitalityResourceId",
  booking.id,
  'booking',
  booking."bookingRef",
  booking."scheduledAt",
  booking."scheduledAt" + make_interval(mins => booking."durationMinutes"),
  1,
  CASE
    WHEN lower(booking.status) IN ('confirmed', 'scheduled', 'in_progress', 'inprogress', 'seated')
      THEN 'active'
    ELSE 'reserved'
  END,
  'booking:' || booking.id,
  booking."createdAt",
  booking."updatedAt"
FROM "StorefrontBooking" booking
WHERE booking."hospitalityResourceId" IS NOT NULL
  AND booking."durationMinutes" > 0
  AND booking."overlapQuarantinedAt" IS NULL
  AND lower(booking.status) NOT IN ('cancelled', 'canceled', 'completed', 'no_show', 'no-show', 'void')
ON CONFLICT ("organizationId", "idempotencyKey") DO NOTHING;

INSERT INTO "HospitalityCapacityAllocation" (
  "id",
  "allocationId",
  "organizationId",
  "storefrontId",
  "resourceId",
  "bookingHoldId",
  "demandType",
  "demandRef",
  "startsAt",
  "endsAt",
  "quantity",
  "lifecycle",
  "idempotencyKey",
  "createdAt",
  "updatedAt"
)
SELECT
  'halloc_hold_' || md5(hold.id),
  'HA-HOLD-' || md5(hold.id),
  hold."organizationId",
  hold."storefrontId",
  hold."hospitalityResourceId",
  hold.id,
  'hold',
  hold."holderToken",
  hold."slotStart",
  hold."slotEnd",
  1,
  'reserved',
  'hold:' || hold.id,
  hold."createdAt",
  hold."createdAt"
FROM "BookingHold" hold
WHERE hold."hospitalityResourceId" IS NOT NULL
  AND hold."slotEnd" > hold."slotStart"
  AND hold."expiresAt" > CURRENT_TIMESTAMP
ON CONFLICT ("organizationId", "idempotencyKey") DO NOTHING;

-- Existing holds can overlap bookings because the old hold check was
-- application-level. Keep the earliest allocation and quarantine later rows
-- until every discrete resource is conflict-free.
DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  LOOP
    WITH conflict AS (
      SELECT later.id
      FROM "HospitalityCapacityAllocation" later
      JOIN "HospitalityCapacityAllocation" earlier
        ON later."resourceId" = earlier."resourceId"
       AND later.id <> earlier.id
       AND later."resourceId" IS NOT NULL
       AND later.lifecycle IN ('reserved', 'active')
       AND earlier.lifecycle IN ('reserved', 'active')
       AND later."conflictQuarantinedAt" IS NULL
       AND earlier."conflictQuarantinedAt" IS NULL
       AND tsrange(later."startsAt", later."endsAt") &&
           tsrange(earlier."startsAt", earlier."endsAt")
       AND (later."createdAt", later.id) > (earlier."createdAt", earlier.id)
      ORDER BY later."createdAt", later.id
      LIMIT 1
    )
    UPDATE "HospitalityCapacityAllocation" allocation
    SET
      "conflictQuarantinedAt" = CURRENT_TIMESTAMP,
      "lifecycle" = 'quarantined',
      "updatedAt" = CURRENT_TIMESTAMP
    FROM conflict
    WHERE allocation.id = conflict.id;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    EXIT WHEN affected_rows = 0;
  END LOOP;
END $$;

-- 6. Add referential and concurrency guards after every existing row is safe.
ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_hospitalityResourceId_organizationId_fkey"
  FOREIGN KEY ("hospitalityResourceId", "organizationId")
  REFERENCES "HospitalityResource"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorefrontBooking"
  ADD CONSTRAINT "StorefrontBooking_hospitalityResourceId_organizationId_fkey"
  FOREIGN KEY ("hospitalityResourceId", "organizationId")
  REFERENCES "HospitalityResource"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityCapacityAllocation"
  ADD CONSTRAINT "HospitalityCapacityAllocation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityCapacityAllocation"
  ADD CONSTRAINT "HospitalityCapacityAllocation_storefrontId_organizationId_fkey"
  FOREIGN KEY ("storefrontId", "organizationId")
  REFERENCES "StorefrontConfig"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityCapacityAllocation"
  ADD CONSTRAINT "HospitalityCapacityAllocation_resourceId_organizationId_fkey"
  FOREIGN KEY ("resourceId", "organizationId")
  REFERENCES "HospitalityResource"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityCapacityAllocation"
  ADD CONSTRAINT "HospitalityCapacityAllocation_poolId_organizationId_fkey"
  FOREIGN KEY ("poolId", "organizationId")
  REFERENCES "HospitalityCapacityPool"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityCapacityAllocation"
  ADD CONSTRAINT "HospitalityCapacityAllocation_bookingId_organizationId_fkey"
  FOREIGN KEY ("bookingId", "organizationId")
  REFERENCES "StorefrontBooking"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalityCapacityAllocation"
  ADD CONSTRAINT "HospitalityCapacityAllocation_bookingHoldId_organizationId_fkey"
  FOREIGN KEY ("bookingHoldId", "organizationId")
  REFERENCES "BookingHold"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityCapacityAllocation"
  ADD CONSTRAINT "HospitalityCapacityAllocation_no_resource_overlap"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("startsAt", "endsAt") WITH &&
  )
  WHERE (
    "resourceId" IS NOT NULL
    AND "lifecycle" IN ('reserved', 'active')
    AND "conflictQuarantinedAt" IS NULL
  );

CREATE INDEX "StorefrontBooking_hospitalityResourceId_scheduledAt_idx"
  ON "StorefrontBooking"("hospitalityResourceId", "scheduledAt");
CREATE INDEX "BookingHold_hospitalityResourceId_slotStart_slotEnd_idx"
  ON "BookingHold"("hospitalityResourceId", "slotStart", "slotEnd");
