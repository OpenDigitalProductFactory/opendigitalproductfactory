import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    orgSettings: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    exchangeRate: {
      findFirst: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  getOrgSettings,
  updateBaseCurrency,
  getExchangeRate,
  convertAmountSync,
  convertAmount,
  calculateFxGainLoss,
  storeExchangeRates,
} from "./currency";

const mockPrisma = prisma as unknown as {
  orgSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  exchangeRate: {
    findFirst: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── convertAmountSync ────────────────────────────────────────────────────────

describe("convertAmountSync", () => {
  it("converts 100 GBP at rate 1.27 to 127 USD", () => {
    expect(convertAmountSync(100, 1.27)).toBeCloseTo(127, 5);
  });

  it("returns same amount when rate is 1 (same currency passthrough)", () => {
    expect(convertAmountSync(250, 1)).toBe(250);
  });

  it("correctly applies a reducing rate", () => {
    expect(convertAmountSync(200, 0.787)).toBeCloseTo(157.4, 3);
  });
});

// ─── calculateFxGainLoss ──────────────────────────────────────────────────────

describe("calculateFxGainLoss", () => {
  it("returns positive value when payment exceeds invoice (gain)", () => {
    const result = calculateFxGainLoss(1000, 1050);
    expect(result).toBe(50);
  });

  it("returns negative value when payment is less than invoice (loss)", () => {
    const result = calculateFxGainLoss(1000, 950);
    expect(result).toBe(-50);
  });

  it("returns zero when payment matches invoice exactly", () => {
    const result = calculateFxGainLoss(1000, 1000);
    expect(result).toBe(0);
  });
});

// ─── getOrgSettings ───────────────────────────────────────────────────────────

describe("getOrgSettings", () => {
  it("returns existing settings when found", async () => {
    const existing = { id: "settings-001", baseCurrency: "GBP", autoFetchRates: true };
    mockPrisma.orgSettings.findFirst.mockResolvedValue(existing);

    const result = await getOrgSettings();
    expect(result).toEqual(existing);
    expect(mockPrisma.orgSettings.create).not.toHaveBeenCalled();
  });

  it("creates default settings when none exist", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    const created = { id: "settings-new", baseCurrency: "GBP", autoFetchRates: true };
    mockPrisma.orgSettings.create.mockResolvedValue(created);

    const result = await getOrgSettings();
    expect(mockPrisma.orgSettings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ baseCurrency: "GBP" }),
      }),
    );
    expect(result).toEqual(created);
  });
});

// ─── getExchangeRate ──────────────────────────────────────────────────────────

describe("getExchangeRate", () => {
  it("returns 1 for same currency", async () => {
    const rate = await getExchangeRate("GBP", "GBP");
    expect(rate).toBe(1);
    expect(mockPrisma.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it("returns stored rate from database when available", async () => {
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      id: "rate-001",
      baseCurrency: "GBP",
      targetCurrency: "USD",
      rate: 1.30,
      fetchedAt: new Date(),
    });

    const rate = await getExchangeRate("GBP", "USD");
    expect(rate).toBeCloseTo(1.30, 5);
  });

  it("falls back to hardcoded rate when DB has no entry", async () => {
    mockPrisma.exchangeRate.findFirst.mockResolvedValue(null);

    const rate = await getExchangeRate("GBP", "USD");
    expect(rate).toBeCloseTo(1.27, 2);
  });

  it("throws when no rate is available for unknown pair", async () => {
    mockPrisma.exchangeRate.findFirst.mockResolvedValue(null);

    await expect(getExchangeRate("GBP", "JPY")).rejects.toThrow("No exchange rate found");
  });

  it("returns 1 for EUR/EUR", async () => {
    const rate = await getExchangeRate("EUR", "EUR");
    expect(rate).toBe(1);
  });
});

// ─── convertAmount ────────────────────────────────────────────────────────────

describe("convertAmount", () => {
  it("converts using stored rate", async () => {
    mockPrisma.exchangeRate.findFirst.mockResolvedValue({
      id: "rate-001",
      baseCurrency: "GBP",
      targetCurrency: "EUR",
      rate: 1.20,
      fetchedAt: new Date(),
    });

    const result = await convertAmount(100, "GBP", "EUR");
    expect(result.convertedAmount).toBeCloseTo(120, 5);
    expect(result.rateUsed).toBeCloseTo(1.20, 5);
  });
});

// ─── storeExchangeRates ───────────────────────────────────────────────────────

describe("storeExchangeRates", () => {
  it("calls createMany with correctly mapped data", async () => {
    mockPrisma.exchangeRate.createMany.mockResolvedValue({ count: 2 });

    await storeExchangeRates([
      { base: "GBP", target: "USD", rate: 1.27 },
      { base: "GBP", target: "EUR", rate: 1.17 },
    ]);

    expect(mockPrisma.exchangeRate.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { baseCurrency: "GBP", targetCurrency: "USD", rate: 1.27 },
          { baseCurrency: "GBP", targetCurrency: "EUR", rate: 1.17 },
        ],
        skipDuplicates: true,
      }),
    );
  });
});
