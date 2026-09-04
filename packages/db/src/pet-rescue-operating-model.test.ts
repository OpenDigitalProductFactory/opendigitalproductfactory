import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = (name: string) => readFileSync(resolve(process.cwd(), "prisma/schema", name), "utf8");

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
    const sql = readFileSync(
      resolve(process.cwd(), "prisma/migrations/20260904090000_pet_rescue_operating_system/migration.sql"),
      "utf8",
    );
    expect(sql).toContain('INSERT INTO "AnimalProfile"');
    expect(sql).toContain('FROM "AdoptableAnimal"');
    expect(sql).toContain('UPDATE "AdoptableAnimal"');
    expect(sql).not.toMatch(/INSERT INTO "AnimalCustodyEpisode"/);
    expect(sql).not.toMatch(/INSERT INTO "CareRecord"/);
    expect(sql).not.toMatch(/INSERT INTO "AnimalPlacement"/);
  });
});
