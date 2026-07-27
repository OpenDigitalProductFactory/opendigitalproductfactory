import { describe, expect, it } from "vitest";
import {
  COWORKER_AGENT_SEEDS,
  getDefaultEmploymentTypes,
  getDefaultWorkLocations,
  resolveCoworkerLifecycleSeedPolicy,
} from "./workforce-seed";

describe("workforce seed defaults", () => {
  it("returns stable employment types", () => {
    expect(getDefaultEmploymentTypes().map((item) => item.employmentTypeId)).toEqual([
      "emp-full-time",
      "emp-part-time",
      "emp-contractor",
      "emp-intern",
      "emp-advisor",
    ]);
  });

  it("returns a default remote work location", () => {
    expect(getDefaultWorkLocations().map((item) => item.locationId)).toContain("loc-remote");
  });

  it("keeps the Change Reviewer in draft until certification and explicit promotion", () => {
    const reviewer = COWORKER_AGENT_SEEDS.find((item) => item.agentId === "change-reviewer");

    expect(reviewer).toMatchObject({ initialLifecycleStage: "draft" });
    expect(resolveCoworkerLifecycleSeedPolicy(reviewer!)).toEqual({
      create: { lifecycleStage: "draft" },
      update: {},
    });
  });

  it("preserves production defaults for established built-ins without reseed promotion", () => {
    const builder = COWORKER_AGENT_SEEDS.find((item) => item.agentId === "build-specialist");

    expect(resolveCoworkerLifecycleSeedPolicy(builder!)).toEqual({
      create: { lifecycleStage: "production" },
      update: {},
    });
  });
});
