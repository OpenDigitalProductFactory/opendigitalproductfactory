import { describe, expect, it } from "vitest";
import {
  resolveProcessingActivityAuthority,
  validateDataPolicyException,
  type ProcessingActivityRecord,
} from "./processing-activity-service";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function activity(
  overrides: Partial<ProcessingActivityRecord> = {},
): ProcessingActivityRecord {
  return {
    activityId: "DPA-CUSTOMER-SUPPORT",
    purposeKey: "customer-support",
    ownerRef: "employee:steward",
    status: "confirmed",
    assetIds: ["asset.customer"],
    fieldIds: [],
    dataCategories: ["contact"],
    subjectTypes: ["customer"],
    authorityRefs: ["REG-GDPR"],
    recipientRefs: [],
    destinationClasses: ["local"],
    residencyConstraints: ["eu"],
    transferConstraints: [],
    lifecycleClassIds: ["customer-record"],
    executablePolicyIds: ["data.customer-support.v1"],
    highRisk: false,
    dpiaRequired: false,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    reviewAt: new Date("2027-01-01T00:00:00.000Z"),
    confirmedAt: new Date("2026-01-02T00:00:00.000Z"),
    confirmedByRef: "employee:privacy-owner",
    ...overrides,
  };
}

describe("resolveProcessingActivityAuthority", () => {
  it("authorizes only a complete confirmed activity in its effective window", () => {
    expect(
      resolveProcessingActivityAuthority({
        activities: [activity()],
        purposeKey: "customer-support",
        assetId: "asset.customer",
        dataCategories: ["contact"],
        subjectType: "customer",
        at: NOW,
      }),
    ).toEqual({
      posture: "confirmed",
      explanationCode: "processing-activity-confirmed",
      activityIds: ["DPA-CUSTOMER-SUPPORT"],
      executablePolicyIds: ["data.customer-support.v1"],
    });
  });

  it.each([
    ["draft", activity({ status: "review" }), "processing-activity-not-confirmed"],
    [
      "missing accountable confirmation",
      activity({ confirmedAt: null, confirmedByRef: null }),
      "processing-activity-incomplete",
    ],
    [
      "expired",
      activity({ effectiveUntil: new Date("2026-07-01T00:00:00.000Z") }),
      "processing-activity-expired",
    ],
    [
      "missing authority",
      activity({ authorityRefs: [] }),
      "processing-activity-incomplete",
    ],
  ])("fails closed for %s", (_label, candidate, explanationCode) => {
    const result = resolveProcessingActivityAuthority({
      activities: [candidate],
      purposeKey: "customer-support",
      assetId: "asset.customer",
      dataCategories: ["contact"],
      subjectType: "customer",
      at: NOW,
    });

    expect(result.posture).not.toBe("confirmed");
    expect(result.explanationCode).toBe(explanationCode);
  });

  it("does not let a broad purpose match authorize an asset outside its scope", () => {
    const result = resolveProcessingActivityAuthority({
      activities: [activity()],
      purposeKey: "customer-support",
      assetId: "asset.employee",
      dataCategories: ["contact"],
      subjectType: "employee",
      at: NOW,
    });

    expect(result).toEqual({
      posture: "review",
      explanationCode: "processing-activity-no-match",
      activityIds: [],
      executablePolicyIds: [],
    });
  });
});

describe("validateDataPolicyException", () => {
  it("requires bounded scope, approval, rationale, control, expiry, and remediation", () => {
    const result = validateDataPolicyException(
      {
        status: "approved",
        scope: {},
        approverRef: null,
        approvedAt: null,
        rationale: null,
        compensatingControl: null,
        expiresAt: null,
        remediationItemId: null,
      },
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "scope-required",
      "approver-required",
      "approval-time-required",
      "rationale-required",
      "compensating-control-required",
      "expiry-required",
      "remediation-item-required",
    ]);
  });

  it("rejects an approved exception whose expiry is not in the future", () => {
    expect(
      validateDataPolicyException(
        {
          status: "approved",
          scope: { assetIds: ["asset.customer"] },
          approverRef: "employee:privacy-owner",
          approvedAt: new Date("2026-07-20T00:00:00.000Z"),
          rationale: "Temporary compatibility requirement",
          compensatingControl: "Daily access review",
          expiresAt: new Date("2026-07-26T00:00:00.000Z"),
          remediationItemId: "BI-DG-999",
        },
        NOW,
      ).errors,
    ).toContain("expiry-must-be-future");
  });
});
