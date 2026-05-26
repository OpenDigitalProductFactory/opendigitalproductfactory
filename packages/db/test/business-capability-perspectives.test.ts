import { describe, expect, it, vi } from "vitest";
import {
  BUSINESS_CAPABILITY_SEED_PREFIX,
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

    expect(msp.sourcePerspectiveIds).toEqual(["common-small-business", "it-managed-services"]);
    expect(msp.sources.map((source) => source.label)).toEqual(["Common Small Business", "IT Managed Services"]);
    expect(msp.sources.map((source) => source.source)).toEqual([
      "DPF baseline informed by APQC-style process families",
      "DPF MSP overlay informed by managed services, customer estate, NIST CSF, and service-agreement operating patterns",
    ]);
    expect(msp.capabilities.some((capability) => capability.key === "msp-managed-customer-estate")).toBe(true);
    expect(msp.capabilities.some((capability) => capability.key === "finance")).toBe(true);
    expect(salon.sourcePerspectiveIds).toEqual(["common-small-business"]);
    expect(salon.sources.map((source) => source.label)).toEqual(["Common Small Business"]);
    expect(salon.capabilities.some((capability) => capability.key === "msp-managed-customer-estate")).toBe(false);
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

    expect(result.sourcePerspectiveIds).toEqual(["common-small-business", "it-managed-services"]);
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
