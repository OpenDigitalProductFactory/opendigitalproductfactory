import { describe, expect, it } from "vitest";

import {
  measureRosterCoverage,
  PLATFORM_ORCHESTRATOR_SLUGS,
  requiredCoverageSlugs,
} from "./archetype-roster-coverage";

describe("measureRosterCoverage", () => {
  it("names missing required roles and counts staffed against the required set", () => {
    const coverage = measureRosterCoverage({
      required: ["security-engineer", "coo-orchestrator"],
      staffed: ["security-engineer"],
    });
    expect(coverage.requiredCount).toBe(2);
    expect(coverage.staffedCount).toBe(1);
    expect(coverage.missing).toEqual(["coo-orchestrator"]);
  });

  it("treats slug aliases and canonical ids as the same staffed role", () => {
    const coverage = measureRosterCoverage({
      required: ["coo-orchestrator", "build-specialist"],
      staffed: ["coo", "AGT-WS-BUILD"],
    });
    expect(coverage.missing).toEqual([]);
    expect(coverage.staffedCount).toBe(2);
  });

  it("treats coo-orchestrator, coo, and AGT-ORCH-000 as one role", () => {
    expect(
      measureRosterCoverage({
        required: ["coo-orchestrator"],
        staffed: ["AGT-ORCH-000"],
      }).missing,
    ).toEqual([]);
    expect(
      measureRosterCoverage({
        required: ["coo-orchestrator"],
        staffed: ["coo-orchestrator"],
      }).missing,
    ).toEqual([]);
  });

  it("does not count extra staffed coworkers as covering unrequired roles", () => {
    const coverage = measureRosterCoverage({
      required: ["security-engineer"],
      staffed: ["security-engineer", "farm-ranch-steward"],
    });
    expect(coverage.staffedCount).toBe(1);
    expect(coverage.requiredCount).toBe(1);
    expect(coverage.missing).toEqual([]);
  });
});

describe("requiredCoverageSlugs", () => {
  it("unions archetype roster slugs with the nine platform orchestrators", () => {
    const slugs = requiredCoverageSlugs(["security-engineer"]);
    expect(slugs).toEqual(expect.arrayContaining(["security-engineer", ...PLATFORM_ORCHESTRATOR_SLUGS]));
    expect(PLATFORM_ORCHESTRATOR_SLUGS).toEqual([
      "coo-orchestrator",
      "evaluate-orchestrator",
      "explore-orchestrator",
      "integrate-orchestrator",
      "deploy-orchestrator",
      "release-orchestrator",
      "consume-orchestrator",
      "operate-orchestrator",
      "governance-orchestrator",
    ]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
