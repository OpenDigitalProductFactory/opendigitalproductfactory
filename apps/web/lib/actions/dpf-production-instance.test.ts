import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    businessContext: {
      upsert: vi.fn(),
    },
    storefrontConfig: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

import { applyDpfProductionInstancePreset } from "./dpf-production-instance";

describe("applyDpfProductionInstancePreset", () => {
  beforeEach(() => {
    mockPrisma.organization.findFirst.mockReset();
    mockPrisma.organization.update.mockReset();
    mockPrisma.businessContext.upsert.mockReset();
    mockPrisma.storefrontConfig.findFirst.mockReset();
    mockPrisma.storefrontConfig.update.mockReset();

    mockPrisma.organization.findFirst.mockResolvedValue({ id: "org_1", slug: "managing-digital" });
    mockPrisma.storefrontConfig.findFirst.mockResolvedValue({ id: "sf_1", organizationId: "org_1" });
    mockPrisma.organization.update.mockImplementation(async ({ data }) => ({ id: "org_1", ...data }));
    mockPrisma.businessContext.upsert.mockImplementation(async ({ create, update }) => ({ id: "bc_1", ...create, ...update }));
    mockPrisma.storefrontConfig.update.mockImplementation(async ({ data }) => ({ id: "sf_1", ...data }));
  });

  it("updates Organization name, slug, and contact fields to DPF truth", async () => {
    await applyDpfProductionInstancePreset();

    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: expect.objectContaining({
        name: "Open Digital Product Factory",
        slug: "open-digital-product-factory",
        website: "https://opendigitalproductfactory.com",
        industry: "software-platform",
      }),
    });
  });

  it("updates BusinessContext to DPF operating-business truth", async () => {
    await applyDpfProductionInstancePreset();

    const call = mockPrisma.businessContext.upsert.mock.calls[0]?.[0];
    expect(call?.where).toEqual({ organizationId: "org_1" });
    expect(call?.create.organizationId).toBe("org_1");
    expect(call?.create.description).toContain("Open Digital Product Factory");
    expect(call?.create.targetMarket.toLowerCase()).toContain("organizations");
    expect(call?.create.revenueModel).toBe("Platform subscriptions and services");
    expect(call?.update.description).toContain("Open Digital Product Factory");
    expect(call?.update.targetMarket.toLowerCase()).toContain("organizations");
  });

  it("updates StorefrontConfig presentation fields", async () => {
    await applyDpfProductionInstancePreset();

    expect(mockPrisma.storefrontConfig.update).toHaveBeenCalledWith({
      where: { id: "sf_1" },
      data: expect.objectContaining({
        tagline: "Run your digital product operation on the platform that runs itself.",
        contactEmail: "hello@opendigitalproductfactory.com",
      }),
    });
  });

  it("is idempotent when run twice", async () => {
    const first = await applyDpfProductionInstancePreset();
    const second = await applyDpfProductionInstancePreset();

    expect(first.organization.slug).toBe("open-digital-product-factory");
    expect(second.organization.slug).toBe("open-digital-product-factory");
    expect(mockPrisma.organization.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.businessContext.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.storefrontConfig.update).toHaveBeenCalledTimes(2);
  });
});
