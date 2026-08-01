import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { describe, expect, it, vi } from "vitest";
import {
  BUSINESS_CAPABILITY_SEED_PREFIX,
  COVERED_BUSINESS_CAPABILITY_CATEGORIES,
  applyBusinessCapabilityPerspective,
  resolveBusinessCapabilityPerspective,
} from "../src/business-capability-perspectives";

describe("business capability perspectives", () => {
  it("adds the MSP overlay only for the IT managed services archetype", () => {
    const msp = resolveBusinessCapabilityPerspective({
      archetypeId: "it-managed-services",
      category: "professional-services",
    });
    const salon = resolveBusinessCapabilityPerspective({
      archetypeId: "hair-salon",
      category: "beauty-personal-care",
    });

    expect(msp.sourcePerspectiveIds).toEqual([
      "common-small-business",
      "professional-services",
      "it-managed-services",
    ]);
    expect(msp.sources.map((source) => source.label)).toEqual([
      "Common Small Business",
      "Professional Services",
      "IT Managed Services",
    ]);
    expect(msp.sources.map((source) => source.source)).toEqual([
      "DPF baseline informed by APQC-style process families",
      "DPF professional-services overlay informed by client intake, engagement scoping, delivery work, decisions/deliverables, time/billing, pipeline, and relationship management.",
      "DPF MSP overlay informed by managed services, customer estate, NIST CSF, and service-agreement operating patterns",
    ]);
    expect(msp.capabilities.some((capability) => capability.key === "msp-managed-customer-estate")).toBe(true);
    expect(msp.capabilities.some((capability) => capability.key === "finance")).toBe(true);
    expect(salon.sourcePerspectiveIds).toEqual(["common-small-business", "beauty-personal-care"]);
    expect(salon.capabilities.some((capability) => capability.key === "msp-managed-customer-estate")).toBe(false);
  });

  it("adds a beauty and personal care category overlay for salon day-to-day work", () => {
    const salon = resolveBusinessCapabilityPerspective({
      archetypeId: "hair-salon",
      category: "beauty-personal-care",
    });

    expect(salon.sourcePerspectiveIds).toEqual(["common-small-business", "beauty-personal-care"]);
    expect(salon.sources.map((source) => source.label)).toEqual(["Common Small Business", "Beauty And Personal Care"]);
    expect(salon.sources.map((source) => source.source)).toContain(
      "DPF beauty/personal-care overlay informed by appointment checkout, service menu, practitioner assignment, retail/POS payments, CRM/marketing automation, and local-presence operating patterns",
    );
    expect(salon.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "beauty-service-operations",
        "beauty-service-menu-packages",
        "beauty-booking-practitioner-calendar",
        "beauty-client-preferences-intake",
        "beauty-checkout-retail-payments",
        "beauty-supplies-tools-stock",
        "beauty-local-marketing-reviews",
      ]),
    );
  });

  it("applies category overlays even when the leaf archetype is custom", () => {
    const customSalon = resolveBusinessCapabilityPerspective({
      archetypeId: "custom-salon",
      category: "beauty-personal-care",
    });

    expect(customSalon.sourcePerspectiveIds).toEqual(["common-small-business", "beauty-personal-care"]);
    expect(customSalon.capabilities.some((capability) => capability.key === "beauty-checkout-retail-payments")).toBe(true);
  });

  it("adds a food and hospitality category overlay for restaurant service-period work", () => {
    const restaurant = resolveBusinessCapabilityPerspective({
      archetypeId: "restaurant",
      category: "food-hospitality",
    });

    expect(restaurant.sourcePerspectiveIds).toEqual(["common-small-business", "food-hospitality"]);
    expect(restaurant.sources.map((source) => source.label)).toEqual([
      "Common Small Business",
      "Food And Hospitality",
    ]);
    const keys = restaurant.capabilities.map((capability) => capability.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "food-hospitality-operations",
        "food-service-period-readiness",
        "food-menu-prep-inventory",
        "food-production-fulfillment",
        "food-guest-experience-followup",
        "food-deposits-tickets-billing",
      ]),
    );
    expect(keys).toContain("customer-service-delivery");
    expect(keys).not.toContain("beauty-service-operations");
  });

  it("keeps every storefront archetype category off the common-only fallback", () => {
    const activeCategories = Array.from(new Set(ALL_ARCHETYPES.map((archetype) => archetype.category))).sort();

    expect(COVERED_BUSINESS_CAPABILITY_CATEGORIES).toEqual(activeCategories);

    for (const category of activeCategories) {
      const resolved = resolveBusinessCapabilityPerspective({
        archetypeId: "category-coverage-probe",
        category,
      });
      const keys = resolved.capabilities.map((capability) => capability.key);
      const byKey = new Set(keys);

      expect(resolved.sourcePerspectiveIds, category).toContain("common-small-business");
      expect(resolved.sourcePerspectiveIds.length, category).toBeGreaterThan(1);
      expect(byKey.size, category).toBe(keys.length);

      for (const capability of resolved.capabilities) {
        if (capability.parentKey) {
          expect(byKey.has(capability.parentKey), `${category}: ${capability.key} parent ${capability.parentKey}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("adds a trades and maintenance category overlay for field-service work", () => {
    const trades = resolveBusinessCapabilityPerspective({
      archetypeId: "facilities-maintenance",
      category: "trades-maintenance",
    });

    expect(trades.sourcePerspectiveIds).toEqual(["common-small-business", "trades-maintenance"]);
    expect(trades.sources.map((source) => source.label)).toEqual(["Common Small Business", "Trades And Maintenance"]);
    expect(trades.sources.map((source) => source.source)).toContain(
      "DPF trades/maintenance overlay informed by field-service dispatch, work-order lifecycle, customer ETA communications, truck stock, subcontractor/safety, and trades finance operating patterns",
    );
    const keys = trades.capabilities.map((capability) => capability.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "trades-field-service-operations",
        "trades-job-intake-triage",
        "trades-dispatch-technician-readiness",
        "trades-work-order-lifecycle",
        "trades-customer-updates-eta",
        "trades-truck-stock-parts",
        "trades-quotes-contracts-billing",
        "trades-safety-compliance-subcontractors",
      ]),
    );
  });

  it("applies trades category overlays even when the field-service leaf is custom", () => {
    const customTrades = resolveBusinessCapabilityPerspective({
      archetypeId: "hvac-contractor",
      category: "trades-maintenance",
    });

    expect(customTrades.sourcePerspectiveIds).toEqual(["common-small-business", "trades-maintenance"]);
    const keys = customTrades.capabilities.map((capability) => capability.key);
    expect(keys).toContain("trades-truck-stock-parts");
    expect(keys).not.toContain("beauty-service-operations");
    expect(keys).not.toContain("msp-managed-customer-estate");
  });

  it("adds a fabric-care category overlay for garment custody and plant flow", () => {
    const fabricCare = resolveBusinessCapabilityPerspective({
      archetypeId: "dry-cleaning-plant-network",
      category: "fabric-care-services",
    });

    expect(fabricCare.sourcePerspectiveIds).toEqual(["common-small-business", "fabric-care-services"]);
    expect(fabricCare.sources.map((source) => source.label)).toEqual(["Common Small Business", "Fabric Care Services"]);
    expect(fabricCare.sources.map((source) => source.source)).toContain(
      "DPF fabric-care overlay informed by dry-cleaning POS, claim-ticket custody, plant/workroom flow, ready notifications, pickup routes, and garment-care operating patterns",
    );
    const keys = fabricCare.capabilities.map((capability) => capability.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "fabric-care-operations",
        "fabric-care-intake-claim-ticket",
        "fabric-care-plant-workroom-flow",
        "fabric-care-ready-promise-notices",
        "fabric-care-garment-custody-exceptions",
        "fabric-care-supplies-equipment",
        "fabric-care-pos-account-billing",
      ]),
    );
    expect(keys).toContain("customer-service-delivery");
    expect(keys).not.toContain("trades-dispatch-technician-readiness");
  });

  it("adds an agriculture category overlay across land, animals, equipment, markets, and obligations", () => {
    const agriculture = resolveBusinessCapabilityPerspective({
      archetypeId: "mixed-farm-ranch",
      category: "agriculture-ranching",
    });

    expect(agriculture.sourcePerspectiveIds).toEqual(["common-small-business", "agriculture-ranching"]);
    expect(agriculture.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "agriculture-land-field-pasture-planning",
        "agriculture-livestock-breeding-health",
        "agriculture-working-animal-readiness",
        "agriculture-equipment-implement-maintenance",
        "agriculture-market-weather-decisions",
        "agriculture-regulation-license-exemption",
      ]),
    );
  });

  it("adds the BIAN v14 banking overlay for the banking-financial-services category (BI-5D9DCDE6)", () => {
    const creditUnion = resolveBusinessCapabilityPerspective({
      archetypeId: "credit-union",
      category: "banking-financial-services",
    });

    expect(creditUnion.sourcePerspectiveIds).toEqual(["common-small-business", "bian-banking-v14"]);
    expect(creditUnion.sources.map((source) => source.label)).toEqual([
      "Common Small Business",
      "Banking (BIAN v14)",
    ]);
    // Source string cites the canonical reference data, not prose.
    expect(creditUnion.sources[1].source).toContain("bian-v14-service-landscape.json");

    const byKey = new Map(creditUnion.capabilities.map((c) => [c.key, c]));
    // L1 Business Area → L2 Business Domain → L3 Service Domain chain intact.
    expect(byKey.get("bian-customers")?.level).toBe(1);
    expect(byKey.get("bian-relationship-management")).toMatchObject({ level: 2, parentKey: "bian-customers" });
    expect(byKey.get("bian-customer-credit-rating")).toMatchObject({ level: 3, parentKey: "bian-relationship-management" });
    // Service Domain placement follows the reference JSON: Current Account
    // lives under Consumer Banking, not Loans and Deposits.
    expect(byKey.get("bian-current-account")?.parentKey).toBe("bian-consumer-banking");
    // Regulatory governance anchors (spec §9.4).
    expect(byKey.get("bian-regulatory-compliance")?.parentKey).toBe("bian-compliance");
    expect(byKey.get("bian-guideline-compliance")?.parentKey).toBe("bian-compliance");
    // Composes with, not replaces, the common baseline.
    expect(byKey.has("finance")).toBe(true);
    // Every parentKey resolves within the resolved set (projection precondition).
    for (const capability of creditUnion.capabilities) {
      if (capability.parentKey) {
        expect(byKey.has(capability.parentKey), `${capability.key} parent ${capability.parentKey}`).toBe(true);
      }
    }
    // Keys are unique across the composed perspectives.
    expect(byKey.size).toBe(creditUnion.capabilities.length);

    // Other categories do not get the banking overlay.
    const salon = resolveBusinessCapabilityPerspective({ archetypeId: "hair-salon", category: "beauty-personal-care" });
    expect(salon.capabilities.some((c) => c.key.startsWith("bian-"))).toBe(false);
  });

  it("projects the three-level BIAN chain with correct parent links", async () => {
    const upsert = vi.fn(async (args) => ({
      id: `db-${args.where.capabilityId}`,
      capabilityId: args.where.capabilityId,
    }));
    const client = {
      businessCapability: {
        findMany: vi.fn(async () => []),
        upsert,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    await applyBusinessCapabilityPerspective(client, {
      archetypeId: "community-bank",
      category: "banking-financial-services",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capabilityId: `${BUSINESS_CAPABILITY_SEED_PREFIX}bian-customer-credit-rating` },
        create: expect.objectContaining({
          parentId: `db-${BUSINESS_CAPABILITY_SEED_PREFIX}bian-relationship-management`,
          level: 3,
        }),
      }),
    );
  });

  it("projects capabilities with deterministic seed IDs and parent links", async () => {
    const upsert = vi.fn(async (args) => ({
      id: `db-${args.where.capabilityId}`,
      capabilityId: args.where.capabilityId,
    }));
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const client = {
      businessCapability: {
        findMany: vi.fn(async () => []),
        upsert,
        updateMany,
      },
    };

    const result = await applyBusinessCapabilityPerspective(client, {
      archetypeId: "it-managed-services",
      category: "professional-services",
    });

    expect(result.sourcePerspectiveIds).toEqual([
      "common-small-business",
      "professional-services",
      "it-managed-services",
    ]);
    expect(result.appliedCount).toBeGreaterThan(10);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capabilityId: `${BUSINESS_CAPABILITY_SEED_PREFIX}finance` },
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capabilityId: `${BUSINESS_CAPABILITY_SEED_PREFIX}finance-invoicing-ar` },
        create: expect.objectContaining({
          parentId: `db-${BUSINESS_CAPABILITY_SEED_PREFIX}finance`,
        }),
        update: expect.objectContaining({
          parentId: `db-${BUSINESS_CAPABILITY_SEED_PREFIX}finance`,
        }),
      }),
    );
  });

  it("deactivates obsolete seed rows without touching manual capabilities", async () => {
    const staleSeedId = `${BUSINESS_CAPABILITY_SEED_PREFIX}old-msp-only-capability`;
    const upsert = vi.fn(async (args) => ({
      id: `db-${args.where.capabilityId}`,
      capabilityId: args.where.capabilityId,
    }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const client = {
      businessCapability: {
        findMany: vi.fn(async () => [
          { id: "old", capabilityId: staleSeedId },
          { id: "manual", capabilityId: "CUSTOM-OWNER-CAPABILITY" },
        ]),
        upsert,
        updateMany,
      },
    };

    const result = await applyBusinessCapabilityPerspective(client, {
      archetypeId: "hair-salon",
      category: "beauty-personal-care",
    });

    expect(result.deactivatedCount).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { capabilityId: { in: [staleSeedId] } },
      data: { status: "inactive" },
    });
  });

  it("does not overwrite maturity assessment fields during re-projection", async () => {
    const upsert = vi.fn(async (args) => ({
      id: `db-${args.where.capabilityId}`,
      capabilityId: args.where.capabilityId,
    }));
    const client = {
      businessCapability: {
        findMany: vi.fn(async () => []),
        upsert,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    await applyBusinessCapabilityPerspective(client, {
      archetypeId: null,
      category: null,
    });

    for (const call of upsert.mock.calls) {
      const update = call[0].update;
      expect(update).not.toHaveProperty("currentMaturity");
      expect(update).not.toHaveProperty("targetMaturity");
      expect(update).not.toHaveProperty("maturityRationale");
    }
  });
});
