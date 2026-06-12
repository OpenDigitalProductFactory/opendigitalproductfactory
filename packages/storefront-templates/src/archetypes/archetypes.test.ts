import { describe, it, expect } from "vitest";
import {
  getCapabilityApplicability,
  readActivationProfile,
} from "../activation-profile";
import { ALL_ARCHETYPES } from "./index";

describe("archetype catalog", () => {
  it("has at least 30 archetypes", () => {
    expect(ALL_ARCHETYPES.length).toBeGreaterThanOrEqual(30);
  });

  it("every archetype has required fields", () => {
    for (const a of ALL_ARCHETYPES) {
      expect(a.archetypeId, `${a.archetypeId} missing archetypeId`).toBeTruthy();
      expect(a.name, `${a.archetypeId} missing name`).toBeTruthy();
      expect(a.ctaType, `${a.archetypeId} missing ctaType`).toBeTruthy();
      expect(a.itemTemplates.length, `${a.archetypeId} needs items`).toBeGreaterThan(0);
      expect(a.sectionTemplates.length, `${a.archetypeId} needs sections`).toBeGreaterThan(0);
    }
  });

  it("every archetype has unique archetypeId", () => {
    const ids = ALL_ARCHETYPES.map((a) => a.archetypeId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("personal-trainer shares the scheduling/operating-hours setup of the other beauty booking archetypes", () => {
    // AUDIT-R2-PT-P-001 alleged the personal-trainer wizard skips the Operating
    // Hours step. That step is driven by the shared scheduling/activation config,
    // not archetype-specific code; this guards against personal-trainer silently
    // diverging from its siblings.
    const beautyBooking = ALL_ARCHETYPES.filter(
      (a) => a.category === "beauty-personal-care" && a.ctaType === "booking",
    );
    expect(beautyBooking.length).toBeGreaterThan(1);
    const pt = beautyBooking.find((a) => a.archetypeId === "personal-trainer");
    expect(pt, "personal-trainer should be a beauty-personal-care booking archetype").toBeTruthy();
    const reference = beautyBooking.find((a) => a.archetypeId !== "personal-trainer")!;
    expect(pt!.schedulingDefaults).toEqual(reference.schedulingDefaults);
    expect(pt!.activationProfile).toEqual(reference.activationProfile);
  });

  it("hero section always comes first", () => {
    for (const a of ALL_ARCHETYPES) {
      const sorted = [...a.sectionTemplates].sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted[0].type, `${a.archetypeId} hero should be first section`).toBe("hero");
    }
  });

  it("all booking-type archetypes have schedulingDefaults", () => {
    const bookingArchetypes = ALL_ARCHETYPES.filter((a) => a.ctaType === "booking");
    for (const a of bookingArchetypes) {
      expect(a.schedulingDefaults, `${a.archetypeId} missing schedulingDefaults`).toBeDefined();
    }
  });

  it("it-managed-services carries a strong activation profile", () => {
    const msp = ALL_ARCHETYPES.find((a) => a.archetypeId === "it-managed-services");
    expect(msp).toBeDefined();
    expect(msp?.activationProfile?.profileType).toBe("managed-service-provider");
    expect(msp?.activationProfile?.axes).toMatchObject({
      form: "services",
      delivery: "hybrid",
      primaryConsumer: "business",
      consumptionChannel: "onsite-plus-portal",
      commercialModel: "recurring-agreement",
      provisioning: "account-and-entitlement",
      platform: "no",
    });
    expect(msp?.activationProfile?.portfolios?.manufactureAndDeliver).toMatchObject({
      scope: "primary",
      it4itStages: ["detect-to-correct", "deploy-to-operate", "request-to-fulfill"],
    });
    expect(msp?.activationProfile?.capabilityOverrides).toEqual([
      {
        capabilityKey: "remote-support",
        applicability: "recommended",
        reason: "Consent gating is not yet automated.",
      },
    ]);
    expect(msp?.activationProfile?.modules).toContain("customer-estate");
    expect(msp?.activationProfile?.modules).toContain("service-agreements");
    expect(msp?.activationProfile?.modules).toContain("service-operations");
    expect(msp?.activationProfile?.customerGraph).toBe("separate-customer-projection");
    expect(msp?.activationProfile?.estateSeparation).toBe("strict");
    expect(msp?.activationProfile?.seededConfigurationItemTypes?.some((item) => item.key === "endpoint-security-license")).toBe(true);
    expect(msp?.activationProfile?.seededChargeModels?.some((model) => model.key === "pass_through")).toBe(true);

    const normalized = readActivationProfile(msp?.activationProfile);
    expect(getCapabilityApplicability(normalized, "customer-estate")).toBe("required");
    expect(getCapabilityApplicability(normalized, "remote-support")).toBe("recommended");
  });

  it("hair salon uses appointment checkout without customer-estate activation", () => {
    const salon = ALL_ARCHETYPES.find((a) => a.archetypeId === "hair-salon");
    expect(salon).toBeDefined();
    expect(salon?.activationProfile?.axes).toMatchObject({
      form: "services",
      delivery: "physical",
      primaryConsumer: "individual",
      consumptionChannel: "physical",
      commercialModel: "appointment-checkout",
      provisioning: "account-with-billing",
      platform: "no",
    });

    const normalized = readActivationProfile(salon?.activationProfile);
    expect(getCapabilityApplicability(normalized, "appointment-checkout")).toBe("required");
    expect(getCapabilityApplicability(normalized, "point-of-sale")).toBe("required");
    expect(getCapabilityApplicability(normalized, "customer-estate")).toBe("not-applicable");
  });

  it("includes a software-platform archetype for DPF-style product sellers", () => {
    const softwarePlatform = ALL_ARCHETYPES.find((a) => a.archetypeId === "software-platform");
    expect(softwarePlatform).toBeDefined();
    expect(softwarePlatform?.category).toBe("software-platform");
    expect(softwarePlatform?.ctaType).toBe("inquiry");
    expect(softwarePlatform?.itemTemplates.some((item) => item.name === "Open Digital Product Factory")).toBe(true);
  });

  it("derives a partner program for archetypes that typically sell through partners", () => {
    // Wholesale/distribution (goods sold B2B to resellers) → partner-program recommended.
    const wholesale = ALL_ARCHETYPES.find((a) => a.archetypeId === "wholesale-distribution");
    expect(wholesale, "wholesale-distribution archetype should exist").toBeDefined();
    expect(wholesale?.activationProfile?.axes).toMatchObject({ form: "goods", primaryConsumer: "business" });
    const wholesaleProfile = readActivationProfile(wholesale?.activationProfile);
    expect(wholesaleProfile?.partnerProgram).toMatchObject({
      portalMode: "available",
      partnerTypes: ["reseller", "distributor"],
    });
    expect(getCapabilityApplicability(wholesaleProfile, "partner-program")).toBe("recommended");
    expect(getCapabilityApplicability(wholesaleProfile, "customer-accounts")).toBe("required");

    // IT managed services (B2B + recurring-agreement + primary delivery) → also recommended.
    const msp = ALL_ARCHETYPES.find((a) => a.archetypeId === "it-managed-services");
    const mspProfile = readActivationProfile(msp?.activationProfile);
    expect(mspProfile?.partnerProgram.portalMode).toBe("available");
    expect(getCapabilityApplicability(mspProfile, "partner-program")).toBe("recommended");
  });

  it("ships BIAN-grounded banking archetypes with KYC provisioning and disclosures (BI-5D9DCDE6)", () => {
    const banking = ALL_ARCHETYPES.filter((a) => a.category === "banking-financial-services");
    expect(banking.map((a) => a.archetypeId).sort()).toEqual([
      "community-bank",
      "credit-union",
      "mortgage-lending",
    ]);

    for (const a of banking) {
      // Engagement-layer posture: KYC-gated provisioning, account-based fees,
      // billing prepared-not-prescribed (spec §7).
      expect(a.activationProfile?.axes?.provisioning, `${a.archetypeId} provisioning`).toBe("account-with-kyc");
      expect(a.activationProfile?.axes?.commercialModel, `${a.archetypeId} commercialModel`).toBe("account-based-fees");
      expect(a.activationProfile?.billingReadinessMode, `${a.archetypeId} billing`).toBe("prepared-not-prescribed");
      // Regulated-industry display obligations render through the disclosures section (spec §9.3).
      expect(
        a.sectionTemplates.some((s) => s.type === "disclosures"),
        `${a.archetypeId} needs a disclosures section`,
      ).toBe(true);
      // Service categories are kebab-case BIAN Business Domain names.
      expect(a.activationProfile?.seededServiceCategories).toContain("loans-and-deposits");
      expect(a.activationProfile?.seededServiceCategories).toContain("compliance");
      // Branch appointments are bookable even though the archetype CTA is inquiry.
      expect(
        a.itemTemplates.some((i) => i.ctaType === "booking" && (i.bookingDurationMinutes ?? 0) > 0),
        `${a.archetypeId} needs a bookable appointment item`,
      ).toBe(true);
      expect(a.schedulingDefaults, `${a.archetypeId} needs schedulingDefaults for its booking items`).toBeDefined();
    }

    // Credit-union member vocabulary is a leaf-level override (spec §7.4).
    const cu = banking.find((a) => a.archetypeId === "credit-union");
    expect(cu?.vocabulary?.stakeholderLabel).toBe("Members");
    // Banks keep the category default — no override needed.
    const bank = banking.find((a) => a.archetypeId === "community-bank");
    expect(bank?.vocabulary).toBeUndefined();
  });

  it("does not derive a partner program for direct-to-consumer archetypes", () => {
    const salon = ALL_ARCHETYPES.find((a) => a.archetypeId === "hair-salon");
    const salonProfile = readActivationProfile(salon?.activationProfile);
    expect(salonProfile?.partnerProgram.portalMode).toBe("none");
    expect(getCapabilityApplicability(salonProfile, "partner-program")).toBe("not-applicable");
  });
});
