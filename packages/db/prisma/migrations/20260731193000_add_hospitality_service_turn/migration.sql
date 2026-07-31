-- @migration-safety: data-safe: new service-turn tables start empty; the allocation FK column is nullable; StaffingAssignment.id is already globally unique, so its redundant organization-scoped identity cannot conflict.

CREATE UNIQUE INDEX "StaffingAssignment_id_organizationId_key"
ON "StaffingAssignment"("id", "organizationId");

ALTER TABLE "StorefrontBooking"
ADD COLUMN "demandKind" TEXT NOT NULL DEFAULT 'reservation';

ALTER TABLE "StorefrontBooking"
ADD CONSTRAINT "StorefrontBooking_demandKind_check"
CHECK ("demandKind" IN ('reservation', 'walk-in'));

CREATE TABLE "HospitalityServiceTurn" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "bookingId" TEXT,
    "staffingAssignmentId" TEXT,
    "demandType" TEXT NOT NULL,
    "demandRef" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'seated',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expectedEndAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalityServiceTurn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HospitalityServiceTurn_stage_check"
      CHECK ("stage" IN ('seated', 'ordered', 'paid', 'dirty', 'closed', 'cancelled')),
    CONSTRAINT "HospitalityServiceTurn_interval_check"
      CHECK ("expectedEndAt" > "startedAt"),
    CONSTRAINT "HospitalityServiceTurn_closedAt_check"
      CHECK ("closedAt" IS NULL OR "closedAt" >= "startedAt"),
    CONSTRAINT "HospitalityServiceTurn_version_check"
      CHECK ("version" >= 1)
);

CREATE TABLE "HospitalityServiceTurnEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceTurnId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "eventType" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "atVersion" INTEGER NOT NULL,
    "actorRef" TEXT,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalityServiceTurnEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HospitalityServiceTurnEvent_eventType_check"
      CHECK ("eventType" IN ('stage-transition', 'table-assignment-changed', 'staffing-assignment-changed')),
    CONSTRAINT "HospitalityServiceTurnEvent_fromStage_check"
      CHECK ("fromStage" IS NULL OR "fromStage" IN ('seated', 'ordered', 'paid', 'dirty', 'closed', 'cancelled')),
    CONSTRAINT "HospitalityServiceTurnEvent_toStage_check"
      CHECK ("toStage" IS NULL OR "toStage" IN ('seated', 'ordered', 'paid', 'dirty', 'closed', 'cancelled')),
    CONSTRAINT "HospitalityServiceTurnEvent_version_check"
      CHECK ("atVersion" >= 1)
);

ALTER TABLE "HospitalityCapacityAllocation"
ADD COLUMN "serviceTurnId" TEXT;

CREATE UNIQUE INDEX "HospitalityServiceTurn_turnId_key"
ON "HospitalityServiceTurn"("turnId");

CREATE UNIQUE INDEX "HospitalityServiceTurn_id_organizationId_key"
ON "HospitalityServiceTurn"("id", "organizationId");

CREATE UNIQUE INDEX "HospitalityServiceTurn_bookingId_organizationId_key"
ON "HospitalityServiceTurn"("bookingId", "organizationId");

CREATE UNIQUE INDEX "HospitalityServiceTurn_storefrontId_demandType_demandRef_key"
ON "HospitalityServiceTurn"("storefrontId", "demandType", "demandRef");

CREATE INDEX "HospitalityServiceTurn_organizationId_stage_startedAt_idx"
ON "HospitalityServiceTurn"("organizationId", "stage", "startedAt");

CREATE INDEX "HospitalityServiceTurn_staffingAssignmentId_idx"
ON "HospitalityServiceTurn"("staffingAssignmentId");

CREATE UNIQUE INDEX "HospitalityServiceTurnEvent_eventId_key"
ON "HospitalityServiceTurnEvent"("eventId");

CREATE UNIQUE INDEX "HospitalityServiceTurnEvent_serviceTurnId_atVersion_key"
ON "HospitalityServiceTurnEvent"("serviceTurnId", "atVersion");

CREATE UNIQUE INDEX "HospitalityServiceTurnEvent_organizationId_idempotencyKey_key"
ON "HospitalityServiceTurnEvent"("organizationId", "idempotencyKey");

CREATE INDEX "HospitalityServiceTurnEvent_organizationId_occurredAt_idx"
ON "HospitalityServiceTurnEvent"("organizationId", "occurredAt");

CREATE INDEX "HospitalityCapacityAllocation_serviceTurnId_idx"
ON "HospitalityCapacityAllocation"("serviceTurnId");

ALTER TABLE "HospitalityServiceTurn"
ADD CONSTRAINT "HospitalityServiceTurn_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityServiceTurn"
ADD CONSTRAINT "HospitalityServiceTurn_storefrontId_organizationId_fkey"
FOREIGN KEY ("storefrontId", "organizationId")
REFERENCES "StorefrontConfig"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityServiceTurn"
ADD CONSTRAINT "HospitalityServiceTurn_bookingId_organizationId_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "StorefrontBooking"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityServiceTurn"
ADD CONSTRAINT "HospitalityServiceTurn_staffingAssignmentId_organizationId_fkey"
FOREIGN KEY ("staffingAssignmentId", "organizationId")
REFERENCES "StaffingAssignment"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityServiceTurnEvent"
ADD CONSTRAINT "HospitalityServiceTurnEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HospitalityServiceTurnEvent"
ADD CONSTRAINT "HospitalityServiceTurnEvent_serviceTurnId_organizationId_fkey"
FOREIGN KEY ("serviceTurnId", "organizationId")
REFERENCES "HospitalityServiceTurn"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HospitalityCapacityAllocation"
ADD CONSTRAINT "HospitalityCapacityAllocation_serviceTurnId_organizationId_fkey"
FOREIGN KEY ("serviceTurnId", "organizationId")
REFERENCES "HospitalityServiceTurn"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;
