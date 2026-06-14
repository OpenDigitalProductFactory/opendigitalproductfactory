import { describe, expect, it } from "vitest";

import { readActivationProfile } from "./activation-profile";
import { ALL_ARCHETYPES } from "./archetypes";
import {
  FIELD_DISPATCH_MODULE,
  deriveFieldDispatchProfile,
  needsFieldDispatch,
} from "./field-dispatch";
import type { OperatingModelAxes } from "./types";

// A field-dispatch-shaped axes set: a service delivered by a mobile resource at
// the customer's site (the shape F7 will give the trades leaves).
const ONSITE_SERVICE_AXES: OperatingModelAxes = {
  form: "services",
  delivery: "physical",
  primaryConsumer: "individual",
  consumptionChannel: "onsite-plus-portal",
  commercialModel: "transactional",
  provisioning: "none",
  platform: "no",
};

function axes(overrides: Partial<OperatingModelAxes>): OperatingModelAxes {
  return { ...ONSITE_SERVICE_AXES, ...overrides };
}

describe("needsFieldDispatch", () => {
  it("is true for an on-site mobile service (physical or hybrid delivery)", () => {
    expect(needsFieldDispatch(ONSITE_SERVICE_AXES)).toBe(true);
    expect(needsFieldDispatch(axes({ delivery: "hybrid" }))).toBe(true);
  });

  it("is false when the customer comes to the premises (consumptionChannel: physical)", () => {
    // salon / clinic / retail — physical delivery but at the provider's site.
    expect(needsFieldDispatch(axes({ consumptionChannel: "physical", commercialModel: "appointment-checkout" }))).toBe(
      false,
    );
  });

  it("is false for goods, digital delivery, or remote/multi channels", () => {
    expect(needsFieldDispatch(axes({ form: "goods" }))).toBe(false);
    expect(needsFieldDispatch(axes({ delivery: "digital" }))).toBe(false);
    expect(needsFieldDispatch(axes({ consumptionChannel: "web-app" }))).toBe(false);
    expect(needsFieldDispatch(axes({ consumptionChannel: "multi-channel" }))).toBe(false);
  });

  it("is false for the rental-pool model (reservation-and-return is the rental-fleet capability, not dispatch)", () => {
    expect(needsFieldDispatch(axes({ provisioning: "reservation-and-return", consumptionChannel: "onsite-plus-portal" }))).toBe(
      false,
    );
  });
});

describe("needsFieldDispatch over the live archetype catalog", () => {
  const dispatchIds = ALL_ARCHETYPES.map((archetype) => ({
    id: archetype.archetypeId,
    profile: readActivationProfile(archetype.activationProfile),
  }))
    .filter((entry) => entry.profile !== null && needsFieldDispatch(entry.profile.axes))
    .map((entry) => entry.id);

  it("matches the on-site service archetypes that declare onsite-plus-portal axes", () => {
    // MSP on-site work and the resident-serving public-sector field operations.
    expect(dispatchIds).toContain("it-managed-services");
    expect(dispatchIds).toContain("municipal-utility");
    expect(dispatchIds).toContain("small-town-municipality");
    expect(dispatchIds).toContain("law-enforcement-agency");
  });

  it("excludes premises-based, rental-pool, and remote archetypes", () => {
    // reservation-and-return rentals are rental-fleet, not dispatch.
    expect(dispatchIds).not.toContain("equipment-rental");
    expect(dispatchIds).not.toContain("self-storage");
    expect(dispatchIds).not.toContain("agricultural-cooperative");
    // remote / branch / multi-channel.
    expect(dispatchIds).not.toContain("community-bank");
  });

  it("does NOT yet match the trades leaves — they declare no axes (legacy web-app); F7 gives them onsite axes", () => {
    // This is a documented gap, not a bug: F7 adds explicit onsite-plus-portal
    // axes to the trades leaves so they qualify. The engine already works (see
    // the ONSITE_SERVICE_AXES unit tests); only the trades *data* is missing.
    expect(dispatchIds).not.toContain("plumber");
    expect(dispatchIds).not.toContain("electrician");
    expect(dispatchIds).not.toContain("cleaning-service");
    expect(dispatchIds).not.toContain("landscaping");
  });

  it("every matched archetype satisfies the derivation invariants", () => {
    for (const id of dispatchIds) {
      const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === id);
      const profile = readActivationProfile(archetype?.activationProfile);
      expect(profile, id).not.toBeNull();
      expect(profile?.axes.form, id).toBe("services");
      expect(["physical", "hybrid"], id).toContain(profile?.axes.delivery);
      expect(profile?.axes.consumptionChannel, id).toBe("onsite-plus-portal");
      expect(profile?.axes.provisioning, id).not.toBe("reservation-and-return");
    }
  });
});

