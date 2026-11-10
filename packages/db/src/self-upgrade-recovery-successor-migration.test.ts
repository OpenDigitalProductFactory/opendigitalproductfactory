import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260829160000_self_upgrade_recovery_successor/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("SelfUpgradeRun recovery successor migration", () => {
  it("statically asserts one unique audit relation and the bootstrap SQL predicates", () => {
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "SelfUpgradeRun_recoveryOfRunId_key"');
    expect(migrationSql).toContain('"active_count"."count" = 1');
    expect(migrationSql).toContain('"predecessor"."status" = \'failed\'');
    expect(migrationSql).toContain('"predecessor"."dispatchAttemptCount" = 0');
    expect(migrationSql).toContain('cardinality("predecessor"."dispatchEventIds") = 0');
    expect(migrationSql).toContain('"successor"."trigger" LIKE \'manual:%\'');
    expect(migrationSql).toContain('"successor"."dispatchStatus" IN (\'dispatching\', \'dispatched\')');
  });

  it("does not hard-code or rewrite the terminal predecessor", () => {
    expect(migrationSql).not.toContain("SUR-6B312E24");
    expect(migrationSql).not.toMatch(/SET\s+"(?:targetSha|targetTag|status|admissionFingerprint)"/i);
    expect(migrationSql).toContain('SET "recoveryOfRunId" = "candidate"."predecessorRunId"');
  });
});
