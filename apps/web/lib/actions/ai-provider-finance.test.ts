import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  seedBridge: vi.fn(),
  activateContract: vi.fn(),
  getOverview: vi.fn(),
  getProviderDetail: vi.fn(),
  getSupplierDetail: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mocks.can,
}));

vi.mock("@/lib/finance/ai-provider-finance", () => ({
  seedAiProviderFinanceBridge: mocks.seedBridge,
  activateAiProviderContract: mocks.activateContract,
  getAiSpendOverview: mocks.getOverview,
  getAiProviderFinanceDetail: mocks.getProviderDetail,
  getAiSupplierFinanceDetail: mocks.getSupplierDetail,
}));

import {
  activateAiProviderContractAction,
  loadAiProviderFinanceDetailAction,
  loadAiSpendOverviewAction,
  loadAiSupplierFinanceDetailAction,
  seedAiProviderFinanceBridgeAction,
} from "./ai-provider-finance";

describe("ai-provider-finance actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: true },
    });
    mocks.can.mockReturnValue(true);
  });

  it("seeds the finance bridge behind a finance permission check", async () => {
    mocks.seedBridge.mockResolvedValue({ profileId: "profile-1" });

    await seedAiProviderFinanceBridgeAction({
      providerId: "openai",
      providerName: "OpenAI",
    });

    expect(mocks.seedBridge).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "openai" }),
    );
  });

  it("loads the AI spend overview", async () => {
    mocks.getOverview.mockResolvedValue({ supplierCount: 1 });

    const result = await loadAiSpendOverviewAction();

    expect(result).toEqual({ supplierCount: 1 });
  });

  it("loads provider and supplier finance detail", async () => {
    mocks.getProviderDetail.mockResolvedValue({ id: "profile-1" });
    mocks.getSupplierDetail.mockResolvedValue({ id: "supplier-1" });

    await expect(loadAiProviderFinanceDetailAction("openai")).resolves.toEqual({ id: "profile-1" });
    await expect(loadAiSupplierFinanceDetailAction("supplier-1")).resolves.toEqual({ id: "supplier-1" });
  });

  it("activates an AI provider contract", async () => {
    mocks.activateContract.mockResolvedValue({ id: "contract-1", status: "active" });

    const result = await activateAiProviderContractAction({
      contractId: "contract-1",
      accountableEmployeeId: "emp-1",
      currency: "USD",
      monthlyCommittedAmount: 500,
      billingCadence: "monthly",
      allowances: [
        {
          allowanceName: "Tokens",
          usageUnit: "tokens",
          includedQuantity: 1000,
        },
      ],
    });

    expect(result).toEqual({ id: "contract-1", status: "active" });
  });
});
