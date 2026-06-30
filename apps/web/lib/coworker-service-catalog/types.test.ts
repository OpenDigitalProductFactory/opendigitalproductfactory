import { describe, expect, it } from "vitest";

import {
  COWORKER_AUTHORITY_BOUNDARIES,
  COWORKER_AVAILABILITY_SCOPES,
  COWORKER_CATALOG_RISK_TIERS,
  COWORKER_ENGAGEMENT_STATUSES,
  COWORKER_SERVICE_STATUSES,
  isCoworkerAuthorityBoundary,
  isCoworkerAvailabilityScope,
  isCoworkerCatalogRiskTier,
  isCoworkerEngagementStatus,
  isCoworkerServiceStatus,
} from "./types";

describe("coworker service catalog type guards", () => {
  it("accepts the closed service status vocabulary", () => {
    expect(COWORKER_SERVICE_STATUSES).toEqual(["draft", "active", "retired"]);
    expect(isCoworkerServiceStatus("active")).toBe(true);
    expect(isCoworkerServiceStatus("in-progress")).toBe(false);
  });

  it("accepts the closed risk and authority vocabularies", () => {
    expect(COWORKER_CATALOG_RISK_TIERS).toEqual(["low", "medium", "high", "critical"]);
    expect(COWORKER_AUTHORITY_BOUNDARIES).toEqual([
      "advice-only",
      "proposal-only",
      "approval-required",
      "autonomous-allowed",
      "never-allowed",
    ]);
    expect(isCoworkerCatalogRiskTier("critical")).toBe(true);
    expect(isCoworkerCatalogRiskTier("urgent")).toBe(false);
    expect(isCoworkerAuthorityBoundary("approval-required")).toBe(true);
    expect(isCoworkerAuthorityBoundary("approve_required")).toBe(false);
  });

  it("accepts engagement statuses and availability scopes", () => {
    expect(COWORKER_ENGAGEMENT_STATUSES).toEqual([
      "requested",
      "needs-approval",
      "accepted",
      "rejected",
      "in-progress",
      "completed",
      "cancelled",
    ]);
    expect(COWORKER_AVAILABILITY_SCOPES).toEqual(["internal", "external", "partner"]);
    expect(isCoworkerEngagementStatus("needs-approval")).toBe(true);
    expect(isCoworkerEngagementStatus("needs_approval")).toBe(false);
    expect(isCoworkerAvailabilityScope("external")).toBe(true);
    expect(isCoworkerAvailabilityScope("public")).toBe(false);
  });
});

