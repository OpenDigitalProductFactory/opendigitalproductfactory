import { describe, expect, it, vi } from "vitest";
import { seedStorefrontArchetypes } from "../src/seed-storefront-archetypes";

describe("seedStorefrontArchetypes", () => {
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
