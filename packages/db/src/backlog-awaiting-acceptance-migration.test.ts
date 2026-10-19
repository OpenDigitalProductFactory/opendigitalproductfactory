import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260907090000_add_backlog_awaiting_acceptance/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("BacklogItem awaiting-acceptance migration (BI-7161625D)", () => {
  it("widens the Prisma enum and CHECK without dropping legacy blocked", () => {
    expect(migrationSql).toContain("ALTER TYPE \"BacklogItemStatus\" ADD VALUE IF NOT EXISTS 'awaiting-acceptance'");
    expect(migrationSql).toContain("DROP CONSTRAINT IF EXISTS \"BacklogItem_status_closed_set\"");
    expect(migrationSql).toContain("'awaiting-acceptance'");
    expect(migrationSql).toContain("'blocked'");
    expect(migrationSql).toContain("VALIDATE CONSTRAINT \"BacklogItem_status_closed_set\"");
  });

  it("backfills coding-pool rows that already have a PR, and never writes done", () => {
    expect(migrationSql).toContain('"WorkCapsule"');
    expect(migrationSql).toContain("SET\n  status = 'awaiting-acceptance'");
    expect(migrationSql).not.toMatch(/status = 'done'/);
  });
});
