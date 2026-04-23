import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted — no top-level variable references) ─────────────────────

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    productVersion: { create: vi.fn() },
    changePromotion: { create: vi.fn() },
    changeRequest: { create: vi.fn() },
    changeItem: { create: vi.fn() },
  },
}));

vi.mock("../actions/change-management", () => ({
  generateRfcId: vi.fn(() => "RFC-2026-AABBCCDD"),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { prisma } from "@dpf/db";
import { generatePromotionId, createProductVersionWithRFC } from "./version-tracking";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("generatePromotionId", () => {
  it("returns CP- prefixed ID", () => {
    const id = generatePromotionId();
    expect(id).toMatch(/^CP-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePromotionId()));
    expect(ids.size).toBe(100);
  });
});

describe("createProductVersionWithRFC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseInput = {
    digitalProductId: "dp-1",
    version: "1.2.0",
    gitTag: "v1.2.0",
    gitCommitHash: "abc123",
    shippedBy: "user-1",
    featureBuildId: "fb-1",
    changeSummary: "Added widget feature",
  };

  it("creates ProductVersion, ChangePromotion, RFC, and ChangeItem in a transaction", async () => {
    const txMocks = {
      productVersion: { create: vi.fn().mockResolvedValue({ id: "pv-1" }) },
      changePromotion: { create: vi.fn().mockResolvedValue({ id: "cp-1" }) },
      changeRequest: { create: vi.fn().mockResolvedValue({ id: "cr-1" }) },
      changeItem: { create: vi.fn().mockResolvedValue({ id: "ci-1" }) },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(txMocks));

    const result = await createProductVersionWithRFC(baseInput);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // ProductVersion created with correct data
    expect(txMocks.productVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        digitalProductId: "dp-1",
        version: "1.2.0",
        gitTag: "v1.2.0",
        gitCommitHash: "abc123",
        shippedBy: "user-1",
        featureBuildId: "fb-1",
        changeSummary: "Added widget feature",
      }),
      select: { id: true },
    });

    // ChangePromotion links to ProductVersion
    expect(txMocks.changePromotion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productVersionId: "pv-1",
        status: "pending",
        requestedBy: "user-1",
      }),
      select: { id: true },
    });

    // RFC created with normal type and draft status
    expect(txMocks.changeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rfcId: "RFC-2026-AABBCCDD",
        title: "Ship v1.2.0",
        type: "normal",
        status: "draft",
        scope: "platform",
      }),
      select: { id: true },
    });

    // ChangeItem links RFC to promotion
    expect(txMocks.changeItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeRequestId: "cr-1",
        changePromotionId: "cp-1",
        itemType: "promotion",
        title: "Promote v1.2.0",
        description: "Added widget feature",
      }),
    });

    // Return shape
    expect(result.version).toEqual({ id: "pv-1" });
    expect(result.promotion.id).toBe("cp-1");
    expect(result.promotion.promotionId).toMatch(/^CP-/);
    expect(result.rfc.id).toBe("cr-1");
    expect(result.rfc.rfcId).toBe("RFC-2026-AABBCCDD");
  });

  it("RFC type is always 'normal' (self-dev changes require human approval)", async () => {
    const txMocks = {
      productVersion: { create: vi.fn().mockResolvedValue({ id: "pv-2" }) },
      changePromotion: { create: vi.fn().mockResolvedValue({ id: "cp-2" }) },
      changeRequest: { create: vi.fn().mockResolvedValue({ id: "cr-2" }) },
      changeItem: { create: vi.fn().mockResolvedValue({ id: "ci-2" }) },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(txMocks));

    await createProductVersionWithRFC(baseInput);

    const rfcData = txMocks.changeRequest.create.mock.calls[0][0].data;
    expect(rfcData.type).toBe("normal");
  });

  it("RFC status is always 'draft'", async () => {
    const txMocks = {
      productVersion: { create: vi.fn().mockResolvedValue({ id: "pv-3" }) },
      changePromotion: { create: vi.fn().mockResolvedValue({ id: "cp-3" }) },
      changeRequest: { create: vi.fn().mockResolvedValue({ id: "cr-3" }) },
      changeItem: { create: vi.fn().mockResolvedValue({ id: "ci-3" }) },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(txMocks));

    await createProductVersionWithRFC(baseInput);

    const rfcData = txMocks.changeRequest.create.mock.calls[0][0].data;
    expect(rfcData.status).toBe("draft");
  });

  it("uses fallback description when changeSummary is not provided", async () => {
    const txMocks = {
      productVersion: { create: vi.fn().mockResolvedValue({ id: "pv-4" }) },
      changePromotion: { create: vi.fn().mockResolvedValue({ id: "cp-4" }) },
      changeRequest: { create: vi.fn().mockResolvedValue({ id: "cr-4" }) },
      changeItem: { create: vi.fn().mockResolvedValue({ id: "ci-4" }) },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(txMocks));

    await createProductVersionWithRFC({
      digitalProductId: "dp-2",
      version: "2.0.0",
      gitTag: "v2.0.0",
      gitCommitHash: "def456",
      shippedBy: "user-2",
    });

    const rfcData = txMocks.changeRequest.create.mock.calls[0][0].data;
    expect(rfcData.description).toMatch(/Promotion CP-.+ for v2\.0\.0/);

    // ChangeItem description should be null when no changeSummary
    const itemData = txMocks.changeItem.create.mock.calls[0][0].data;
    expect(itemData.description).toBeNull();
  });

  it("sets featureBuildId to null when not provided", async () => {
    const txMocks = {
      productVersion: { create: vi.fn().mockResolvedValue({ id: "pv-5" }) },
      changePromotion: { create: vi.fn().mockResolvedValue({ id: "cp-5" }) },
      changeRequest: { create: vi.fn().mockResolvedValue({ id: "cr-5" }) },
      changeItem: { create: vi.fn().mockResolvedValue({ id: "ci-5" }) },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(txMocks));

    await createProductVersionWithRFC({
      digitalProductId: "dp-3",
      version: "3.0.0",
      gitTag: "v3.0.0",
      gitCommitHash: "ghi789",
      shippedBy: "user-3",
    });

    const pvData = txMocks.productVersion.create.mock.calls[0][0].data;
    expect(pvData.featureBuildId).toBeNull();
  });
});
