import { describe, it, expect } from "vitest";
import {
  getCapabilityApplicability,
  readActivationProfile,
} from "../activation-profile";
import { needsFieldDispatch } from "../field-dispatch";
import { ALL_ARCHETYPES } from "./index";

describe("archetype catalog", () => {
  it("declares typed process defaults for restaurants and animal-welfare organizations", () => {
    const restaurant = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "restaurant");
    const petRescue = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "pet-rescue");
    const animalShelter = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "animal-shelter");

    expect(restaurant?.activationProfile?.processProfile).toEqual({
      catalogModes: ["priced"],
      subjectTypes: [],
      housesSubjects: false,
      schedulesSubjects: false,
      resourceKinds: [
        { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
      ],
    });

    for (const archetype of [petRescue, animalShelter]) {
      expect(archetype?.activationProfile?.processProfile).toMatchObject({
        catalogModes: ["donation", "unpriced"],
        subjectTypes: ["animal"],
        housesSubjects: true,
        schedulesSubjects: true,
        resourceKinds: [
          { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
        ],
      });
    }

    expect(petRescue?.activationProfile?.processProfile?.valueStreams).toHaveLength(3);
    expect(animalShelter?.activationProfile?.processProfile?.valueStreams).toBeUndefined();
  });

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

  it("ships agriculture and ranching as one operating category with three distinct production systems", () => {
    const agriculture = ALL_ARCHETYPES.filter((a) => a.category === "agriculture-ranching");
    expect(agriculture.map((a) => a.archetypeId).sort()).toEqual([
      "cattle-ranch",
      "crop-hay-farm",
      "mixed-farm-ranch",
    ]);

    for (const archetype of agriculture) {
      expect(archetype.ctaType).toBe("inquiry");
      expect(archetype.vocabulary).toMatchObject({
        stakeholderLabel: "Customers",
        teamLabel: "Farm & Ranch Team",
        agentName: "Farm & Ranch Steward",
      });
      expect(archetype.itemTemplates.some((item) => /hay|cattle|grazing|crop/i.test(`${item.name} ${item.description}`))).toBe(true);
    }
  });

  it("ships manufacturing as an owned-transformation industrial OEM category (BI-7697CAD3)", () => {
    const manufacturing = ALL_ARCHETYPES.filter((a) => a.category === "manufacturing");
    expect(manufacturing.map((a) => a.archetypeId)).toEqual(["industrial-equipment-oem"]);

    const oem = manufacturing[0]!;
    expect(oem.ctaType).toBe("inquiry");
    expect(oem.activationProfile?.axes).toMatchObject({
      form: "goods",
      delivery: "physical",
      primaryConsumer: "business",
      consumptionChannel: "sales-assisted",
    });
    expect(oem.activationProfile?.portfolios?.manufactureAndDeliver.scope).toBe("primary");
    expect(oem.itemTemplates.some((item) => /serialized|prototype|production/i.test(`${item.name} ${item.description}`))).toBe(true);
  });

  it("ships fabric-care services with dry-cleaning plant-network custody flow (BI-7CFFC421)", () => {
    const fabricCare = ALL_ARCHETYPES.filter((a) => a.category === "fabric-care-services");
    expect(fabricCare.map((a) => a.archetypeId).sort()).toEqual([
      "alterations-tailoring",
      "dry-cleaning-plant-network",
      "wash-and-fold-laundry",
    ]);

    const dryCleaner = fabricCare.find((a) => a.archetypeId === "dry-cleaning-plant-network");
    expect(dryCleaner, "dry-cleaning-plant-network archetype should exist").toBeDefined();
    expect(dryCleaner?.ctaType).toBe("inquiry");
    expect(dryCleaner?.activationProfile?.modules).toEqual([
      "customer-estate",
      "service-operations",
      "billing-readiness",
      "integrations",
    ]);
    expect(dryCleaner?.activationProfile?.billingReadinessMode).toBe("prepared-not-prescribed");
    expect(dryCleaner?.activationProfile?.customerGraph).toBe("separate-customer-projection");
    expect(dryCleaner?.activationProfile?.estateSeparation).toBe("strict");
    expect(dryCleaner?.activationProfile?.axes).toMatchObject({
      form: "services",
      delivery: "physical",
      primaryConsumer: "individual",
      consumptionChannel: "multi-channel",
      commercialModel: "point-of-sale",
      provisioning: "account-with-billing",
      platform: "no",
    });

    const fieldNames = dryCleaner?.formSchema.map((field) => field.name) ?? [];
    expect(fieldNames).toEqual(expect.arrayContaining([
      "preferredLocation",
      "serviceMode",
      "neededBy",
      "garmentNotes",
    ]));
    expect(dryCleaner?.itemTemplates.some((item) => /claim ticket/i.test(item.description))).toBe(true);
    expect(dryCleaner?.itemTemplates.some((item) => /ready/i.test(item.description))).toBe(true);
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

  it("every archetype with a booking item has schedulingDefaults", () => {
    // The setup route (apps/web/app/api/storefront/admin/setup/route.ts) seeds
    // the ServiceProvider, availability, and per-item bookingConfig only when the
    // template carries schedulingDefaults, and it keys on *item-level* ctaType.
    // An archetype whose top-level ctaType is not "booking" but which contains a
    // booking item (gym, yoga-studio, dance-studio, driving-school,
    // artisan-goods, the HOA/condo reservations, the municipal pavilion) still
    // needs schedulingDefaults — without it the booking calendar ships empty
    // (AUDIT-R3/R4). Guarding on item-level ctaType closes the gap where the old
    // archetype-level check let these pass while broken.
    const hasBookingItem = (a: (typeof ALL_ARCHETYPES)[number]) =>
      a.ctaType === "booking" ||
      a.itemTemplates.some((t) => (t.ctaType ?? a.ctaType) === "booking");
    const bookingArchetypes = ALL_ARCHETYPES.filter(hasBookingItem);
    expect(bookingArchetypes.length).toBeGreaterThan(0);
    for (const a of bookingArchetypes) {
      expect(
        a.schedulingDefaults,
        `${a.archetypeId} has a booking item but no schedulingDefaults`,
      ).toBeDefined();
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

  it("activates medical and dental practices as strictly isolated care practices (BI-HEALTHCARE-002)", () => {
    const carePractices = ["medical-practice", "dental-practice"].map((id) =>
      ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === id),
    );

    for (const practice of carePractices) {
      expect(practice, "both care-practice leaves should be registered").toBeDefined();
      expect(practice?.category).toBe("healthcare-wellness");
      expect(practice?.ctaType).toBe("booking");
      expect(practice?.schedulingDefaults).toBeDefined();
      expect(practice?.activationProfile?.axes).toMatchObject({
        form: "services",
        delivery: "hybrid",
        primaryConsumer: "patient-and-payer",
        consumptionChannel: "multi-channel",
        commercialModel: "encounter-based",
        provisioning: "episode-of-care",
        platform: "no",
      });
      expect(practice?.activationProfile?.customerGraph).toBe("separate-customer-projection");
      expect(practice?.activationProfile?.estateSeparation).toBe("strict");
      expect(practice?.vocabulary).toMatchObject({
        stakeholderLabel: "Patients",
        inboxLabel: "Patient Appointments",
      });
      expect(practice?.vocabulary?.teamLabel).toMatch(/Team$/);
      expect(practice?.vocabulary?.agentName).toMatch(/Front Desk Coordinator$/);

      const normalized = readActivationProfile(practice?.activationProfile);
      const patientAccounts = normalized?.capabilityActivations.find(
        (activation) => activation.capabilityKey === "customer-accounts",
      );
      expect(patientAccounts).toMatchObject({
        applicability: "required",
        ownershipScopes: ["customer-account"],
        transactionContexts: ["appointment", "episode-of-care"],
        isolation: "strict-customer-scope",
      });
      const billing = normalized?.capabilityActivations.find(
        (activation) => activation.capabilityKey === "billing-readiness",
      );
      expect(billing).toMatchObject({
        applicability: "required",
        transactionContexts: ["appointment", "episode-of-care"],
        isolation: "strict-customer-scope",
      });
    }
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

  it("ships home builder archetypes with booking items, scheduling defaults, and correct operating model (EP-GRID-BUILDER)", () => {
    const builders = ALL_ARCHETYPES.filter((a) => a.category === "real-estate-construction");
    expect(builders.map((a) => a.archetypeId).sort()).toEqual([
      "custom-home-builder",
      "new-home-builder",
    ]);

    for (const b of builders) {
      // Both have a booking item — model home tour or design consultation.
      const hasBookingItem =
        b.ctaType === "booking" ||
        b.itemTemplates.some((t) => (t.ctaType ?? b.ctaType) === "booking");
      expect(hasBookingItem, `${b.archetypeId} should have a booking item`).toBe(true);
      // Scheduling defaults are required when a booking item exists (AUDIT-R3/R4 rule).
      expect(b.schedulingDefaults, `${b.archetypeId} needs schedulingDefaults`).toBeDefined();
      // Builders sell physical goods to households.
      expect(b.activationProfile?.axes?.form, `${b.archetypeId} form`).toBe("goods");
      expect(b.activationProfile?.axes?.primaryConsumer, `${b.archetypeId} primaryConsumer`).toBe("household");
      expect(b.activationProfile?.axes?.delivery, `${b.archetypeId} delivery`).toBe("physical");
      // Milestone payments require billing-readiness prepared-not-prescribed.
      expect(b.activationProfile?.modules, `${b.archetypeId} modules`).toContain("billing-readiness");
      expect(b.activationProfile?.modules, `${b.archetypeId} modules`).toContain("projects");
      expect(b.activationProfile?.billingReadinessMode, `${b.archetypeId} billing`).toBe("prepared-not-prescribed");
    }

    // Model homes are open 7 days — production builder must have Sunday hours.
    const nhb = builders.find((b) => b.archetypeId === "new-home-builder");
    const nhbSunday = nhb?.schedulingDefaults?.defaultOperatingHours.find((h) => h.day === 0);
    expect(nhbSunday, "new-home-builder model homes open on Sundays").toBeDefined();

    // Custom builder runs business-hours only — no weekend hours.
    const chb = builders.find((b) => b.archetypeId === "custom-home-builder");
    const chbSunday = chb?.schedulingDefaults?.defaultOperatingHours.find((h) => h.day === 0);
    expect(chbSunday, "custom-home-builder should not have Sunday hours").toBeUndefined();
    const chbSaturday = chb?.schedulingDefaults?.defaultOperatingHours.find((h) => h.day === 6);
    expect(chbSaturday, "custom-home-builder should not have Saturday hours").toBeUndefined();

    // Custom builder carries a leaf-level vocabulary override (Clients, Build Team).
    expect(chb?.vocabulary?.stakeholderLabel).toBe("Clients");
    expect(chb?.vocabulary?.teamLabel).toBe("Build Team");
    expect(chb?.vocabulary?.agentName).toBe("Build Consultant");

    // Production builder has no leaf vocabulary override — category default applies.
    expect(nhb?.vocabulary).toBeUndefined();

    // Custom builder includes service-operations for active subcontractor coordination.
    expect(chb?.activationProfile?.modules).toContain("service-operations");
  });

  it("ships dispatch-native field-service leaves with onsite operating-model axes (Gap A)", () => {
    // The Gap-A leaves (2026-06-13 field-dispatch archetype gap analysis) are
    // businesses where a mobile resource travels to the customer's site / asset /
    // person. The forthcoming horizontal Field Dispatch capability derives from
    // form=services + delivery=physical + consumptionChannel=onsite-plus-portal,
    // so every new dispatch leaf must carry that triple and compose under
    // service-operations until the field-dispatch module ships.
    const GAP_A_DISPATCH_LEAVES = [
      "hvac-contractor", "pest-control", "appliance-repair", "pool-spa-service",
      "pressure-washing", "roofing-gutters",
      "home-health-care", "mobile-phlebotomy", "dme-delivery",
      "mobile-pet-grooming", "mobile-vet",
      "field-inspection", "land-surveying", "process-serving-notary",
      "mobile-beauty", "meal-delivery-program", "furniture-delivery-install",
    ];
    for (const id of GAP_A_DISPATCH_LEAVES) {
      const a = ALL_ARCHETYPES.find((x) => x.archetypeId === id);
      expect(a, `${id} should exist`).toBeDefined();
      expect(a?.activationProfile?.axes?.form, `${id} form`).toBe("services");
      expect(a?.activationProfile?.axes?.delivery, `${id} delivery`).toBe("physical");
      expect(a?.activationProfile?.axes?.consumptionChannel, `${id} channel`).toBe("onsite-plus-portal");
      expect(a?.activationProfile?.modules, `${id} modules`).toContain("service-operations");
    }
  });

  it("ships the three dispatch-native categories with correct axes (Gap B)", () => {
    const auto = ALL_ARCHETYPES.filter((a) => a.category === "automotive-services");
    const moving = ALL_ARCHETYPES.filter((a) => a.category === "moving-and-logistics");
    const security = ALL_ARCHETYPES.filter((a) => a.category === "security-services");

    expect(auto.map((a) => a.archetypeId).sort()).toEqual([
      "auto-glass", "locksmith", "mobile-detailing", "mobile-mechanic", "mobile-tire", "roadside-assistance",
    ]);
    expect(moving.map((a) => a.archetypeId).sort()).toEqual([
      "courier-delivery", "freight-brokerage", "junk-removal", "last-mile-freight", "moving-company",
    ]);
    expect(security.map((a) => a.archetypeId).sort()).toEqual([
      "alarm-cctv-install", "guard-patrol",
    ]);

    // `freight-brokerage` sits in the moving category but is deliberately NOT
    // dispatch-native: a non-asset broker sells from a desk and routes nobody's
    // vehicles, so it declares `sales-assisted` and derives field dispatch off.
    // It is excluded from the dispatch-axes assertion by design, not oversight.
    const dispatchNativeMoving = moving.filter((a) => a.archetypeId !== "freight-brokerage");
    expect(needsFieldDispatch(readActivationProfile(
      moving.find((a) => a.archetypeId === "freight-brokerage")!.activationProfile,
    )!.axes)).toBe(false);

    // Every dispatch-native leaf in the new categories derives dispatch from its axes.
    for (const a of [...auto, ...dispatchNativeMoving, ...security]) {
      expect(a.activationProfile?.axes?.form, `${a.archetypeId} form`).toBe("services");
      expect(a.activationProfile?.axes?.delivery, `${a.archetypeId} delivery`).toBe("physical");
      expect(a.activationProfile?.axes?.consumptionChannel, `${a.archetypeId} channel`).toBe("onsite-plus-portal");
      expect(a.activationProfile?.modules, `${a.archetypeId} modules`).toContain("service-operations");
    }

    // The windshield / auto-glass leaf is the capability spec's named example and
    // carries the ADAS-calibration tag that anchors its compliance overlay.
    const glass = auto.find((a) => a.archetypeId === "auto-glass");
    expect(glass?.tags).toContain("adas");

    // Capability derivation is reachable for a recurring-agreement new-category
    // leaf: guard contracts require service agreements.
    const guard = readActivationProfile(
      security.find((a) => a.archetypeId === "guard-patrol")?.activationProfile,
    );
    expect(getCapabilityApplicability(guard, "service-agreements")).toBe("required");
  });

  it("ships the two entertainment categories with project-based and ticketed value streams (EP-ENTERTAINMENT)", () => {
    const media = ALL_ARCHETYPES.filter((a) => a.category === "media-production");
    const live = ALL_ARCHETYPES.filter((a) => a.category === "live-events-venues");

    expect(media.map((a) => a.archetypeId).sort()).toEqual([
      "event-production-staging",
      "film-video-production",
      "post-production-studio",
    ]);
    expect(live.map((a) => a.archetypeId).sort()).toEqual([
      "event-venue",
      "talent-booking-agency",
      "tour-promoter",
    ]);

    // Media & production is project-based: services form, projects module, and
    // milestone billing prepared-not-prescribed.
    for (const a of media) {
      expect(a.activationProfile?.axes?.form, `${a.archetypeId} form`).toBe("services");
      expect(a.activationProfile?.axes?.commercialModel, `${a.archetypeId} model`).toBe("transactional");
      expect(a.activationProfile?.modules, `${a.archetypeId} modules`).toContain("projects");
      expect(a.activationProfile?.billingReadinessMode, `${a.archetypeId} billing`).toBe("prepared-not-prescribed");
    }

    // Live events & venues sell the show; the venue and promoter lead with ticket
    // purchases and every leaf carries a bookable/enquiry item with scheduling.
    const venue = live.find((a) => a.archetypeId === "event-venue");
    expect(venue?.ctaType).toBe("purchase");
    expect(venue?.itemTemplates.some((i) => i.ctaType === "purchase" && (i.priceAmount ?? 0) > 0)).toBe(true);

    // Every entertainment leaf with a booking item carries schedulingDefaults.
    for (const a of [...media, ...live]) {
      const hasBookingItem =
        a.ctaType === "booking" ||
        a.itemTemplates.some((t) => (t.ctaType ?? a.ctaType) === "booking");
      if (hasBookingItem) {
        expect(a.schedulingDefaults, `${a.archetypeId} needs schedulingDefaults`).toBeDefined();
      }
    }

    // Production-equipment rental is a REUSED asset-rental leaf, not a new category.
    const kit = ALL_ARCHETYPES.find((a) => a.archetypeId === "production-equipment-rental");
    expect(kit?.category).toBe("asset-rental");
    expect(kit?.activationProfile?.axes?.provisioning).toBe("reservation-and-return");
  });
});
