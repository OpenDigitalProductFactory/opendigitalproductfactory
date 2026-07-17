import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");

describe("BusinessContext source system schema", () => {
  it("declares and migrates the optional sourceSystem field", () => {
    const schema = readFileSync(join(repoRoot, "packages/db/prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model BusinessContext \{[\s\S]*sourceSystem\s+String\?/);

    const migrationPath = join(
      repoRoot,
      "packages/db/prisma/migrations/20260717033000_add_business_context_source_system/migration.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);
    expect(readFileSync(migrationPath, "utf8")).toContain('ADD COLUMN "sourceSystem" TEXT');
  });
});
