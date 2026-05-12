import { describe, expect, it } from "vitest";

import type { LicensingWorkspace } from "@/lib/licensing-workspace-types";
import { buildLicensingCoworkerTopics } from "./licensing-coworker-topics";

const workspace: LicensingWorkspace = {
  organization: {
    name: "Acme Field Services",
    slug: "acme-field-services",
  },
  profile: {
    setupStatus: "investigating",
    investigationMode: "expanding",
    homeCountryCode: "US",
    primaryRegionCode: "NV",
    operatingFootprintSummary: "Nevada headquarters with field work in Clark County and early Arizona expansion.",
    legalActivityConfidence: "medium",
    researchCoverageStatus: "partial",
    notes: "Need county-level permit verification.",
  },
  requirementOptions: [],
  holderOptions: [],
  organizationLicenses: [],
  personCredentials: [],
  displayObligations: [],
  feeSchedules: [],
  openIssues: [
    {
      id: "issue-1",
      title: "Las Vegas local permit verification missing",
      issueType: "missing_verification",
      severity: "high",
      details: null,
    },
  ],
  summary: {
    organizationLicenseCount: 2,
    personCredentialCount: 4,
    unsatisfiedDisplayCount: 1,
    pendingFeeCount: 3,
    openIssueCount: 1,
  },
};

describe("buildLicensingCoworkerTopics", () => {
  it("builds route-aware investigation topics with factual persistence instructions", () => {
    const topics = buildLicensingCoworkerTopics(workspace);

    expect(topics).toHaveLength(3);
    expect(topics[0]?.label).toBe("Map jurisdictions and legality");
    expect(topics[0]?.prompt).toContain("Acme Field Services");
    expect(topics[0]?.prompt).toContain("Save investigation findings");
    expect(topics[1]?.contextSummary).toContain("Open issues (1)");
    expect(topics[2]?.prompt).toContain("4 person credentials recorded");
    expect(topics[2]?.prompt).toContain("1 unsatisfied display obligations");
  });

  it("falls back cleanly when footprint and open issue detail are absent", () => {
    const topics = buildLicensingCoworkerTopics({
      ...workspace,
      profile: {
        ...workspace.profile,
        investigationMode: "unknown",
        homeCountryCode: null,
        primaryRegionCode: null,
        operatingFootprintSummary: null,
      },
      openIssues: [],
      summary: {
        ...workspace.summary,
        openIssueCount: 0,
      },
    });

    expect(topics[0]?.contextSummary).toContain("Unknown country");
    expect(topics[0]?.contextSummary).toContain("Operating footprint not yet captured.");
    expect(topics[0]?.contextSummary).toContain("No open readiness issues are currently recorded.");
  });
});
