-- @migration-safety: data-safe. EXPAND phase of the W19 vertical clone collapse
-- (BI-99C76A90, Simplify & Strengthen architecture pass 2026-08-16 §3.2-c).
-- Creates four EMPTY tables (the unified Resource / ResourceAvailability /
-- ResourceCapacityPool / ResourceCapacityAllocation family) plus their enum
-- types, and adds ONE nullable column to the existing RecurringSchedule table.
-- No row is read, written, or dropped; no existing column changes. The only
-- constraint that touches an existing table (RecurringSchedule FK) is added
-- NOT VALID, and the new column is all-NULL, so legacy installs apply cleanly
-- against ANY data state. The Beauty*/Hospitality* clone families remain
-- authoritative until the operator-reviewed data migration
-- (docs/superpowers/plans/2026-08-18-w19-vertical-clone-collapse-data-migration-plan.md).

-- ── Enum types ───────────────────────────────────────────────────────────────
-- RecordLifecycle is also the W20 (§3.2-d, BI-C357FA5A) unified "not active"
-- convention; this family is its born-on-convention pilot.
CREATE TYPE "RecordLifecycle" AS ENUM ('active', 'archived', 'retired', 'superseded', 'merged', 'quarantined');
CREATE TYPE "ResourceDomain" AS ENUM ('beauty', 'hospitality', 'care', 'provider', 'workforce');
CREATE TYPE "AvailabilityWindowKind" AS ENUM ('available', 'blocked');
CREATE TYPE "CapacityAllocationState" AS ENUM ('reserved', 'held', 'confirmed', 'active', 'released', 'quarantined');

-- ── Unified resource ─────────────────────────────────────────────────────────
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "domain" "ResourceDomain" NOT NULL,
    "kindSlug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "capacityUnit" TEXT NOT NULL DEFAULT 'units',
    "serviceArea" TEXT,
    "blockedReason" TEXT,
    "attributes" JSONB,
    "subjectRef" TEXT,
    "sourceRef" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Resource_sourceRef_key" ON "Resource"("sourceRef");
-- Query path: storefront-scoped roster reads in the dual-read repository (apps/web/lib/resource-scheduling/).
CREATE INDEX "Resource_storefrontId_organizationId_kindSlug_idx" ON "Resource"("storefrontId", "organizationId", "kindSlug");
-- Query path: org roster by domain and lifecycle in the dual-read repository.
CREATE INDEX "Resource_organizationId_domain_lifecycle_idx" ON "Resource"("organizationId", "domain", "lifecycle");
CREATE UNIQUE INDEX "Resource_id_organizationId_key" ON "Resource"("id", "organizationId");
CREATE UNIQUE INDEX "Resource_organizationId_domain_resourceKey_key" ON "Resource"("organizationId", "domain", "resourceKey");

-- ── Unified availability window ──────────────────────────────────────────────
CREATE TABLE "ResourceAvailability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "windowKind" "AvailabilityWindowKind" NOT NULL DEFAULT 'available',
    "days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "date" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "recurrenceScheduleId" TEXT,
    "reason" TEXT,
    "sourceRef" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceAvailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResourceAvailability_sourceRef_key" ON "ResourceAvailability"("sourceRef");
-- Query path: per-resource window reads in the dual-read repository (clone analog: BeautyResourceAvailability @@index([resourceId, date])).
CREATE INDEX "ResourceAvailability_resourceId_organizationId_date_idx" ON "ResourceAvailability"("resourceId", "organizationId", "date");
-- Query path: org-wide window scans by kind (clone analog: @@index([organizationId, kind])).
CREATE INDEX "ResourceAvailability_organizationId_windowKind_idx" ON "ResourceAvailability"("organizationId", "windowKind");
-- Query path: recurrence materializer reverse lookup (RecurrenceSchedule consumer contract).
CREATE INDEX "ResourceAvailability_recurrenceScheduleId_idx" ON "ResourceAvailability"("recurrenceScheduleId");
-- Query path: dated-window overlap scans (clone analog: @@index([startsAt, endsAt])).
CREATE INDEX "ResourceAvailability_startsAt_endsAt_idx" ON "ResourceAvailability"("startsAt", "endsAt");

