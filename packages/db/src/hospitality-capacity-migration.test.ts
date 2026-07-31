import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../prisma/migrations/20260730120000_food_hospitality_resource_capacity/migration.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

describe("food and hospitality resource capacity migration", () => {
  it("expands BookingHold ownership before making it required", () => {
    expect(migration).toContain(
      'ALTER TABLE "BookingHold" ADD COLUMN "organizationId" TEXT',
    );
    expect(migration).toMatch(
      /UPDATE "BookingHold"[\s\S]*?"StorefrontConfig"[\s\S]*?"organizationId"/,
    );
    expect(migration).toContain(
      'ALTER TABLE "BookingHold" ALTER COLUMN "organizationId" SET NOT NULL',
    );
  });

  it("backfills only food and hospitality table-like providers while preserving providers", () => {
    expect(migration).toContain(`archetype.category = 'food-hospitality'`);
    expect(migration).toContain('provider."employeeId" IS NULL');
    expect(migration).toContain('"legacyServiceProviderId"');
    expect(migration).toContain(
      "Confirm seat capacity after migration",
    );
    expect(migration).toMatch(
      /inferred_capacity[\s\S]*?THEN 'blocked'/,
    );
    expect(migration).toMatch(/ON CONFLICT \("storefrontId", "resourceId"\) DO UPDATE/);
    expect(migration).not.toMatch(
      /DELETE FROM "ServiceProvider"|UPDATE "ServiceProvider"[\s\S]*?"isActive"/,
    );
  });

  it("bridges bookings and holds and preserves the old provider reference", () => {
    expect(migration).toContain(
      'ADD COLUMN "hospitalityResourceId" TEXT',
    );
    expect(migration).toMatch(
      /UPDATE "StorefrontBooking"[\s\S]*?"legacyServiceProviderId"/,
    );
    expect(migration).toMatch(
      /UPDATE "BookingHold"[\s\S]*?"legacyServiceProviderId"/,
    );
    expect(migration).not.toContain('DROP COLUMN "providerId"');
  });

  it("quarantines legacy conflicts before adding the discrete overlap constraint", () => {
    const quarantine = migration.search(
      /SET[\s\S]{0,120}"conflictQuarantinedAt" = CURRENT_TIMESTAMP/,
    );
    const constraint = migration.indexOf(
      'ADD CONSTRAINT "HospitalityCapacityAllocation_no_resource_overlap"',
    );

    expect(quarantine).toBeGreaterThan(-1);
    expect(constraint).toBeGreaterThan(quarantine);
    expect(migration).toContain("EXCLUDE USING gist");
    expect(migration).not.toMatch(
      /DELETE FROM "HospitalityCapacityAllocation"/,
    );
  });

  it("enforces one target, positive capacity, and positive intervals", () => {
    expect(migration).toContain(
      'CONSTRAINT "HospitalityCapacityAllocation_one_target_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "HospitalityCapacityAllocation_quantity_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "HospitalityCapacityAllocation_interval_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "HospitalityResource_capacity_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "HospitalityCapacityPool_capacity_check"',
    );
  });
});
