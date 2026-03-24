import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn().mockReturnValue("ABC12345"),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    fixedAsset: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  createAsset,
  getAsset,
  listAssets,
  calculateDepreciation,
  disposeAsset,
  runMonthlyDepreciation,
} from "./assets";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  fixedAsset: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

function authorisedUser(id = "user-001") {
  mockAuth.mockResolvedValue({
    user: { id, platformRole: "FIN-100", isSuperuser: false },
  });
  mockCan.mockReturnValue(true);
}

function unauthorisedUser() {
  mockAuth.mockResolvedValue({
    user: { id: "user-002", platformRole: "EMP-100", isSuperuser: false },
  });
  mockCan.mockReturnValue(false);
}

const validInput = {
  name: "Dell Laptop",
  category: "IT" as const,
  purchaseDate: "2026-01-15",
  purchaseCost: 1200,
  currency: "USD",
  depreciationMethod: "straight_line" as const,
  usefulLifeMonths: 36,
  residualValue: 200,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createAsset ──────────────────────────────────────────────────────────────

describe("createAsset", () => {
  it("throws Unauthorized when user lacks manage_finance", async () => {
    unauthorisedUser();
    await expect(createAsset(validInput)).rejects.toThrow("Unauthorized");
  });

  it("generates an FA- prefixed asset reference", async () => {
    authorisedUser();
    mockPrisma.fixedAsset.create.mockResolvedValue({
      id: "asset-001",
      assetId: "FA-ABC12345",
      ...validInput,
      currentBookValue: 1200,
    });

    await createAsset(validInput);

    expect(mockPrisma.fixedAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assetId: "FA-ABC12345",
        }),
      }),
    );
  });

  it("sets currentBookValue equal to purchaseCost", async () => {
    authorisedUser();
    mockPrisma.fixedAsset.create.mockResolvedValue({
      id: "asset-001",
      assetId: "FA-ABC12345",
      currentBookValue: 1200,
    });

    await createAsset(validInput);

    expect(mockPrisma.fixedAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentBookValue: 1200,
        }),
      }),
    );
  });
});

// ─── calculateDepreciation (straight_line) ────────────────────────────────────

describe("calculateDepreciation - straight_line", () => {
  it("returns correct monthly depreciation for 12000 cost, 2000 residual, 60 months", async () => {
    const result = await calculateDepreciation(12000, 2000, 60, "straight_line");

    expect(result.monthlySchedule).toHaveLength(60);
    // Monthly = (12000 - 2000) / 60 = 166.6666...
    expect(result.monthlySchedule[0].depreciation).toBeCloseTo(166.67, 1);
    // Final closing value should be residualValue
    const lastEntry = result.monthlySchedule[59];
    expect(lastEntry.closingValue).toBeCloseTo(2000, 2);
  });

  it("total depreciation equals purchaseCost - residualValue", async () => {
    const result = await calculateDepreciation(12000, 2000, 60, "straight_line");
    expect(result.totalDepreciation).toBeCloseTo(10000, 2);
  });

  it("final closing value exactly equals residualValue", async () => {
    const result = await calculateDepreciation(5000, 500, 12, "straight_line");
    const lastEntry = result.monthlySchedule[result.monthlySchedule.length - 1];
    expect(lastEntry.closingValue).toBeCloseTo(500, 5);
  });

  it("opening value of each month equals closing value of previous month", async () => {
    const result = await calculateDepreciation(6000, 0, 12, "straight_line");
    for (let i = 1; i < result.monthlySchedule.length; i++) {
      expect(result.monthlySchedule[i].openingValue).toBeCloseTo(
        result.monthlySchedule[i - 1].closingValue,
        10,
      );
    }
  });
});

// ─── calculateDepreciation (reducing_balance) ─────────────────────────────────

describe("calculateDepreciation - reducing_balance", () => {
  it("produces decreasing monthly depreciation amounts", async () => {
    const result = await calculateDepreciation(10000, 1000, 60, "reducing_balance");
    const amounts = result.monthlySchedule.map((e: { depreciation: number }) => e.depreciation);
    // Each month should depreciate less than the previous (reducing balance)
    for (let i = 1; i < Math.min(amounts.length, 10); i++) {
      expect(amounts[i]).toBeLessThan(amounts[i - 1]);
    }
  });

  it("approaches but never goes below residualValue", async () => {
    const result = await calculateDepreciation(10000, 1000, 60, "reducing_balance");
    for (const entry of result.monthlySchedule) {
      expect(entry.closingValue).toBeGreaterThanOrEqual(1000 - 0.001);
    }
  });

  it("opening value chain is consistent", async () => {
    const result = await calculateDepreciation(8000, 500, 48, "reducing_balance");
    for (let i = 1; i < result.monthlySchedule.length; i++) {
      expect(result.monthlySchedule[i].openingValue).toBeCloseTo(
        result.monthlySchedule[i - 1].closingValue,
        10,
      );
    }
  });
});

// ─── disposeAsset ─────────────────────────────────────────────────────────────

describe("disposeAsset", () => {
  it("returns a positive gainLoss when disposal exceeds book value", async () => {
    authorisedUser();
    mockPrisma.fixedAsset.findUnique.mockResolvedValue({
      id: "asset-001",
      currentBookValue: 800,
      status: "active",
    });
    mockPrisma.fixedAsset.update.mockResolvedValue({});

    const result = await disposeAsset("asset-001", { disposalAmount: 1000 });
    expect(result.gainLoss).toBe(200);
  });

  it("returns a negative gainLoss when disposal is less than book value (loss)", async () => {
    authorisedUser();
    mockPrisma.fixedAsset.findUnique.mockResolvedValue({
      id: "asset-001",
      currentBookValue: 800,
      status: "active",
    });
    mockPrisma.fixedAsset.update.mockResolvedValue({});

    const result = await disposeAsset("asset-001", { disposalAmount: 500 });
    expect(result.gainLoss).toBe(-300);
  });

  it("sets status to disposed", async () => {
    authorisedUser();
    mockPrisma.fixedAsset.findUnique.mockResolvedValue({
      id: "asset-001",
      currentBookValue: 500,
      status: "active",
    });
    mockPrisma.fixedAsset.update.mockResolvedValue({});

    await disposeAsset("asset-001", { disposalAmount: 500 });

    expect(mockPrisma.fixedAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "disposed" }),
      }),
    );
  });

  it("throws when asset not found", async () => {
    authorisedUser();
    mockPrisma.fixedAsset.findUnique.mockResolvedValue(null);

    await expect(disposeAsset("no-such-id", { disposalAmount: 100 })).rejects.toThrow("Asset not found");
  });
});

// ─── runMonthlyDepreciation ───────────────────────────────────────────────────

describe("runMonthlyDepreciation", () => {
  it("skips assets already at residual value", async () => {
    authorisedUser();
    mockPrisma.fixedAsset.findMany.mockResolvedValue([
      {
        id: "asset-001",
        purchaseCost: 5000,
        residualValue: 500,
        currentBookValue: 500,
        accumulatedDepreciation: 4500,
        usefulLifeMonths: 60,
        depreciationMethod: "straight_line",
        status: "active",
      },
    ]);

    const result = await runMonthlyDepreciation();
    expect(result.processed).toBe(0);
    expect(mockPrisma.fixedAsset.update).not.toHaveBeenCalled();
  });
});
