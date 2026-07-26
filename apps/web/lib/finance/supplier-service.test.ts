import { describe, expect, it } from "vitest";
import {
  evaluateSupplierOnboardingPosture,
  canTransitionSupplierStatus,
} from "./supplier-service";

describe("evaluateSupplierOnboardingPosture", () => {
  it("returns 100% score and complete when all items are present", () => {
    const evaluation = evaluateSupplierOnboardingPosture({
      hasTaxId: true,
      hasBankDetails: true,
      hasSignedContract: true,
      hasInsuranceCertificate: true,
    });

    expect(evaluation.score).toBe(100);
    expect(evaluation.isComplete).toBe(true);
    expect(evaluation.missingItems).toHaveLength(0);
  });

  it("identifies missing onboarding items and computes fractional score", () => {
    const evaluation = evaluateSupplierOnboardingPosture({
      hasTaxId: true,
      hasBankDetails: true,
      hasSignedContract: false,
      hasInsuranceCertificate: false,
    });

    expect(evaluation.score).toBe(50);
    expect(evaluation.isComplete).toBe(false);
    expect(evaluation.missingItems).toEqual(["hasSignedContract", "hasInsuranceCertificate"]);
  });

  it("returns 0% when no onboarding requirements are met", () => {
    const evaluation = evaluateSupplierOnboardingPosture({
      hasTaxId: false,
      hasBankDetails: false,
      hasSignedContract: false,
      hasInsuranceCertificate: false,
    });

    expect(evaluation.score).toBe(0);
    expect(evaluation.isComplete).toBe(false);
    expect(evaluation.missingItems).toHaveLength(4);
  });
});

describe("canTransitionSupplierStatus", () => {
  it("allows same-status transitions", () => {
    expect(canTransitionSupplierStatus("active", "active")).toEqual({ allowed: true });
    expect(canTransitionSupplierStatus("blocked", "blocked")).toEqual({ allowed: true });
  });

  it("allows standard transition paths", () => {
    expect(canTransitionSupplierStatus("onboarding", "active")).toEqual({ allowed: true });
    expect(canTransitionSupplierStatus("active", "blocked")).toEqual({ allowed: true });
    expect(canTransitionSupplierStatus("blocked", "onboarding")).toEqual({ allowed: true });
  });

  it("blocks direct transition from blocked to active without review", () => {
    const check = canTransitionSupplierStatus("blocked", "active");
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Blocked supplier must transition to onboarding or inactive");
  });
});
