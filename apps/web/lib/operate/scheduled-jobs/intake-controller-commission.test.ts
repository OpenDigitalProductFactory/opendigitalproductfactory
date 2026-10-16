import { describe, expect, it } from "vitest";

import {
  INTAKE_CONTROLLER_COMMISSION_KEY,
  INTAKE_CONTROLLER_WORK_SHAPE,
  mergeIntakeControllerCommission,
  parseIntakeControllerCommission,
  type IntakeControllerCommission,
} from "./intake-controller-commission";

const commission: IntakeControllerCommission = {
  workroomCapsuleId: "WC-CONTROLLER",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  workShape: INTAKE_CONTROLLER_WORK_SHAPE,
  commissionedByPrincipalId: "principal-row-owner",
  commissionedAt: "2026-10-13T09:00:00.000Z",
};

describe("parseIntakeControllerCommission", () => {
  it("reads a complete commission reference from scheduled-job metadata", () => {
    expect(parseIntakeControllerCommission({ lastEditedBy: "ops", [INTAKE_CONTROLLER_COMMISSION_KEY]: commission }))
      .toEqual(commission);
  });

  it("treats absent or non-object metadata as uncommissioned", () => {
    expect(parseIntakeControllerCommission(null)).toBeNull();
    expect(parseIntakeControllerCommission(undefined)).toBeNull();
    expect(parseIntakeControllerCommission("commissioned")).toBeNull();
    expect(parseIntakeControllerCommission([commission])).toBeNull();
    expect(parseIntakeControllerCommission({ lastEditedBy: "ops" })).toBeNull();
  });

  it.each([
    ["workroomCapsuleId", ""],
    ["repositoryFullName", "no-slash"],
    ["workShape", "issue-triage-watch@2.0.0"],
    ["commissionedByPrincipalId", "  "],
    ["commissionedAt", "not a date"],
  ] as const)("rejects a commission whose %s is invalid", (field, value) => {
    expect(parseIntakeControllerCommission({
      [INTAKE_CONTROLLER_COMMISSION_KEY]: { ...commission, [field]: value },
    })).toBeNull();
  });
});

describe("mergeIntakeControllerCommission", () => {
  it("keeps every other metadata key", () => {
    const merged = mergeIntakeControllerCommission(
      { lastEditedBy: "ops", lastAction: "enable", staleness: { consecutiveErrors: 2 } },
      commission,
    );
    expect(merged).toEqual({
      lastEditedBy: "ops",
      lastAction: "enable",
      staleness: { consecutiveErrors: 2 },
      [INTAKE_CONTROLLER_COMMISSION_KEY]: commission,
    });
    expect(parseIntakeControllerCommission(merged)).toEqual(commission);
  });

  it("starts from an empty record when metadata is absent or malformed", () => {
    expect(mergeIntakeControllerCommission(null, commission))
      .toEqual({ [INTAKE_CONTROLLER_COMMISSION_KEY]: commission });
    expect(mergeIntakeControllerCommission(["x"], commission))
      .toEqual({ [INTAKE_CONTROLLER_COMMISSION_KEY]: commission });
  });

  it("replaces an earlier commission rather than accumulating them", () => {
    const first = mergeIntakeControllerCommission({}, commission);
    const second = mergeIntakeControllerCommission(first, { ...commission, workroomCapsuleId: "WC-NEXT" });
    expect(parseIntakeControllerCommission(second)?.workroomCapsuleId).toBe("WC-NEXT");
  });
});
