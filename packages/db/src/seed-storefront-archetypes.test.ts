import { describe, expect, it, vi } from "vitest";
import { seedStorefrontArchetypes } from "./seed-storefront-archetypes";

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
    });
    expect(mspCall?.[0].update.activationProfile).toMatchObject({
      profileType: "managed-service-provider",
    });
  });
});
