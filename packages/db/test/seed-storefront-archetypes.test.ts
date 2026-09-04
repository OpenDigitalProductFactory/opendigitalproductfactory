import { describe, expect, it, vi } from "vitest";
import { seedStorefrontArchetypes } from "../src/seed-storefront-archetypes";

describe("seedStorefrontArchetypes", () => {
  it("persists typed process profiles for restaurant and animal-welfare archetypes", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      storefrontArchetype: {
        upsert,
      },
    } as never;

    await seedStorefrontArchetypes(prisma);

    const expectedProfiles = {
      restaurant: {
        catalogModes: ["priced"],
        subjectTypes: [],
        housesSubjects: false,
        schedulesSubjects: false,
        resourceKinds: [
          { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
        ],
      },
      "pet-rescue": {
        catalogModes: ["donation", "unpriced"],
        subjectTypes: ["animal"],
        housesSubjects: true,
        schedulesSubjects: true,
        resourceKinds: [
          { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
          { kindSlug: "foster-home", capacityUnit: "animals", maxCapacity: 12 },
        ],
      },
      "animal-shelter": {
        catalogModes: ["donation", "unpriced"],
        subjectTypes: ["animal"],
        housesSubjects: true,
        schedulesSubjects: true,
        resourceKinds: [
          { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
          { kindSlug: "foster-home", capacityUnit: "animals", maxCapacity: 12 },
        ],
      },
    } as const;

    for (const [archetypeId, processProfile] of Object.entries(expectedProfiles)) {
      const call = upsert.mock.calls.find(([args]) => args.where.archetypeId === archetypeId);
      expect(call?.[0].create.activationProfile).toMatchObject({ processProfile });
      expect(call?.[0].update.activationProfile).toMatchObject({ processProfile });
    }
  });

  it("persists activationProfile for the MSP archetype", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      storefrontArchetype: {
        upsert,
      },
    } as never;

    await seedStorefrontArchetypes(prisma);

    const mspCall = upsert.mock.calls.find(
      ([args]) => args.where.archetypeId === "it-managed-services",
    );

    expect(mspCall).toBeDefined();
    expect(mspCall?.[0].create.activationProfile).toMatchObject({
      profileType: "managed-service-provider",
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      axes: {
        primaryConsumer: "business",
        commercialModel: "recurring-agreement",
      },
      portfolios: {
        manufactureAndDeliver: {
          scope: "primary",
          it4itStages: ["detect-to-correct", "deploy-to-operate", "request-to-fulfill"],
        },
      },
    });
    expect(mspCall?.[0].update.activationProfile).toMatchObject({
      profileType: "managed-service-provider",
      capabilityOverrides: [
        {
          capabilityKey: "remote-support",
          applicability: "recommended",
        },
      ],
    });
  });

  it("persists appointment-checkout activationProfile for hair salons", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      storefrontArchetype: {
        upsert,
      },
    } as never;

    await seedStorefrontArchetypes(prisma);

    const salonCall = upsert.mock.calls.find(
      ([args]) => args.where.archetypeId === "hair-salon",
    );

    expect(salonCall).toBeDefined();
    expect(salonCall?.[0].create.activationProfile).toMatchObject({
      profileType: "standard",
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        primaryConsumer: "individual",
        commercialModel: "appointment-checkout",
      },
      portfolios: {
        productsAndServicesSold: { scope: "primary" },
      },
    });
    expect(salonCall?.[0].update.activationProfile).toMatchObject({
      axes: {
        commercialModel: "appointment-checkout",
      },
    });
  });

  it("upserts the three BIAN banking archetypes with vocabulary overrides and regulated marketing rules (BI-5D9DCDE6)", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      storefrontArchetype: {
        upsert,
      },
    } as never;

    await seedStorefrontArchetypes(prisma);

    // Count assertion (silent-seed-skip guard): all three banking rows upsert.
    const bankingCalls = upsert.mock.calls.filter(
      ([args]) => args.create.category === "banking-financial-services",
    );
    expect(bankingCalls.map(([args]) => args.where.archetypeId).sort()).toEqual([
      "community-bank",
      "credit-union",
      "mortgage-lending",
    ]);

    // Credit-union member vocabulary lands in customVocabulary on create AND update.
    const cuCall = upsert.mock.calls.find(([args]) => args.where.archetypeId === "credit-union");
    expect(cuCall?.[0].create.customVocabulary).toMatchObject({ stakeholderLabel: "Members" });
    expect(cuCall?.[0].update.customVocabulary).toMatchObject({ stakeholderLabel: "Members" });

    // Community bank carries no override: create writes null, update leaves
    // customVocabulary untouched (operator edits preserved).
    const bankCall = upsert.mock.calls.find(([args]) => args.where.archetypeId === "community-bank");
    expect(bankCall?.[0].create.customVocabulary).toBeNull();
    expect(bankCall?.[0].update).not.toHaveProperty("customVocabulary");

    // Regulated-communication marketing rules attach per category.
    expect(bankCall?.[0].create.marketingSkillRules).toMatchObject({
      "competitive-analysis": { label: "Local Institution Positioning" },
      "email-campaign-builder": { label: "Customer & Member Communication Builder" },
    });

    // KYC posture persists through the seed.
    expect(bankCall?.[0].create.activationProfile).toMatchObject({
      axes: { provisioning: "account-with-kyc", commercialModel: "account-based-fees" },
    });
  });

  it("upserts the software-platform archetype for DPF product installs", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      storefrontArchetype: {
        upsert,
      },
    } as never;

    await seedStorefrontArchetypes(prisma);

    const softwarePlatformCall = upsert.mock.calls.find(
      ([args]) => args.where.archetypeId === "software-platform",
    );

    expect(softwarePlatformCall).toBeDefined();
    expect(softwarePlatformCall?.[0].create.category).toBe("software-platform");
    expect(softwarePlatformCall?.[0].create.ctaType).toBe("inquiry");
    expect(softwarePlatformCall?.[0].create.itemTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Open Digital Product Factory" }),
      ]),
    );
  });
});
