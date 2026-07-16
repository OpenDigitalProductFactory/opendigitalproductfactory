-- Use-it-or-lose-it capacity draining config on the platform-dev singleton.
-- @migration-safety: data-safe: all columns are additive with defaults; no
-- existing row can violate any constraint.
ALTER TABLE "PlatformDevConfig"
    ADD COLUMN "capacityDrainEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "capacityResetDow" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "capacityResetHourUtc" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "capacityDrainWindowHours" INTEGER NOT NULL DEFAULT 12,
    ADD COLUMN "capacityDrainMaxDispatch" INTEGER NOT NULL DEFAULT 3;