describe("deriveFieldDispatchProfile", () => {
  it("returns a sensible default profile for a field-dispatch archetype", () => {
    const profile = deriveFieldDispatchProfile(ONSITE_SERVICE_AXES, "some-trade");
    expect(profile).not.toBeNull();
    expect(profile?.resource.noun).toBe("technician");
    expect(profile?.siteModel).toBe("customer-premises");
    expect(profile?.routeMode).toBe("schematic"); // no mapping provider assumed (ADR-9)
    expect(profile?.privacyClass).toBe("standard");
    expect(profile?.complianceOverlays).toEqual([]);
    expect(profile?.inventoryModel).toBe("none");
  });

  it("returns null for a non-dispatch archetype", () => {
    expect(deriveFieldDispatchProfile(axes({ consumptionChannel: "physical" }), "hair-salon")).toBeNull();
  });

  it("override.enabled forces dispatch on regardless of axes (e.g. a sales-assisted home builder)", () => {
    const profile = deriveFieldDispatchProfile(axes({ consumptionChannel: "sales-assisted" }), "new-home-builder", {
      enabled: true,
    });
    expect(profile).not.toBeNull();
  });

  it("override.enabled:false forces dispatch off regardless of axes", () => {
    expect(deriveFieldDispatchProfile(ONSITE_SERVICE_AXES, "some-rental", { enabled: false })).toBeNull();
  });

  it("applies vertical overrides over the derived base (auto-glass shape)", () => {
    const profile = deriveFieldDispatchProfile(ONSITE_SERVICE_AXES, "auto-glass", {
      resource: { noun: "installer", nounPlural: "installers", unit: "vehicle-bound", fleetNoun: "van" },
      servicedEntity: "vehicle",
      siteModel: "mobile-to-customer",
      complianceOverlays: ["adas-calibration"],
      inventoryModel: "sku-by-vehicle",
      vocabulary: { job: "install" },
    });
    expect(profile?.resource.noun).toBe("installer");
    expect(profile?.resource.fleetNoun).toBe("van");
    expect(profile?.servicedEntity).toBe("vehicle");
    expect(profile?.siteModel).toBe("mobile-to-customer");
    expect(profile?.complianceOverlays).toEqual(["adas-calibration"]);
    expect(profile?.inventoryModel).toBe("sku-by-vehicle");
    // partial vocabulary override keeps the unset defaults
    expect(profile?.vocabulary.job).toBe("install");
    expect(profile?.vocabulary.jobPlural).toBe("jobs");
  });
});

describe("field-dispatch as a derived activation module", () => {
  const baseRaw = {
    profileType: "standard" as const,
    modules: ["service-operations"],
    billingReadinessMode: "none" as const,
    customerGraph: "none" as const,
    estateSeparation: "shared" as const,
  };

  it("FIELD_DISPATCH_MODULE is the canonical module key", () => {
    expect(FIELD_DISPATCH_MODULE).toBe("field-dispatch");
  });

  it("readActivationProfile derives the field-dispatch module from on-site axes", () => {
    const profile = readActivationProfile({ ...baseRaw, axes: ONSITE_SERVICE_AXES, portfolios: undefined });
    expect(profile?.modules).toContain("field-dispatch");
    // it composes with, does not replace, service-operations
    expect(profile?.modules).toContain("service-operations");
  });

  it("does not derive the module for premises-based or rental axes", () => {
    const salon = readActivationProfile({ ...baseRaw, axes: axes({ consumptionChannel: "physical" }) });
    expect(salon?.modules).not.toContain("field-dispatch");

    const rental = readActivationProfile({
      ...baseRaw,
      axes: axes({ provisioning: "reservation-and-return" }),
    });
    expect(rental?.modules).not.toContain("field-dispatch");
  });
});
