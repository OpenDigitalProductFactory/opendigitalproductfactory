import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const schema = readFileSync(
  join(repoRoot, "packages/db/prisma/schema.prisma"),
  "utf8",
);
const migrationPath = join(
  repoRoot,
  "packages/db/prisma/migrations/20260717120000_add_workforce_staffing_substrate/migration.sql",
);

// EP-WORKFORCE-OPS / BI-4AD09A35 Phase 1 — the staffing substrate.
// Spec: docs/superpowers/specs/2026-07-17-organization-workforce-staffing-scheduling-design.md
describe("workforce staffing substrate schema", () => {
  const models = [
    "StaffingDemand",
    "StaffingShift",
    "StaffingAssignment",
    "StaffingAssignmentEvent",
    "StaffingCrew",
    "StaffingCrewMember",
    "StaffingResourceLink",
    "EmployeeAvailabilityWindow",
    "EmployeeSchedulingPreference",
    "StaffingConstraintRule",
    "StaffingProposalRun",
    "StaffingProposalOption",
    "StaffingExceptionRequest",
    "WorkforceCandidateFact",
  ];

  it("declares every staffing aggregate", () => {
    for (const model of models) {
      expect(schema).toMatch(new RegExp(`model ${model} \\{`));
    }
  });

  it("makes demandShape a first-class discriminator on StaffingDemand (spec §9.9.1)", () => {
    expect(schema).toMatch(/model StaffingDemand \{[\s\S]*demandShape\s+String/);
    // the five demand shapes are documented as allowed values
    for (const shape of [
      "coverage_floor",
      "forecast_curve",
      "fixed_slot",
      "task_pipeline",
      "census_load",
    ]) {
      expect(schema).toContain(shape);
    }
  });

  it("supports the offer/claim lifecycle for non-commanded capacity (spec §9.9.4)", () => {
    const block = schema.match(/model StaffingAssignment \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/assignmentMode\s+String/);
    expect(block).toContain("offer_claim");
    expect(block).toContain("offered");
    expect(block).toContain("claimed");
  });

  it("carries optimistic-concurrency version columns on the mutable aggregates (spec §5.3)", () => {
    for (const model of [
      "StaffingShift",
      "StaffingAssignment",
      "EmployeeAvailabilityWindow",
      "EmployeeSchedulingPreference",
      "StaffingConstraintRule",
    ]) {
      const block = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
      expect(block, `${model} needs a version column`).toMatch(/\n\s*version\s+Int\s+@default\(1\)/);
    }
  });

  it("keeps assignment history append-only (spec §5.3)", () => {
    expect(schema).toMatch(/model StaffingAssignmentEvent \{[\s\S]*atVersion\s+Int/);
  });

  it("models constraints as typed hard/soft predicates (spec §9.8)", () => {
    const block = schema.match(/model StaffingConstraintRule \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/predicateType\s+String/);
    expect(block).toMatch(/severity\s+String\s+@default\("hard"\)/);
    expect(block).toMatch(/legallyWaivable\s+Boolean/);
  });

  it("keeps a proposal run immutable and option-producing (spec §5.1.7)", () => {
    expect(schema).toMatch(/model StaffingProposalRun \{[\s\S]*options\s+StaffingProposalOption\[\]/);
  });

  it("stages candidate facts as non-authoritative until reviewed (spec §5.1.9)", () => {
    const block = schema.match(/model WorkforceCandidateFact \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/reviewState\s+String\s+@default\("pending"\)/);
    expect(block).toMatch(/promotionTargetType\s+String\?/);
  });

  describe("migration", () => {
    it("exists", () => {
      expect(existsSync(migrationPath)).toBe(true);
    });

    it("is additive — creates every aggregate table and drops none", () => {
      const sql = readFileSync(migrationPath, "utf8");
      for (const model of models) {
        expect(sql).toContain(`CREATE TABLE "${model}"`);
      }
      expect(sql).not.toMatch(/DROP TABLE/);
    });
  });
});
