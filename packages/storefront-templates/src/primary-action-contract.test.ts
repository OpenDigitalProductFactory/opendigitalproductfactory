import { describe, expect, it } from "vitest";

import type {
  CapabilityActivation,
  CapabilityOverride,
  PrimaryAction,
  PrimaryActionSurface,
} from "./types";

describe("PrimaryAction contract", () => {
  it("typechecks a capability activation with primaryActions", () => {
    const action: PrimaryAction = {
      id: "open-customer-detail",
      label: "Open",
      surface: "map-pin",
      isDefault: true,
    };

    const activation: CapabilityActivation = {
      capabilityKey: "customer-site-map",
      applicability: "required",
      ownershipScopes: ["customer-account", "customer-site"],
      isolation: "strict-customer-scope",
      surfaces: ["customers", "map"],
      primaryActions: [action],
      sourceRules: ["customer-site-map-rule-1"],
    };

    expect(activation.primaryActions?.[0]?.id).toBe("open-customer-detail");
    expect(activation.primaryActions?.[0]?.surface).toBe("map-pin");
  });

  it("allows activations without primaryActions (backward compat)", () => {
    const activation: CapabilityActivation = {
      capabilityKey: "customer-estate",
      applicability: "required",
      ownershipScopes: ["customer-account"],
      isolation: "strict-customer-scope",
      surfaces: ["customers"],
      sourceRules: ["customer-estate-rule-1"],
    };

    expect(activation.primaryActions).toBeUndefined();
  });

  it("typechecks PrimaryActionSurface as the legal surface union", () => {
    const surfaces: PrimaryActionSurface[] = [
      "map-pin",
      "list-row",
      "selection",
      "detail-page",
    ];
    expect(surfaces).toHaveLength(4);
  });

  it("typechecks a capability override that supplies primaryActions", () => {
    const override: CapabilityOverride = {
      capabilityKey: "remote-support",
      applicability: "recommended",
      primaryActions: [
        { id: "request-remote-session", label: "Request remote session", surface: "detail-page" },
      ],
      reason: "consent gating not yet automated",
    };

    expect(override.primaryActions?.[0]?.id).toBe("request-remote-session");
  });

  it("accepts isDefault flag as optional", () => {
    const a: PrimaryAction = { id: "log-violation", label: "Log violation", surface: "map-pin" };
    expect(a.isDefault).toBeUndefined();

    const b: PrimaryAction = { id: "open-property", label: "Open", surface: "map-pin", isDefault: true };
    expect(b.isDefault).toBe(true);
  });
});
