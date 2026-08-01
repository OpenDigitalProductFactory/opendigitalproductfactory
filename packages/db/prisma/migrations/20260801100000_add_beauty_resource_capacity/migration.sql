-- BI-CD2A412D - Beauty and personal-care resource capacity.
--
-- @migration-safety: data-safe: all constrained beauty capacity tables are created empty;
-- the StorefrontItem compound unique index extends existing primary-key uniqueness.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE UNIQUE INDEX "StorefrontItem_id_storefrontId_key"
  ON "StorefrontItem"("id", "storefrontId");

CREATE TABLE "BeautyResource" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "capacityUnit" TEXT NOT NULL DEFAULT 'appointments',
  "serviceArea" TEXT,
  "blockedReason" TEXT,
  "attributes" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BeautyResource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BeautyResource_capacity_check" CHECK ("capacity" > 0),
  CONSTRAINT "BeautyResource_version_check" CHECK ("version" > 0),
  CONSTRAINT "BeautyResource_kind_check" CHECK ("kind" IN ('chair', 'station', 'room'))
);

CREATE TABLE "BeautyResourceService" (
  "id" TEXT NOT NULL,
  "storefrontId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BeautyResourceService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BeautyResourceAvailability" (
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

  CONSTRAINT "BeautyResourceAvailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BeautyResourceAvailability_version_check" CHECK ("version" > 0),
  CONSTRAINT "BeautyResourceAvailability_kind_check" CHECK ("kind" IN ('available', 'unavailable')),
  CONSTRAINT "BeautyResourceAvailability_interval_check" CHECK (
    ("startsAt" IS NULL AND "endsAt" IS NULL)
    OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt")
  )
);

CREATE TABLE "BeautyCapacityAllocation" (
  "id" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "bookingId" TEXT,
  "bookingHoldId" TEXT,
  "demandType" TEXT NOT NULL,
  "demandRef" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "lifecycle" TEXT NOT NULL DEFAULT 'confirmed',
  "idempotencyKey" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BeautyCapacityAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BeautyCapacityAllocation_one_demand_check"
    CHECK (
      ("lifecycle" IN ('held', 'confirmed', 'active')
        AND (("bookingId" IS NOT NULL) <> ("bookingHoldId" IS NOT NULL)))
      OR
      ("lifecycle" IN ('released', 'cancelled')
        AND NOT ("bookingId" IS NOT NULL AND "bookingHoldId" IS NOT NULL))
    ),
  CONSTRAINT "BeautyCapacityAllocation_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "BeautyCapacityAllocation_interval_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "BeautyCapacityAllocation_version_check" CHECK ("version" > 0),
  CONSTRAINT "BeautyCapacityAllocation_lifecycle_check"
    CHECK ("lifecycle" IN ('held', 'confirmed', 'active', 'released', 'cancelled'))
);

CREATE UNIQUE INDEX "BeautyResource_id_organizationId_key"
  ON "BeautyResource"("id", "organizationId");
CREATE UNIQUE INDEX "BeautyResource_id_storefrontId_key"
  ON "BeautyResource"("id", "storefrontId");
CREATE UNIQUE INDEX "BeautyResource_storefrontId_resourceId_key"
  ON "BeautyResource"("storefrontId", "resourceId");
CREATE INDEX "BeautyResource_organizationId_kind_status_idx"
  ON "BeautyResource"("organizationId", "kind", "status");
CREATE INDEX "BeautyResource_storefrontId_kind_status_idx"
  ON "BeautyResource"("storefrontId", "kind", "status");

CREATE UNIQUE INDEX "BeautyResourceService_resourceId_itemId_key"
  ON "BeautyResourceService"("resourceId", "itemId");
CREATE INDEX "BeautyResourceService_storefrontId_itemId_idx"
  ON "BeautyResourceService"("storefrontId", "itemId");

CREATE UNIQUE INDEX "BeautyResourceAvailability_availabilityId_key"
  ON "BeautyResourceAvailability"("availabilityId");
CREATE INDEX "BeautyResourceAvailability_resourceId_date_idx"
  ON "BeautyResourceAvailability"("resourceId", "date");
CREATE INDEX "BeautyResourceAvailability_organizationId_kind_idx"
  ON "BeautyResourceAvailability"("organizationId", "kind");
CREATE INDEX "BeautyResourceAvailability_startsAt_endsAt_idx"
  ON "BeautyResourceAvailability"("startsAt", "endsAt");

CREATE UNIQUE INDEX "BeautyCapacityAllocation_allocationId_key"
  ON "BeautyCapacityAllocation"("allocationId");
CREATE UNIQUE INDEX "BeautyCapacityAllocation_organizationId_idempotencyKey_key"
  ON "BeautyCapacityAllocation"("organizationId", "idempotencyKey");
CREATE INDEX "BeautyCapacityAllocation_resourceId_startsAt_endsAt_idx"
  ON "BeautyCapacityAllocation"("resourceId", "startsAt", "endsAt");
CREATE INDEX "BeautyCapacityAllocation_organizationId_lifecycle_startsAt_idx"
  ON "BeautyCapacityAllocation"("organizationId", "lifecycle", "startsAt");
CREATE INDEX "BeautyCapacityAllocation_storefrontId_demandType_demandRef_idx"
  ON "BeautyCapacityAllocation"("storefrontId", "demandType", "demandRef");

ALTER TABLE "BeautyResource"
  ADD CONSTRAINT "BeautyResource_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeautyResource"
  ADD CONSTRAINT "BeautyResource_storefrontId_organizationId_fkey"
  FOREIGN KEY ("storefrontId", "organizationId")
  REFERENCES "StorefrontConfig"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BeautyResourceService"
  ADD CONSTRAINT "BeautyResourceService_storefrontId_fkey"
  FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeautyResourceService"
  ADD CONSTRAINT "BeautyResourceService_resourceId_storefrontId_fkey"
  FOREIGN KEY ("resourceId", "storefrontId")
  REFERENCES "BeautyResource"("id", "storefrontId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeautyResourceService"
  ADD CONSTRAINT "BeautyResourceService_itemId_storefrontId_fkey"
  FOREIGN KEY ("itemId", "storefrontId")
  REFERENCES "StorefrontItem"("id", "storefrontId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BeautyResourceAvailability"
  ADD CONSTRAINT "BeautyResourceAvailability_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeautyResourceAvailability"
  ADD CONSTRAINT "BeautyResourceAvailability_resourceId_organizationId_fkey"
  FOREIGN KEY ("resourceId", "organizationId")
  REFERENCES "BeautyResource"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BeautyCapacityAllocation"
  ADD CONSTRAINT "BeautyCapacityAllocation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeautyCapacityAllocation"
  ADD CONSTRAINT "BeautyCapacityAllocation_storefrontId_organizationId_fkey"
  FOREIGN KEY ("storefrontId", "organizationId")
  REFERENCES "StorefrontConfig"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeautyCapacityAllocation"
  ADD CONSTRAINT "BeautyCapacityAllocation_resourceId_organizationId_fkey"
  FOREIGN KEY ("resourceId", "organizationId") REFERENCES "BeautyResource"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeautyCapacityAllocation"
  ADD CONSTRAINT "BeautyCapacityAllocation_bookingId_organizationId_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "StorefrontBooking"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeautyCapacityAllocation"
  ADD CONSTRAINT "BeautyCapacityAllocation_bookingHoldId_organizationId_fkey"
  FOREIGN KEY ("bookingHoldId", "organizationId") REFERENCES "BookingHold"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BeautyCapacityAllocation"
  ADD CONSTRAINT "BeautyCapacityAllocation_no_resource_overlap"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("startsAt", "endsAt") WITH &&
  )
  WHERE ("lifecycle" IN ('held', 'confirmed', 'active'));
