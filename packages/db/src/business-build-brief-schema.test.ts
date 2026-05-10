import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");

describe("BusinessBuildBrief schema contract", () => {
  it("declares reviewed brief lifecycle enums", () => {
    expect(schema).toContain("enum IntakeSource");
    expect(schema).toContain("user_conversation");
    expect(schema).toContain("existing_example");
    expect(schema).toContain("coworker_proposal");
    expect(schema).toContain("innovation_radar");

    expect(schema).toContain("enum BriefStatus");
    expect(schema).toContain("awaiting_clarification");
    expect(schema).toContain("converted_to_build");

    expect(schema).toContain("enum BriefConfidence");
    expect(schema).toContain("high");
    expect(schema).toContain("medium");
    expect(schema).toContain("low");
  });

  it("stores BusinessBuildBrief as a first-class model instead of only FeatureBuild.brief JSON", () => {
    expect(schema).toContain("model BusinessBuildBrief");
    expect(schema).toMatch(/briefId\s+String\s+@unique/);
    expect(schema).toMatch(/status\s+BriefStatus/);
    expect(schema).toMatch(/intakeSource\s+IntakeSource/);
    expect(schema).toMatch(/featureBuildId\s+String\?\s+@unique/);
    expect(schema).toMatch(/sourceEvidence\s+Json\s+@default\("\[\]"\)/);
    expect(schema).toContain("@@index([orgId, status])");
    expect(schema).toContain("@@index([orgId, capabilityPackId])");
  });
});
