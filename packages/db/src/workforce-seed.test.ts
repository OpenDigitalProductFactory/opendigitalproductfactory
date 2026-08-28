import { describe, expect, it } from "vitest";
import {
  COWORKER_AGENT_SEEDS,
  HARDCODED_COWORKER_GRANTS,
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
      "emp-volunteer",
    ]);
  });

  // A shelter's largest labour pool had no worker class at all, so a volunteer
  // could not be recorded (BI-A30152B6). `WorkerClassification` already carried
  // `volunteer` and named it the majority nonprofit case.
  it("can record an unpaid worker, and says which legal axis that is", () => {
    const volunteer = getDefaultEmploymentTypes().find((item) => item.name === "Volunteer");
    expect(volunteer).toMatchObject({ classification: "volunteer" });
  });

  // The four rows whose classification a migration deliberately left unresolved
  // stay unresolved: a guess here writes a legal claim into the database.
  it("claims a classification only where the label states it outright", () => {
    const unclassified = getDefaultEmploymentTypes()
      .filter((item) => !("classification" in item))
      .map((item) => item.name);
    expect(unclassified).toEqual(["Full-time", "Part-time", "Contractor", "Intern", "Advisor"]);
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

  it("seeds the Time-off Advisor as a confidential draft with least-privilege grants", () => {
    expect(COWORKER_AGENT_SEEDS.find((item) => item.agentId === "time-off-advisor")).toMatchObject({
      name: "Time-off Advisor",
      valueStream: "operate",
      sensitivity: "confidential",
      initialLifecycleStage: "draft",
    });
    expect(HARDCODED_COWORKER_GRANTS["time-off-advisor"]).toEqual([
      "consumer_read",
      "registry_read",
    ]);
  });
});
