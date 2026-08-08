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
});