-- ── Unified aggregate capacity pool ──────────────────────────────────────────
CREATE TABLE "ResourceCapacityPool" (
    "id" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "domain" "ResourceDomain" NOT NULL,
    "kindSlug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "capacityUnit" TEXT NOT NULL,
    "intervalMinutes" INTEGER,
    "attributes" JSONB,
    "sourceRef" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCapacityPool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResourceCapacityPool_sourceRef_key" ON "ResourceCapacityPool"("sourceRef");
-- Query path: storefront-scoped pool reads in the dual-read repository.
CREATE INDEX "ResourceCapacityPool_storefrontId_organizationId_kindSlug_idx" ON "ResourceCapacityPool"("storefrontId", "organizationId", "kindSlug");
-- Query path: org pool roster by domain and lifecycle.
CREATE INDEX "ResourceCapacityPool_organizationId_domain_lifecycle_idx" ON "ResourceCapacityPool"("organizationId", "domain", "lifecycle");
CREATE UNIQUE INDEX "ResourceCapacityPool_id_organizationId_key" ON "ResourceCapacityPool"("id", "organizationId");
CREATE UNIQUE INDEX "ResourceCapacityPool_organizationId_domain_poolKey_key" ON "ResourceCapacityPool"("organizationId", "domain", "poolKey");

-- ── Unified capacity consumption ledger ──────────────────────────────────────
CREATE TABLE "ResourceCapacityAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "domain" "ResourceDomain" NOT NULL,
    "resourceId" TEXT,
    "poolId" TEXT,
    "bookingId" TEXT,
    "bookingHoldId" TEXT,
    "demandSlug" TEXT NOT NULL,
    "demandRef" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "state" "CapacityAllocationState" NOT NULL DEFAULT 'confirmed',
    "idempotencyKey" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "sourceRef" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCapacityAllocation_pkey" PRIMARY KEY ("id")
);

-- Invariant carried over from HospitalityCapacityAllocation: a ledger row
-- targets exactly one discrete resource OR one aggregate pool. Plain (not
-- NOT VALID) because the table is created empty in this same migration.
ALTER TABLE "ResourceCapacityAllocation"
  ADD CONSTRAINT "ResourceCapacityAllocation_target_one_of_chk"
  CHECK ((("resourceId" IS NOT NULL)::int + ("poolId" IS NOT NULL)::int) = 1);

CREATE UNIQUE INDEX "ResourceCapacityAllocation_sourceRef_key" ON "ResourceCapacityAllocation"("sourceRef");
-- Query path: per-resource conflict window scan (clone analog: @@index([resourceId, startsAt, endsAt])).
CREATE INDEX "ResourceCapacityAllocation_resourceId_organizationId_starts_idx" ON "ResourceCapacityAllocation"("resourceId", "organizationId", "startsAt");
-- Query path: per-pool conflict window scan (clone analog: @@index([poolId, startsAt, endsAt])).
CREATE INDEX "ResourceCapacityAllocation_poolId_organizationId_startsAt_idx" ON "ResourceCapacityAllocation"("poolId", "organizationId", "startsAt");
-- Query path: storefront demand lookup (clone analog: @@index([storefrontId, demandType, demandRef])).
CREATE INDEX "ResourceCapacityAllocation_storefrontId_organizationId_dema_idx" ON "ResourceCapacityAllocation"("storefrontId", "organizationId", "demandSlug");
-- Query path: allocations-for-booking release path (clone analog: release-by-booking updateMany).
CREATE INDEX "ResourceCapacityAllocation_bookingId_organizationId_idx" ON "ResourceCapacityAllocation"("bookingId", "organizationId");
-- Query path: allocations-for-hold release path (clone analog: release-by-hold updateMany).
CREATE INDEX "ResourceCapacityAllocation_bookingHoldId_organizationId_idx" ON "ResourceCapacityAllocation"("bookingHoldId", "organizationId");
-- Query path: org allocation scans by business state and window (clone analog: @@index([organizationId, lifecycle, startsAt])).
CREATE INDEX "ResourceCapacityAllocation_organizationId_state_startsAt_idx" ON "ResourceCapacityAllocation"("organizationId", "state", "startsAt");
-- Query path: cross-resource overlap scans (clone analog: @@index([startsAt, endsAt]) — pruned later if unused, per the hot-table index rule).
CREATE INDEX "ResourceCapacityAllocation_startsAt_endsAt_idx" ON "ResourceCapacityAllocation"("startsAt", "endsAt");
CREATE UNIQUE INDEX "ResourceCapacityAllocation_organizationId_idempotencyKey_key" ON "ResourceCapacityAllocation"("organizationId", "idempotencyKey");

