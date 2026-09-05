import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error The guard is a checked JavaScript module without a declaration file.
import { analyzeAddColumnNotNull, analyzeMigration } from "../scripts/migration-safety-guard.mjs";

const packageDir = resolve(__dirname, "..");
const schema = (name: string) => readFileSync(resolve(packageDir, "prisma/schema", name), "utf8");
const expandMigration = () => readFileSync(
  resolve(packageDir, "prisma/migrations/20260904090000_pet_rescue_operating_system/migration.sql"),
  "utf8",
);

describe("Pet Rescue operating data model", () => {
  it("separates operational animal identity from its optional public listing", () => {
    const storefront = schema("verticals-storefront.prisma");
    expect(storefront).toContain("model AnimalProfile {");
    expect(storefront).toContain("animalProfileId");
    expect(storefront).toContain("AnimalCustodyEpisode");
    expect(storefront).toContain("AnimalCustodyEvent");
    expect(storefront).toContain("@@unique([organizationId, animalRef])");
    expect(storefront).toContain("@@unique([animalProfileId, episodeNumber])");
  });

  it("uses shared care, work, and finance subject dimensions", () => {
    expect(schema("verticals-care.prisma")).toContain("model CareRecord {");
    expect(schema("ai-coworker.prisma")).toContain("subjectKindSlug");
    expect(schema("ai-coworker.prisma")).toContain("locationResourceRef");
    expect(schema("finance.prisma")).toContain("model FinancialFund {");
    expect(schema("finance.prisma")).toContain("subjectKindSlug");
    expect(schema("finance.prisma")).toContain("fundId");
  });

  it("persists adoption applications and placement history", () => {
    const storefront = schema("verticals-storefront.prisma");
    expect(storefront).toContain("model AnimalAdoptionApplication {");
    expect(storefront).toContain("model AnimalPlacement {");
    expect(storefront).toContain("AnimalAdoptionApplicationStatus");
    expect(storefront).toContain("AnimalPlacementStatus");
  });
});

describe("Pet Rescue expand migration", () => {
  it("backfills identity without inventing custody, care, or placement facts", () => {
    const sql = expandMigration();
    expect(sql).toContain('INSERT INTO "AnimalProfile"');
    expect(sql).toContain('FROM "AdoptableAnimal"');
    expect(sql).toContain('UPDATE "AdoptableAnimal"');
    expect(sql).not.toMatch(/INSERT INTO "AnimalCustodyEpisode"/);
    expect(sql).not.toMatch(/INSERT INTO "CareRecord"/);
    expect(sql).not.toMatch(/INSERT INTO "AnimalPlacement"/);
  });

  it("attests each nullable fund link immediately before its foreign key", () => {
    const sql = expandMigration();
    const cases = [
      {
        table: "StorefrontDonation",
        subject: "donation",
        deleteRule: "SET NULL",
      },
      {
        table: "JournalLine",
        subject: "journal line",
        deleteRule: "RESTRICT",
      },
    ] as const;

    for (const item of cases) {
      const column = `ALTER TABLE "${item.table}" ADD COLUMN "fundId" TEXT;`;
      const attestation = `-- @migration-safety: data-safe: fundId is a newly added nullable column, so every pre-existing ${item.subject} is NULL before this constraint is installed.`;
      const foreignKey = `ALTER TABLE "${item.table}" ADD CONSTRAINT "${item.table}_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "FinancialFund"("id") ON DELETE ${item.deleteRule} ON UPDATE CASCADE;`;
      const columnAt = sql.indexOf(column);
      const attestationAt = sql.indexOf(attestation);
      const foreignKeyAt = sql.indexOf(foreignKey);

      expect(columnAt).toBeGreaterThan(-1);
      expect(attestationAt).toBeGreaterThan(columnAt);
      expect(foreignKeyAt).toBeGreaterThan(attestationAt);
      expect(sql.slice(attestationAt, foreignKeyAt).trim()).toBe(attestation);
      expect(column).not.toContain("NOT NULL");
      expect(sql.slice(columnAt, foreignKeyAt)).not.toMatch(
        new RegExp(`(?:UPDATE|INSERT\\s+INTO)\\s+"${item.table}"`, "i"),
      );
    }

    expect(analyzeMigration(sql)).toEqual([]);
    expect(analyzeAddColumnNotNull(sql)).toEqual([]);
  });

  it("would report both legacy-table foreign keys without their exact attestations", () => {
    const unattested = expandMigration().replace(
      /^-- @migration-safety: data-safe: fundId .*\r?\n/gm,
      "",
    );

    expect(analyzeMigration(unattested).map((finding: { table: string }) => finding.table)).toEqual([
      "StorefrontDonation",
      "JournalLine",
    ]);
  });

  it("aligns care corrections to the shared record lifecycle convention", () => {
    const sql = readFileSync(
      resolve(packageDir, "prisma/migrations/20260904091500_align_care_record_lifecycle/migration.sql"),
      "utf8",
    );
    expect(sql).toContain('"lifecycle" "RecordLifecycle"');
    expect(sql).toContain('"successorId"');
    expect(sql).toContain('DROP TYPE "CareRecordStatus"');
  });
});
