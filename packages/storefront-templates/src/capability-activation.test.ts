import { describe, expect, it } from "vitest";

import {
  resolveCapabilityActivation,
  resolveOrgCapabilityActivations,
} from "./capability-activation";

describe("resolveCapabilityActivation", () => {
  it("treats not-applicable / hidden capabilities as never active and never offered", () => {
    for (const applicability of ["not-applicable", "hidden"] as const) {
      expect(resolveCapabilityActivation(applicability)).toEqual({
        active: false,
        promptAtSetup: false,
        canEnableLater: false,
        source: "not-applicable",
      });
    }
  });

  it("turns required capabilities on by default but still confirms them at setup", () => {
    expect(resolveCapabilityActivation("required")).toMatchObject({
      active: true,
      promptAtSetup: true,
      canEnableLater: true,
      source: "required",
    });
  });

  it("honors an explicit org opt-out of a required capability", () => {
    expect(resolveCapabilityActivation("required", "disabled")).toMatchObject({
      active: false,
      source: "org-choice",
      canEnableLater: true,
    });
  });

  it("asks at setup for recommended capabilities and keeps them off until the org opts in", () => {
    // No stored choice yet → offered at setup, not yet active.
    expect(resolveCapabilityActivation("recommended")).toMatchObject({
      active: false,
      promptAtSetup: true,
      canEnableLater: true,
      source: "default-off",
    });
    // Org said yes (at setup or later).
    expect(resolveCapabilityActivation("recommended", "enabled")).toMatchObject({
      active: true,
      source: "org-choice",
    });
  });

  it("keeps optional capabilities off and out of the setup wizard but available to add later", () => {
    expect(resolveCapabilityActivation("optional")).toMatchObject({
      active: false,
      promptAtSetup: false,
      canEnableLater: true,
      source: "default-off",
    });
    expect(resolveCapabilityActivation("optional", "enabled").active).toBe(true);
  });

  it("supports the partner-program flow: recommended archetype asks, off until opt-in, addable later", () => {
    // SaaS/MSP/wholesale derive partner-program = recommended.
    const atSetup = resolveCapabilityActivation("recommended");
    expect(atSetup.promptAtSetup).toBe(true); // "Do you sell through partners/resellers?"
    expect(atSetup.active).toBe(false); // not on until they say yes
    expect(atSetup.canEnableLater).toBe(true); // add-later provision

    // Org declined at setup, then enables it later from admin.
    expect(resolveCapabilityActivation("recommended", "enabled").active).toBe(true);

    // Pure channel/reseller archetype derives partner-program = required → on by default.
    expect(resolveCapabilityActivation("required").active).toBe(true);
  });
});

describe("resolveOrgCapabilityActivations", () => {
  const derived = [
    { capabilityKey: "partner-program", applicability: "recommended" as const },
    { capabilityKey: "customer-accounts", applicability: "required" as const },
    { capabilityKey: "point-of-sale", applicability: "optional" as const },
    { capabilityKey: "appointment-checkout", applicability: "not-applicable" as const },
  ];

  it("folds org choices over derived applicabilities into effective activations", () => {
    const effective = resolveOrgCapabilityActivations(derived, {
      "partner-program": "enabled",
    });
    const byKey = Object.fromEntries(effective.map((e) => [e.capabilityKey, e]));

    // Org opted into the recommended partner program → active.
    expect(byKey["partner-program"]).toMatchObject({ active: true, source: "org-choice" });
    // Required stays on with no choice needed.
    expect(byKey["customer-accounts"]).toMatchObject({ active: true, source: "required" });
    // Optional with no choice → off but add-later.
    expect(byKey["point-of-sale"]).toMatchObject({ active: false, canEnableLater: true });
    // Not-applicable → never.
    expect(byKey["appointment-checkout"]).toMatchObject({ active: false, canEnableLater: false });
  });

  it("defaults recommended capabilities off when the org has made no choice yet", () => {
    const effective = resolveOrgCapabilityActivations(derived);
    const partner = effective.find((e) => e.capabilityKey === "partner-program");
    expect(partner).toMatchObject({ active: false, promptAtSetup: true, source: "default-off" });
  });
});
