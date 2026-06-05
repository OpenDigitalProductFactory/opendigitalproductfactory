import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supplierFindFirst: vi.fn(),
  supplierCreate: vi.fn(),
  aiProfileUpsert: vi.fn(),
  contractFindFirst: vi.fn(),
  contractCreate: vi.fn(),
  contractUpsert: vi.fn(),
  contractUpdate: vi.fn(),
  allowanceDeleteMany: vi.fn(),
  allowanceCreateMany: vi.fn(),
  modelProviderFindMany: vi.fn(),
  workItemCreate: vi.fn(),
  workItemFindFirst: vi.fn(),
  workItemUpdateMany: vi.fn(),
  billFindFirst: vi.fn(),
  billCreate: vi.fn(),
  billLineItemCreateMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  Prisma: {
    Decimal: class Decimal {
      value: number;
      constructor(value: number) {
        this.value = value;
      }
    },
  },
  prisma: {
    supplier: {
      findFirst: mocks.supplierFindFirst,
      create: mocks.supplierCreate,
    },
    aiProviderFinanceProfile: {
      upsert: mocks.aiProfileUpsert,
    },
    supplierContract: {
      findFirst: mocks.contractFindFirst,
      create: mocks.contractCreate,
      upsert: mocks.contractUpsert,
      update: mocks.contractUpdate,
    },
    modelProvider: {
      findMany: mocks.modelProviderFindMany,
    },
    contractAllowance: {
      deleteMany: mocks.allowanceDeleteMany,
      createMany: mocks.allowanceCreateMany,
    },
    financeWorkItem: {
      create: mocks.workItemCreate,
      findFirst: mocks.workItemFindFirst,
      updateMany: mocks.workItemUpdateMany,
    },
    bill: {
      findFirst: mocks.billFindFirst,
      create: mocks.billCreate,
    },
    billLineItem: {
      createMany: mocks.billLineItemCreateMany,
    },
  },
}));

import {
  activateAiProviderContract,
  ensureFinanceCommitment,
  evaluateAiProviderUtilization,
  generateDraftBillForAiContract,
  reconcileAiProviderFinanceGaps,
  seedAiProviderFinanceBridge,
} from "./ai-provider-finance";

describe("seedAiProviderFinanceBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supplierFindFirst.mockResolvedValue(null);
    mocks.supplierCreate.mockResolvedValue({ id: "supplier-row-1", supplierId: "SUP-1" });
    mocks.aiProfileUpsert.mockResolvedValue({ id: "profile-1", supplierId: "supplier-row-1" });
    mocks.contractFindFirst.mockResolvedValue(null);
    mocks.contractCreate.mockResolvedValue({ id: "contract-1", contractId: "AIC-1" });
    mocks.workItemFindFirst.mockResolvedValue(null);
    mocks.workItemCreate.mockResolvedValue({ id: "work-1", workItemId: "FWI-1" });
  });

  it("seeds supplier, profile, draft contract, and a plan-details work item when plan data is incomplete", async () => {
    const result = await seedAiProviderFinanceBridge({
      providerId: "openai",
      providerName: "OpenAI",
      billingUrl: "https://platform.openai.com/settings/organization/billing",
      usageUrl: "https://platform.openai.com/usage",
    });

    expect(mocks.supplierCreate).toHaveBeenCalled();
    expect(mocks.aiProfileUpsert).toHaveBeenCalled();
    expect(mocks.contractCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "draft",
        }),
      }),
    );
    expect(mocks.workItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "plan_details_needed",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        supplierId: "supplier-row-1",
        contractId: "contract-1",
        workItemId: "work-1",
      }),
    );
  });

  it("does not create duplicate plan-details asks for the same contract gap", async () => {
    mocks.workItemFindFirst.mockResolvedValue({ id: "existing-work", workItemId: "FWI-EXISTING" });

    const result = await seedAiProviderFinanceBridge({
      providerId: "chatgpt",
      providerName: "ChatGPT Subscription",
    });

    expect(mocks.workItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: "contract-1",
          type: "plan_details_needed",
          status: { in: ["open", "in_progress"] },
        }),
      }),
    );
    expect(mocks.workItemCreate).not.toHaveBeenCalled();
    expect(result.workItemId).toBe("existing-work");
  });
});

describe("ensureFinanceCommitment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supplierFindFirst.mockResolvedValue(null);
    mocks.supplierCreate.mockResolvedValue({ id: "supplier-domain", supplierId: "SUP-DOMAIN" });
    mocks.contractUpsert.mockResolvedValue({ id: "contract-domain", contractId: "FNC-DOMAIN" });
    mocks.workItemFindFirst.mockResolvedValue(null);
    mocks.workItemCreate.mockResolvedValue({ id: "work-domain", workItemId: "FWI-DOMAIN" });
  });

  it("creates a general subscription commitment without requiring an AI provider profile", async () => {
    const result = await ensureFinanceCommitment({
      commitmentKind: "domain",
      externalReference: "domain:opendigitalproductfactory.com",
      title: "opendigitalproductfactory.com",
      supplierName: "Domain registrar",
      contractType: "subscription",
      billingCadence: "annual",
      currency: "USD",
      commitmentSource: "detected_portal_domain",
    });

    expect(mocks.contractUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalReference: "domain:opendigitalproductfactory.com" },
        create: expect.objectContaining({
          profileId: null,
          commitmentKind: "domain",
          externalReference: "domain:opendigitalproductfactory.com",
          commitmentSource: "detected_portal_domain",
        }),
      }),
    );
    expect(mocks.workItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "commitment_details_needed",
          metadata: expect.objectContaining({
            missingFields: expect.arrayContaining(["monthlyCommittedAmount", "renewalDate"]),
            routeTarget: "/finance/spend",
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        supplierId: "supplier-domain",
        contractId: "contract-domain",
        workItemId: "work-domain",
      }),
    );
  });
});

describe("reconcileAiProviderFinanceGaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.modelProviderFindMany.mockResolvedValue([
      {
        providerId: "anthropic-sub",
        name: "Claude/Anthropic OAuth Subscription",
        status: "active",
        cliEngine: "claude",
        costModel: "subscription",
        billingLabel: "Max subscription (included)",
        consoleUrl: "https://console.anthropic.com/settings/billing",
        docsUrl: "https://support.anthropic.com/",
        inputPricePerMToken: null,
        outputPricePerMToken: null,
        financeProfile: null,
      },
      {
        providerId: "codex",
        name: "OpenAI Codex",
        status: "active",
        cliEngine: "codex",
        costModel: "subscription",
        billingLabel: "ChatGPT subscription",
        consoleUrl: "https://chatgpt.com/#settings/Subscription",
        docsUrl: "https://help.openai.com/",
        inputPricePerMToken: null,
        outputPricePerMToken: null,
        financeProfile: null,
      },
    ]);
    mocks.supplierFindFirst.mockResolvedValue(null);
    mocks.supplierCreate
      .mockResolvedValueOnce({ id: "supplier-anthropic", supplierId: "SUP-ANT" })
      .mockResolvedValueOnce({ id: "supplier-openai", supplierId: "SUP-OAI" });
    mocks.aiProfileUpsert
      .mockResolvedValueOnce({ id: "profile-anthropic", supplierId: "supplier-anthropic" })
      .mockResolvedValueOnce({ id: "profile-openai", supplierId: "supplier-openai" });
    mocks.contractFindFirst.mockResolvedValue(null);
    mocks.contractCreate
      .mockResolvedValueOnce({ id: "contract-anthropic", contractId: "AIC-ANT" })
      .mockResolvedValueOnce({ id: "contract-openai", contractId: "AIC-OAI" });
    mocks.workItemFindFirst.mockResolvedValue(null);
    mocks.workItemCreate
      .mockResolvedValueOnce({ id: "work-anthropic", workItemId: "FWI-ANT" })
      .mockResolvedValueOnce({ id: "work-openai", workItemId: "FWI-OAI" });
  });

  it("queues human asks for active Claude and Codex subscription providers that lack finance details", async () => {
    const result = await reconcileAiProviderFinanceGaps();

    expect(mocks.modelProviderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "active",
        }),
      }),
    );
    expect(mocks.aiProfileUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.workItemCreate).toHaveBeenCalledTimes(2);
    expect(mocks.workItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Complete AI plan details for Claude/Anthropic OAuth Subscription",
          metadata: expect.objectContaining({
            askKind: "human_finance_gap",
            missingFields: expect.arrayContaining(["monthlyCommittedAmount", "includedQuantity", "usageUnit"]),
          }),
        }),
      }),
    );
    expect(result).toEqual({ inspectedProviders: 2, seededProfiles: 2, queuedHumanAsks: 2 });
  });
});

describe("activateAiProviderContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contractUpdate.mockResolvedValue({ id: "contract-1", status: "active" });
    mocks.allowanceDeleteMany.mockResolvedValue({ count: 1 });
    mocks.allowanceCreateMany.mockResolvedValue({ count: 1 });
    mocks.workItemUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("marks the contract active and replaces allowance rows", async () => {
    await activateAiProviderContract({
      contractId: "contract-1",
      accountableEmployeeId: "emp-1",
      currency: "USD",
      monthlyCommittedAmount: 500,
      billingCadence: "monthly",
      allowances: [
        {
          allowanceName: "Tokens",
          usageUnit: "tokens",
          includedQuantity: 1000000,
        },
      ],
    });

    expect(mocks.contractUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1" },
        data: expect.objectContaining({
          status: "active",
          accountableEmployeeId: "emp-1",
        }),
      }),
    );
    expect(mocks.allowanceDeleteMany).toHaveBeenCalledWith({ where: { contractId: "contract-1" } });
    expect(mocks.allowanceCreateMany).toHaveBeenCalled();
  });
});

describe("evaluateAiProviderUtilization", () => {
  it("flags likely wasted commitment when usage is tracking behind plan", () => {
    const result = evaluateAiProviderUtilization({
      includedQuantity: 1000,
      consumedQuantity: 100,
      monthlyCommittedAmount: 500,
      dayOfMonth: 20,
      daysInMonth: 30,
    });

    expect(result.utilizationPct).toBeCloseTo(10);
    expect(result.projectedUnusedValue).toBeGreaterThan(0);
    expect(result.flags).toContain("underused_commitment");
  });
});

describe("generateDraftBillForAiContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.billFindFirst.mockResolvedValue(null);
    mocks.billCreate.mockResolvedValue({ id: "bill-1", billRef: "BILL-2026-0001" });
    mocks.billLineItemCreateMany.mockResolvedValue({ count: 1 });
  });

  it("creates a draft bill for the monthly commitment when one does not already exist", async () => {
    const result = await generateDraftBillForAiContract({
      contract: {
        id: "contract-1",
        contractId: "AIC-1",
        supplierId: "supplier-row-1",
        currency: "USD",
        monthlyCommittedAmount: 500,
        billingCadence: "monthly",
      },
      cycleDate: new Date("2026-04-24T00:00:00.000Z"),
    });

    expect(mocks.billCreate).toHaveBeenCalled();
    expect(mocks.billLineItemCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            description: "AI provider monthly commitment",
          }),
        ]),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: "bill-1" }));
  });
});
