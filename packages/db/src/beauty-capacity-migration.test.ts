import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../prisma/migrations/20260801100000_add_beauty_resource_capacity/migration.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

describe("beauty resource capacity migration", () => {
  it("is additive and attests why tightening is safe", () => {
    expect(migration).toContain(
      "@migration-safety: data-safe: all constrained beauty capacity tables are created empty",
    );
    expect(migration).not.toMatch(
      /DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE "(?:StorefrontBooking|BookingHold|ServiceProvider)"/,
    );
  });

  it("enforces resource capacity, positive intervals, and one demand source", () => {
    expect(migration).toContain('CONSTRAINT "BeautyResource_capacity_check"');
    expect(migration).toContain(
      'CONSTRAINT "BeautyCapacityAllocation_quantity_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "BeautyCapacityAllocation_interval_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "BeautyCapacityAllocation_one_demand_check"',
    );
    expect(migration).toMatch(/lifecycle" IN \('held', 'confirmed', 'active'\)[\s\S]*?<>/);
    expect(migration).toMatch(/lifecycle" IN \('released', 'cancelled'\)[\s\S]*?NOT/);
  });

  it("prevents overlapping consuming allocations on one physical resource", () => {
    expect(migration).toContain(
      'ADD CONSTRAINT "BeautyCapacityAllocation_no_resource_overlap"',
    );
    expect(migration).toContain("EXCLUDE USING gist");
    expect(migration).toMatch(
      /WHERE \("lifecycle" IN \('held', 'confirmed', 'active'\)\)/,
    );
  });

  it("keeps every cross-owner relation in the same organization", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("resourceId", "organizationId") REFERENCES "BeautyResource"("id", "organizationId")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("bookingId", "organizationId") REFERENCES "StorefrontBooking"("id", "organizationId")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("bookingHoldId", "organizationId") REFERENCES "BookingHold"("id", "organizationId")',
    );
  });
});
