import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    aiProviderFinanceProfile: {
      findMany: findManyMock,
    },
  },
}));

describe("getCapacityProviderFinanceSignals", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("maps live finance profiles to provider-class signals", async () => {
    findManyMock.mockResolvedValue([
      {
        providerId: "openai",
        provider: { providerId: "openai", status: "active", costBand: "medium" },
        supplierContracts: [
          {
            monthlyCommittedAmount: { toString: () => "200" },
            allowsOverage: false,
            allowances: [{ includedQuantity: { toString: () => "1000000" } }],
            usageSnapshots: [
              {
                utilizationPct: 42,
                projectedUnusedValue: { toString: () => "80" },
                projectedOverageCost: { toString: () => "0" },
              },
            ],
          },
        ],
      },
      {
        providerId: "usage-metered",
        provider: { providerId: "usage-metered", status: "active", costBand: "high" },
        supplierContracts: [
          {
            monthlyCommittedAmount: null,
            allowsOverage: true,
            allowances: [],
            usageSnapshots: [
              {
                utilizationPct: 99,
                projectedUnusedValue: { toString: () => "0" },
                projectedOverageCost: { toString: () => "15" },
              },
            ],
          },
        ],
      },
      {
        providerId: "ollama",
        provider: { providerId: "ollama", status: "active", costBand: "free" },
        supplierContracts: [],
      },
    ]);

    const { getCapacityProviderFinanceSignals } = await import("./finance-signals");

    await expect(getCapacityProviderFinanceSignals()).resolves.toEqual([
      {
        providerId: "openai",
        providerClass: "fixed-cost",
        status: "active",
        utilizationPct: 42,
        projectedUnusedValue: 80,
        overageRisk: false,
      },
      {
        providerId: "usage-metered",
        providerClass: "token-priced",
        status: "active",
        utilizationPct: 99,
        projectedUnusedValue: 0,
        overageRisk: true,
      },
      {
        providerId: "ollama",
        providerClass: "local",
        status: "active",
        utilizationPct: null,
        projectedUnusedValue: 0,
        overageRisk: false,
      },
    ]);
  });
});
