import { describe, expect, it } from "vitest";

import {
  determineContributionMergeReadiness,
  generateReviewReport,
  type ParameterizationReport,
  type SanitizationReport,
  type VerticalReport,
} from "./contribution-review";
import type { SeedContributionFitReport } from "./seed-contribution-fit";

const sanitization: SanitizationReport = {
  passed: true,
  findings: [],
  orgName: "",
  mustFixCount: 0,
  reviewCount: 0,
};
const parameterization: ParameterizationReport = {
  scope: "already_generic",
  checks: [],
  overallVerdict: "pass",
};
const verticals: VerticalReport = {
  sourceVertical: "unknown",
  applicableVerticals: [],
};

function seedFit(
  decision: SeedContributionFitReport["decision"],
  mergeEligible: boolean,
): SeedContributionFitReport {
  return {
    touchesSeededContent: decision !== null,
    changedSeedPaths: decision ? ["packages/db/src/seed-skills.ts"] : [],
    decision,
    distributionScope: mergeEligible && decision !== "parameterize-first" && decision !== "install-local-only" && decision !== "reject-as-seed"
      ? decision
      : null,
    applicableArchetypeCategories: [],
    applicableVerticals: [],
    sourceVertical: "unknown",
    rationale: "Reviewed seed-fit rationale.",
    mergeEligible,
  };
}

describe("determineContributionMergeReadiness", () => {
  it("allows reviewed fleet or scoped seed distributions", () => {
    expect(determineContributionMergeReadiness({
      securityPassed: true,
      sanitization,
      parameterization,
      seedFit: seedFit("global-default", true),
    })).toBe("ready");
  });

  it("requires work for parameterize-first and install-local-only seed changes", () => {
    for (const decision of ["parameterize-first", "install-local-only"] as const) {
      expect(determineContributionMergeReadiness({
        securityPassed: true,
        sanitization,
        parameterization,
        seedFit: seedFit(decision, false),
      })).toBe("needs-work");
    }
  });

  it("blocks rejected or security-failing seed changes", () => {
    expect(determineContributionMergeReadiness({
      securityPassed: true,
      sanitization,
      parameterization,
      seedFit: seedFit("reject-as-seed", false),
    })).toBe("blocked");
    expect(determineContributionMergeReadiness({
      securityPassed: false,
      sanitization,
      parameterization,
      seedFit: seedFit("global-default", true),
    })).toBe("blocked");
  });
});

describe("generateReviewReport seed fit", () => {
  it("makes the decision and affected seed path visible in the PR review", () => {
    const report = generateReviewReport(
      sanitization,
      parameterization,
      verticals,
      seedFit("global-default", true),
      true,
      {},
      "ready",
    );

    expect(report).toContain("### Seed Contribution Fit");
    expect(report).toContain("**global-default**");
    expect(report).toContain("`packages/db/src/seed-skills.ts`");
    expect(report).toContain("`seed-fit:global-default`");
  });
});
