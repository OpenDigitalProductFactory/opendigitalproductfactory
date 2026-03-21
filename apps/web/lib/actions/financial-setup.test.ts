import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    orgSettings: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    dunningSequence: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/actions/dunning", () => ({
  seedDefaultDunningSequence: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { seedDefaultDunningSequence } from "@/lib/actions/dunning";
import { applyFinancialProfile, getFinancialSetupStatus } from "./financial-setup";

const mockPrisma = prisma as unknown as {
  orgSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  dunningSequence: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};
const mockSeedDunning = vi.mocked(seedDefaultDunningSequence);

const now = new Date();
const earlier = new Date(now.getTime() - 1000);

const makeSettings = (overrides: Partial<{
  id: string;
  baseCurrency: string;
  autoFetchRates: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) => ({
  id: "settings-1",
  baseCurrency: "GBP",
  autoFetchRates: true,
  lastRateFetchAt: null,
  createdAt: earlier,
  updatedAt: now,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSeedDunning.mockResolvedValue({ id: "seq-1" });
});

// ─── applyFinancialProfile ─────────────────────────────────────────────────

describe("applyFinancialProfile", () => {
  it("throws for unknown profile slug", async () => {
    await expect(applyFinancialProfile("unknown_slug")).rejects.toThrow(
      "Financial profile not found: unknown_slug",
    );
  });

  it("creates OrgSettings when none exist and uses profile default currency", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.create.mockResolvedValue(makeSettings({ baseCurrency: "GBP" }));

    const result = await applyFinancialProfile("healthcare_wellness");

    expect(result.applied).toBe(true);
    expect(result.profileName).toBe("Healthcare & Wellness");
    expect(mockPrisma.orgSettings.create).toHaveBeenCalledWith({
      data: { baseCurrency: "GBP", autoFetchRates: true },
    });
  });

  it("updates existing OrgSettings", async () => {
    const existing = makeSettings({ id: "existing-1" });
    mockPrisma.orgSettings.findFirst.mockResolvedValue(existing);
    mockPrisma.orgSettings.update.mockResolvedValue(existing);

    await applyFinancialProfile("professional_services");

    expect(mockPrisma.orgSettings.update).toHaveBeenCalledWith({
      where: { id: "existing-1" },
      data: { baseCurrency: "GBP", autoFetchRates: true },
    });
    expect(mockPrisma.orgSettings.create).not.toHaveBeenCalled();
  });

  it("seeds dunning for profiles with dunning enabled", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.create.mockResolvedValue(makeSettings());

    await applyFinancialProfile("trades_construction");

    expect(mockSeedDunning).toHaveBeenCalledTimes(1);
  });

  it("skips dunning for nonprofit profile", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.create.mockResolvedValue(makeSettings());

    await applyFinancialProfile("nonprofit");

    expect(mockSeedDunning).not.toHaveBeenCalled();
  });

  it("applies baseCurrency override", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.create.mockResolvedValue(makeSettings({ baseCurrency: "USD" }));

    await applyFinancialProfile("retail", { baseCurrency: "USD" });

    expect(mockPrisma.orgSettings.create).toHaveBeenCalledWith({
      data: { baseCurrency: "USD", autoFetchRates: true },
    });
  });

  it("vatRegistered override is accepted without error", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.create.mockResolvedValue(makeSettings());

    const result = await applyFinancialProfile("healthcare_wellness", { vatRegistered: true });
    expect(result.applied).toBe(true);
  });
});

// ─── getFinancialSetupStatus ───────────────────────────────────────────────

describe("getFinancialSetupStatus", () => {
  it("returns isConfigured=false when no OrgSettings exist", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);

    const result = await getFinancialSetupStatus();

    expect(result.isConfigured).toBe(false);
    expect(result.baseCurrency).toBe("GBP");
    expect(result.dunningActive).toBe(false);
  });

  it("returns isConfigured=true when updatedAt > createdAt", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ createdAt: earlier, updatedAt: now }),
    );
    mockPrisma.dunningSequence.findFirst.mockResolvedValue({ id: "seq-1" });

    const result = await getFinancialSetupStatus();

    expect(result.isConfigured).toBe(true);
    expect(result.dunningActive).toBe(true);
  });

  it("returns isConfigured=false when updatedAt equals createdAt (freshly created)", async () => {
    const sameTime = new Date("2026-01-01T12:00:00Z");
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ createdAt: sameTime, updatedAt: sameTime }),
    );
    mockPrisma.dunningSequence.findFirst.mockResolvedValue(null);

    const result = await getFinancialSetupStatus();

    expect(result.isConfigured).toBe(false);
    expect(result.dunningActive).toBe(false);
  });

  it("returns the baseCurrency from OrgSettings", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ baseCurrency: "EUR", createdAt: earlier, updatedAt: now }),
    );
    mockPrisma.dunningSequence.findFirst.mockResolvedValue(null);

    const result = await getFinancialSetupStatus();

    expect(result.baseCurrency).toBe("EUR");
  });
});
