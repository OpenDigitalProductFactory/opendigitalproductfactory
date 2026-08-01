import { describe, it, expect } from "vitest";

import {
  resolveRequiredApprovers,
  changeNeedsHumanApproval,
} from "./required-approvers";
import { evaluateDataPolicy } from "./policy-decision";

const OPTS = { organizationId: "org-1" as const };

describe("condition → required human approver (BI-0B4B16CA)", () => {
  it("a PHI-classified field requires a named human approver (the end-to-end chain)", () => {
    // PatientProfile.accessibilityNeeds is classified regulatedScope=phi-health
    // by field-classification.ts (B2). The chain: classification → PDP →
    // human-approval obligation → named authority role.
    const approvers = resolveRequiredApprovers(
      ["PatientProfile.accessibilityNeeds"],
      OPTS,
    );
    expect(approvers).toHaveLength(1);
    expect(approvers[0]).toMatchObject({
      authorityRole: "HR-000",
      separationOfDuties: true,
      triggeredByField: "PatientProfile.accessibilityNeeds",
    });
    expect(changeNeedsHumanApproval(["PatientProfile.accessibilityNeeds"], OPTS)).toBe(true);
  });

  it("a non-regulated field (a Stripe token reference) requires NO human approver", () => {
    // Payment.stripePaymentId is financial but regulatedScope=none — NOT
    // cardholder data. It must not trigger a human-approval requirement.
    expect(resolveRequiredApprovers(["Payment.stripePaymentId"], OPTS)).toEqual([]);
    expect(changeNeedsHumanApproval(["Payment.stripePaymentId"], OPTS)).toBe(false);
  });

  it("a credential field requires NO human approver (secrets are a different axis)", () => {
    expect(changeNeedsHumanApproval(["ApiToken.token"], OPTS)).toBe(false);
  });

  it("an unclassified field requires no approver and does not throw", () => {
    expect(resolveRequiredApprovers(["SomeModel.someField", "not-a-key"], OPTS)).toEqual([]);
  });

  it("deduplicates by authority role across multiple regulated fields", () => {
    const approvers = resolveRequiredApprovers(
      ["PatientProfile.accessibilityNeeds", "PatientProfile.communicationPreferences"],
      OPTS,
    );
    // Both are phi-health → same HR-000 authority → one approver entry.
    expect(approvers).toHaveLength(1);
    expect(approvers[0].authorityRole).toBe("HR-000");
  });
});

describe("PDP emits human-approval on a regulated scope (the mechanism)", () => {
  it("evaluateDataPolicy returns a human-approval obligation for a phi-health write", () => {
    const decision = evaluateDataPolicy({
      organizationId: "org-1",
      action: "write",
      asset: "data:test",
      purpose: "platform-operations",
      classification: { known: true, regulatedScope: "phi-health" },
      environmentKnown: true,
      assetVersion: "n/a",
      classificationVersion: "n/a",
      authorityVersion: "n/a",
      policyBundleVersion: "default",
    });
    const human = decision.obligations.filter((o) => o.kind === "human-approval");
    expect(human).toHaveLength(1);
    expect(human[0]).toMatchObject({ kind: "human-approval", authorityRole: "HR-000" });
  });

  it("emits NO human-approval when regulatedScope is absent (backward compatible)", () => {
    const decision = evaluateDataPolicy({
      organizationId: "org-1",
      action: "write",
      asset: "data:test",
      purpose: "platform-operations",
      classification: { known: true, categories: ["operational"] },
      environmentKnown: true,
      assetVersion: "n/a",
      classificationVersion: "n/a",
      authorityVersion: "n/a",
      policyBundleVersion: "default",
    });
    expect(decision.obligations.some((o) => o.kind === "human-approval")).toBe(false);
  });
});