-- ── RecurrenceSchedule/RecurringSchedule fold (expand step) ─────────────────
-- Nullable, all-NULL at birth; `frequency` stays authoritative until the
-- operator-reviewed backfill in the W19 migration plan doc.
ALTER TABLE "RecurringSchedule" ADD COLUMN "recurrenceScheduleId" TEXT;
CREATE UNIQUE INDEX "RecurringSchedule_recurrenceScheduleId_key" ON "RecurringSchedule"("recurrenceScheduleId");
-- NOT VALID: constraint on an EXISTING table — never checked against
-- pre-existing rows (the column is freshly added and all-NULL anyway).
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_recurrenceScheduleId_fkey" FOREIGN KEY ("recurrenceScheduleId") REFERENCES "RecurrenceSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- ── Foreign keys for the new (empty) tables ──────────────────────────────────
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_storefrontId_organizationId_fkey" FOREIGN KEY ("storefrontId", "organizationId") REFERENCES "StorefrontConfig"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceAvailability" ADD CONSTRAINT "ResourceAvailability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceAvailability" ADD CONSTRAINT "ResourceAvailability_resourceId_organizationId_fkey" FOREIGN KEY ("resourceId", "organizationId") REFERENCES "Resource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResourceAvailability" ADD CONSTRAINT "ResourceAvailability_recurrenceScheduleId_fkey" FOREIGN KEY ("recurrenceScheduleId") REFERENCES "RecurrenceSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityPool" ADD CONSTRAINT "ResourceCapacityPool_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityPool" ADD CONSTRAINT "ResourceCapacityPool_storefrontId_organizationId_fkey" FOREIGN KEY ("storefrontId", "organizationId") REFERENCES "StorefrontConfig"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityAllocation" ADD CONSTRAINT "ResourceCapacityAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityAllocation" ADD CONSTRAINT "ResourceCapacityAllocation_storefrontId_organizationId_fkey" FOREIGN KEY ("storefrontId", "organizationId") REFERENCES "StorefrontConfig"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityAllocation" ADD CONSTRAINT "ResourceCapacityAllocation_resourceId_organizationId_fkey" FOREIGN KEY ("resourceId", "organizationId") REFERENCES "Resource"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityAllocation" ADD CONSTRAINT "ResourceCapacityAllocation_poolId_organizationId_fkey" FOREIGN KEY ("poolId", "organizationId") REFERENCES "ResourceCapacityPool"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityAllocation" ADD CONSTRAINT "ResourceCapacityAllocation_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "StorefrontBooking"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceCapacityAllocation" ADD CONSTRAINT "ResourceCapacityAllocation_bookingHoldId_organizationId_fkey" FOREIGN KEY ("bookingHoldId", "organizationId") REFERENCES "BookingHold"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
