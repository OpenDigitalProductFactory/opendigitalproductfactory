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
    organization: {
      findFirst: vi.fn(),
    },
    organizationTaxProfile: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/actions/dunning", () => ({
  seedDefaultDunningSequence: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { seedDefaultDunningSequence } from "@/lib/actions/dunning";
import {
  applyFinancialProfile,
  getFinancialSetupStatus,
  getInvoiceDefaultTaxRate,
} from "./financial-setup";

const mockPrisma = prisma as unknown as {
  orgSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  dunningSequence: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  organization: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  organizationTaxProfile: {
    upsert: ReturnType<typeof vi.fn>;
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
  appliedProfileSlug: string | null;
}> = {}) => ({
  id: "settings-1",
  baseCurrency: "USD",
  autoFetchRates: true,
  lastRateFetchAt: null,
  appliedProfileSlug: null,
  createdAt: earlier,
  updatedAt: now,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSeedDunning.mockResolvedValue({ id: "seq-1" });
  // Default: no org row → OrganizationTaxProfile upsert is skipped
  mockPrisma.organization.findFirst.mockResolvedValue(null);
  mockPrisma.organizationTaxProfile.upsert.mockResolvedValue({});
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
      data: { baseCurrency: "GBP", autoFetchRates: true, appliedProfileSlug: "healthcare_wellness" },
    });
  });

  it("updates existing OrgSettings", async () => {
    const existing = makeSettings({ id: "existing-1" });
    mockPrisma.orgSettings.findFirst.mockResolvedValue(existing);
    mockPrisma.orgSettings.update.mockResolvedValue(existing);

    await applyFinancialProfile("professional_services");

    expect(mockPrisma.orgSettings.update).toHaveBeenCalledWith({
      where: { id: "existing-1" },
      data: { baseCurrency: "GBP", autoFetchRates: true, appliedProfileSlug: "professional_services" },
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
      data: { baseCurrency: "USD", autoFetchRates: true, appliedProfileSlug: "retail" },
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
    expect(result.baseCurrency).toBe("USD");
    expect(result.dunningActive).toBe(false);
  });

  it("returns isConfigured=true when appliedProfileSlug is set", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ appliedProfileSlug: "healthcare_wellness" }),
    );
    mockPrisma.dunningSequence.findFirst.mockResolvedValue({ id: "seq-1" });

    const result = await getFinancialSetupStatus();

    expect(result.isConfigured).toBe(true);
    expect(result.dunningActive).toBe(true);
  });

  it("returns isConfigured=false when appliedProfileSlug is null (freshly created)", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ appliedProfileSlug: null }),
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

// ─── getInvoiceDefaultTaxRate ───────────────────────────────────────────────

describe("getInvoiceDefaultTaxRate", () => {
  it("uses the profile rate when the org tax model is 'vat'", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({ taxModel: "vat" });
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ appliedProfileSlug: "trades_construction" }), // VAT-registered, 20%
    );
    expect(await getInvoiceDefaultTaxRate()).toBe(20);
  });

  it("returns 0 when the org tax model is 'none' even if the profile is VAT-registered", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({ taxModel: "none" });
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ appliedProfileSlug: "trades_construction" }),
    );
    expect(await getInvoiceDefaultTaxRate()).toBe(0);
  });

  it("falls back to a VAT-registered applied profile when no tax-profile row exists", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ appliedProfileSlug: "trades_construction" }),
    );
    expect(await getInvoiceDefaultTaxRate()).toBe(20);
  });

  it("falls back to a non-VAT applied profile (→ 0) when no tax-profile row exists", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.findFirst.mockResolvedValue(
      makeSettings({ appliedProfileSlug: "healthcare_wellness" }), // not VAT-registered, 0%
    );
    expect(await getInvoiceDefaultTaxRate()).toBe(0);
  });

  it("returns 0 when neither a tax profile nor an applied profile exists", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(null);
    mockPrisma.orgSettings.findFirst.mockResolvedValue(null);
    expect(await getInvoiceDefaultTaxRate()).toBe(0);
  });
});
