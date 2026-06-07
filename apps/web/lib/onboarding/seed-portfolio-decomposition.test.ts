import { describe, expect, it, vi } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { readActivationProfile } from "@/lib/storefront/archetype-activation";
import {
  seedPortfolioDecomposition,
  resolvePortfolioDecomposition,
} from "./seed-portfolio-decomposition";

const ORG = "org-test-1";

// A real archetype whose activationProfile yields a portfolio decomposition,
// so the derive step exercises the actual readActivationProfile path.
const archetypeWithPortfolios = ALL_ARCHETYPES.find(
  (a) => readActivationProfile(a.activationProfile)?.portfolios,
);
const ACTIVATION_PROFILE = archetypeWithPortfolios!.activationProfile;
const EXPECTED = readActivationProfile(ACTIVATION_PROFILE)!.portfolios;

function makeDb(opts: {
  businessContext: { id: string; portfolioDecomposition: unknown } | null;
  activationProfile?: unknown;
}) {
  const update = vi.fn().mockResolvedValue({});
  const db = {
    businessContext: {
      findUnique: vi.fn().mockResolvedValue(opts.businessContext),
      update,
    },
    storefrontConfig: {
      findFirst: vi.fn().mockResolvedValue(
        opts.activationProfile === undefined
          ? null
          : { archetype: { activationProfile: opts.activationProfile } },
      ),
    },
  };
  return { db, update };
}

describe("seedPortfolioDecomposition (BI-2D452667)", () => {
  it("seeds from the archetype when BusinessContext has no decomposition", async () => {
    const { db, update } = makeDb({
      businessContext: { id: "bc1", portfolioDecomposition: null },
      activationProfile: ACTIVATION_PROFILE,
    });

    const result = await seedPortfolioDecomposition({ organizationId: ORG, db: db as never });

    expect(result.seeded).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(result.decomposition).toEqual(EXPECTED);
    expect(update).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      data: { portfolioDecomposition: EXPECTED },
    });
  });

  it("does NOT overwrite an existing decomposition (seed-is-bootstrap)", async () => {
    const refined = { foundational: { scope: "primary" } };
    const { db, update } = makeDb({
      businessContext: { id: "bc1", portfolioDecomposition: refined },
      activationProfile: ACTIVATION_PROFILE,
    });

    const result = await seedPortfolioDecomposition({ organizationId: ORG, db: db as never });

    expect(result.seeded).toBe(false);
    expect(result.alreadyPresent).toBe(true);
    expect(result.decomposition).toEqual(refined);
    expect(update).not.toHaveBeenCalled();
  });

  it("no-ops when there is no BusinessContext row", async () => {
    const { db, update } = makeDb({ businessContext: null, activationProfile: ACTIVATION_PROFILE });

    const result = await seedPortfolioDecomposition({ organizationId: ORG, db: db as never });

    expect(result).toEqual({ seeded: false, alreadyPresent: false, decomposition: null });
    expect(update).not.toHaveBeenCalled();
  });

  it("no-ops when the archetype yields no decomposition", async () => {
    const { db, update } = makeDb({
      businessContext: { id: "bc1", portfolioDecomposition: null },
      activationProfile: "not-a-profile",
    });

    const result = await seedPortfolioDecomposition({ organizationId: ORG, db: db as never });

    expect(result.seeded).toBe(false);
    expect(result.decomposition).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("is idempotent: a second run after seeding does not overwrite", async () => {
    // Simulate the post-seed state: BusinessContext now carries EXPECTED.
    const { db, update } = makeDb({
      businessContext: { id: "bc1", portfolioDecomposition: EXPECTED },
      activationProfile: ACTIVATION_PROFILE,
    });

    const result = await seedPortfolioDecomposition({ organizationId: ORG, db: db as never });

    expect(result.alreadyPresent).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("resolvePortfolioDecomposition (BI-2D452667)", () => {
  it("prefers the persisted BusinessContext value", async () => {
    const persisted = { productsAndServicesSold: { scope: "primary" } };
    const { db } = makeDb({
      businessContext: { id: "bc1", portfolioDecomposition: persisted },
      activationProfile: ACTIVATION_PROFILE,
    });

    await expect(
      resolvePortfolioDecomposition({ organizationId: ORG, db: db as never }),
    ).resolves.toEqual(persisted);
    // archetype fallback must not be consulted when a persisted value exists
    expect(db.storefrontConfig.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the archetype-derived value when not yet persisted", async () => {
    const { db } = makeDb({
      businessContext: { id: "bc1", portfolioDecomposition: null },
      activationProfile: ACTIVATION_PROFILE,
    });

    await expect(
      resolvePortfolioDecomposition({ organizationId: ORG, db: db as never }),
    ).resolves.toEqual(EXPECTED);
    expect(db.storefrontConfig.findFirst).toHaveBeenCalled();
  });
});
