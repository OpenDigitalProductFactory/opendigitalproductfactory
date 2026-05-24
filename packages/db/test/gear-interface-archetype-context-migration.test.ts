import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  __dirname,
  "../prisma/migrations/20260524210500_backfill_gear_interface_archetype_context/migration.sql",
);

describe("GearInterface archetypeContext backfill migration", () => {
  it("rewrites FK-valued Ring 2+ archetype contexts to semantic StorefrontArchetype.archetypeId slugs", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain('UPDATE "GearInterface"');
    expect(sql).toContain('FROM "StorefrontArchetype"');
    expect(sql).toContain('"archetypeContext" = sa."archetypeId"');
    expect(sql).toContain('gi."archetypeContext" = sa."id"');
    expect(sql).toContain('gi."innerRing" >= 2');
  });

  it("adds the Ring 2+ invariant exception only for archetype-unresolved slips", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain('"GearInterface_ring2_archetype_context_check"');
    expect(sql).toContain('"slipReason" = \'archetype-unresolved\'');
    expect(sql).toContain('"slipDetected" = true');
    expect(sql).toContain('"outcomeType" = \'slip\'');
  });
});
