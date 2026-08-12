import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260808183000_repair_restaurant_demo_floor/migration.sql",
    import.meta.url,
  ),
);
const sql = readFileSync(migrationPath, "utf8");
const privacyMigrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260808184500_minimize_restaurant_demo_guest_data/migration.sql",
    import.meta.url,
  ),
);
const privacySql = readFileSync(privacyMigrationPath, "utf8");
const bookingCapacityMigrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260812070000_repair_restaurant_booking_capacity/migration.sql",
    import.meta.url,
  ),
);
const bookingCapacitySql = readFileSync(bookingCapacityMigrationPath, "utf8");
const busyShiftRefreshPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260812103000_refresh_restaurant_demo_busy_shift/migration.sql",
    import.meta.url,
  ),
);
const busyShiftRefreshSql = readFileSync(busyShiftRefreshPath, "utf8");
const busyShiftGuardPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260812102900_guard_restaurant_demo_busy_shift/migration.sql",
    import.meta.url,
  ),
);
const busyShiftGuardSql = readFileSync(busyShiftGuardPath, "utf8");

describe("restaurant demo floor migration", () => {
  it("targets only platform-owned demo restaurant rows", () => {
    expect(sql).toContain("^demo-restaurant-prov-res-[0-8]$");
    expect(sql).toContain("^demo-restaurant-bk-[0-6]$");
    expect(sql).toContain("archetype.\"archetypeId\" = 'restaurant'");
    expect(sql).not.toMatch(/WHERE\s+archetype\.category\s*=\s*'food-hospitality'/);
  });

  it("authors areas, capacity, server sections, combined turns, and wait pressure", () => {
    expect(sql).toContain("'Main dining'");
    expect(sql).toContain("'Window room'");
    expect(sql).toContain("'Patio'");
    expect(sql).toContain("INTERVAL '-14 minutes'");
    expect(sql).toContain("'demo-restaurant-assignment-' || turn.section_index");
    expect(sql).toContain('"actorRef", "occurredAt"');
    expect(sql).toContain("'stage-transition'");
    expect(sql).toContain("(4, 'demo-restaurant-table-5')");
    expect(sql).toContain("(4, 'demo-restaurant-table-6')");
    expect(sql).toContain("'dirty'");
    expect(sql).toContain("'paid'");
  });

  it("releases prior active demo allocations instead of deleting history", () => {
    expect(sql).toContain("lifecycle = 'released'");
    expect(sql).toContain("Restaurant demo state refreshed");
    expect(sql).not.toMatch(/DELETE FROM \"HospitalityCapacityAllocation\"/);
  });

  it("does not manufacture or retain sensitive guest notes", () => {
    expect(privacySql).toContain('"dietaryNotes" = NULL');
    expect(privacySql).toContain("^demo-restaurant-bk-[0-6]$");
    expect(privacySql).toContain("archetype.\"archetypeId\" = 'restaurant'");
  });

  it("projects demo tables into booking services without retaining generic providers", () => {
    expect(bookingCapacitySql).toContain('INSERT INTO "ProviderService"');
    expect(bookingCapacitySql).toContain('INSERT INTO "ProviderAvailability"');
    expect(bookingCapacitySql).toContain('INSERT INTO "HospitalityResourceAvailability"');
    expect(bookingCapacitySql).toContain("^demo-restaurant-prov-res-[0-8]$");
    expect(bookingCapacitySql).toContain("archetype.\"archetypeId\" = 'restaurant'");
    expect(bookingCapacitySql).toContain('DELETE FROM "ProviderService"');
  });

  it("keeps only the Restaurant demo roster durable and restores its busy-shift state", () => {
    expect(busyShiftRefreshSql).toContain("TIMESTAMPTZ '2100-01-01 00:00:00+00'");
    expect(busyShiftRefreshSql).toContain("^demo-restaurant-bk-[0-6]$");
    expect(busyShiftRefreshSql).toContain("archetype.\"archetypeId\" = 'restaurant'");
    expect(busyShiftRefreshSql).toContain("Restaurant demo busy shift refreshed");
    expect(busyShiftRefreshSql).toContain("(0, 'waiting',   INTERVAL '0 minutes',    INTERVAL '-14 minutes')");
    expect(busyShiftRefreshSql).toContain("(1, 'confirmed', INTERVAL '9 minutes',    INTERVAL '-120 minutes')");
    expect(busyShiftRefreshSql).toContain("(3, 'dirty',   INTERVAL '-100 minutes', INTERVAL '-10 minutes', 1)");
    expect(busyShiftRefreshSql).toContain("(5, 'paid',    INTERVAL '-84 minutes',  INTERVAL '6 minutes',  2)");
    expect(busyShiftRefreshSql).toContain("(4, 'demo-restaurant-table-5')");
    expect(busyShiftRefreshSql).toContain("(4, 'demo-restaurant-table-6')");
    expect(busyShiftRefreshSql).toContain("'demo-restaurant-reservation-table-9'");
    expect(busyShiftRefreshSql).not.toMatch(/DELETE FROM \"HospitalityCapacityAllocation\"/);
  });

  it("fails closed before the refresh when a reserved demo identifier belongs to other data", () => {
    expect(busyShiftGuardPath).toContain("20260812102900_guard_restaurant_demo_busy_shift");
    expect(busyShiftGuardPath.localeCompare(busyShiftRefreshPath)).toBeLessThan(0);
    expect(busyShiftGuardSql.match(/RAISE EXCEPTION/g)).toHaveLength(5);
    for (const reservedKind of ["booking", "shift", "assignment", "turn", "allocation"]) {
      expect(busyShiftGuardSql).toContain(
        `Reserved Restaurant demo ${reservedKind} identifiers are attached to non-demo data`,
      );
    }
    expect(busyShiftGuardSql).toContain("^demo-restaurant-bk-[0-6]$");
    expect(busyShiftGuardSql).toContain("^demo-restaurant-turn-[2-6]$");
    expect(busyShiftGuardSql).toContain("archetype.\"archetypeId\" = 'restaurant'");
    expect(busyShiftGuardSql).toContain("booking.\"organizationId\" = allocation.\"organizationId\"");
    expect(busyShiftGuardSql).toContain("booking.\"storefrontId\" = allocation.\"storefrontId\"");
  });
});
