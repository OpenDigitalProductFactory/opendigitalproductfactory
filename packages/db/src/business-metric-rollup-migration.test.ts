import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const prepareMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812020000_prepare_business_metric_rollup_closed_sets/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const conversionMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812020500_type_business_metric_rollup_closed_sets/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const restoreMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260812021000_restore_business_metric_rollup_availability_check/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("BusinessMetricRollup closed-set migration", () => {
  it("removes and restores the availability check around the enum conversion", () => {
    expect(prepareMigrationSql).toContain(
      'DROP CONSTRAINT "BusinessMetricRollup_availability_check"',
    );
    expect(conversionMigrationSql).toContain(
      'ALTER COLUMN "availability" TYPE "BusinessMetricAvailability"',
    );
    expect(restoreMigrationSql).toContain(
      'ADD CONSTRAINT "BusinessMetricRollup_availability_check"',
    );
  });
});
