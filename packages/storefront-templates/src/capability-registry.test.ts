import { describe, expect, it } from "vitest";

import {
  CAPABILITY_KEYS,
  CAPABILITY_REGISTRY,
  getCapabilitySetupPrompt,
  isCapabilityKey,
} from "./capability-registry";

describe("capability registry", () => {
  it("owns the legal capability key set used by archetype applicability", () => {
    expect(CAPABILITY_KEYS).toEqual([
      "customer-accounts",
      "customer-sites",
      "customer-estate",
      "edge-node-customer-deployment",
      "network-inventory",
      "cybersecurity-posture",
      "backup-restore-posture",
      "service-agreements",
      "recurring-agreement-billing",
      "billing-readiness",
      "appointment-checkout",
      "point-of-sale",
      "project-work",
      "lifecycle-review-queues",
      "remote-support",
      "partner-program",
      "member-governance",
      "membership-eligibility",
      "member-equity",
      "public-body-governance",
      "records-request",
      "service-request-311",
      "rental-fleet",
      "rental-agreements",
      "asset-pool",
      "goods-custody",
      "warehouse-operations",
      "storage-and-handling-billing",
    ]);
  });

  it("requires every capability to declare its portfolio, default scope, isolation, and surfaces", () => {
    for (const key of CAPABILITY_KEYS) {
      const capability = CAPABILITY_REGISTRY[key];

      expect(capability.portfolio, `${key} missing portfolio`).toBeTruthy();
      expect(capability.defaultOwnershipScope, `${key} missing defaultOwnershipScope`).toBeTruthy();
      expect(capability.defaultIsolation, `${key} missing defaultIsolation`).toBeTruthy();
      expect(capability.surfaces.length, `${key} needs at least one surface`).toBeGreaterThan(0);
    }
  });

  it("validates runtime strings against the registry instead of ad hoc unions", () => {
    expect(isCapabilityKey("customer-estate")).toBe(true);
    expect(isCapabilityKey("teamlogic-only-customer-estate")).toBe(false);
  });

  it("exposes a setup-wizard opt-in prompt for the partner program", () => {
    const prompt = getCapabilitySetupPrompt("partner-program");
    expect(prompt?.question).toBe("Do you sell through partners or resellers?");
    expect(prompt?.helpText).toContain("add this later");
  });

  it("returns null for capabilities without a setup prompt and for unknown keys", () => {
    expect(getCapabilitySetupPrompt("customer-estate")).toBeNull();
    expect(getCapabilitySetupPrompt("not-a-real-capability")).toBeNull();
  });
});
