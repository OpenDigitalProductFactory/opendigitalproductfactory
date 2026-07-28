import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  propose: vi.fn(),
  createWatch: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock(
  "@/lib/product-management/current-product-operating-context.server",
  () => ({
    ProductManagementAccessError: class extends Error {},
    ProductManagementOrganizationNotFoundError: class extends Error {},
    loadCurrentProductOperatingContextByKey: mocks.load,
  }),
);
vi.mock(
  "@/lib/product-management/product-operating-context-query",
  () => ({
    ProductOperatingContextNotFoundError: class extends Error {
      constructor() {
        super("Not found");
      }
    },
  }),
);
vi.mock("@/lib/wiki/research-proposal", () => ({
  proposeResearch: mocks.propose,
}));
vi.mock("@/lib/product-management/product-intelligence-watch", () => ({
  createProductIntelligenceWatch: mocks.createWatch,
}));

import {
  createProductIntelligenceWatchAction,
  proposeProductResearchAction,
} from "./product-intelligence";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.load.mockResolvedValue({
    provider: { id: "org-1" },
    products: [
      {
        id: "product-1",
        name: "Hair appointments",
        productLineId: "line-1",
      },
    ],
  });
  mocks.propose.mockResolvedValue({ proposalId: "proposal-1", created: true });
  mocks.createWatch.mockResolvedValue({ success: true, taskId: "task-1" });
});

describe("product intelligence actions", () => {
  it("does not load or mutate product intelligence for an unauthenticated caller", async () => {
    mocks.auth.mockResolvedValue(null);

    const result = await proposeProductResearchAction({
      productId: "product-1",
      topic: "Competitors",
      query: "What changed?",
    });

    expect(result).toEqual({ ok: false, error: "Not authenticated" });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it("creates a pending proposal at the exact business-product scope", async () => {
    const result = await proposeProductResearchAction({
      productId: "product-1",
      topic: "Competitive alternatives",
      query: "What changed in local salon memberships?",
    });

    expect(result.ok).toBe(true);
    expect(mocks.propose).toHaveBeenCalledWith({
      organizationId: "org-1",
      productLineId: "line-1",
      businessProductId: "product-1",
      topic: "Competitive alternatives",
      query: "What changed in local salon memberships?",
      proposedBy: "user",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/portfolio/product/product-1/direction/intelligence",
    );
  });

  it("does not mutate when the product is outside the authorized projection", async () => {
    mocks.load.mockResolvedValue({ provider: { id: "org-1" }, products: [] });

    const result = await proposeProductResearchAction({
      productId: "other-product",
      topic: "Competitors",
      query: "What changed?",
    });

    expect(result).toEqual({ ok: false, error: "This product is not available." });
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it("creates a typed watch whose cadence only proposes research", async () => {
    const result = await createProductIntelligenceWatchAction({
      productId: "product-1",
      topic: "Customer choice",
      query: "What new choice factors are visible?",
      schedule: "0 9 * * 1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.createWatch).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      organizationId: "org-1",
      productLineId: "line-1",
      businessProductId: "product-1",
      title: "Hair appointments intelligence scan",
      topic: "Customer choice",
      query: "What new choice factors are visible?",
      schedule: "0 9 * * 1",
    });
  });
});
