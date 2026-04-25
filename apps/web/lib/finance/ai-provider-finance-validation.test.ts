import { describe, expect, it } from "vitest";
import {
  activateAiProviderContractSchema,
  createContractUsageSnapshotSchema,
  createFinanceWorkItemSchema,
  seedAiProviderFinanceBridgeSchema,
} from "./ai-provider-finance-validation";

describe("seedAiProviderFinanceBridgeSchema", () => {
  it("accepts a minimal provider seed payload", () => {
    const result = seedAiProviderFinanceBridgeSchema.safeParse({
      providerId: "openai",
      providerName: "OpenAI",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty provider id", () => {
    const result = seedAiProviderFinanceBridgeSchema.safeParse({
      providerId: "",
      providerName: "OpenAI",
    });

    expect(result.success).toBe(false);
  });
});

describe("activateAiProviderContractSchema", () => {
  it("accepts activation with allowance and ownership", () => {
    const result = activateAiProviderContractSchema.safeParse({
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

    expect(result.success).toBe(true);
  });

  it("rejects activation without allowances", () => {
    const result = activateAiProviderContractSchema.safeParse({
      contractId: "contract-1",
      accountableEmployeeId: "emp-1",
      currency: "USD",
      monthlyCommittedAmount: 500,
      billingCadence: "monthly",
      allowances: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("createContractUsageSnapshotSchema", () => {
  it("accepts a valid usage snapshot", () => {
    const result = createContractUsageSnapshotSchema.safeParse({
      contractId: "contract-1",
      snapshotDate: "2026-04-24",
      sourceType: "internal_observed",
      consumedQuantity: 250000,
      includedQuantity: 1000000,
    });

    expect(result.success).toBe(true);
  });
});

describe("createFinanceWorkItemSchema", () => {
  it("accepts a valid finance work item", () => {
    const result = createFinanceWorkItemSchema.safeParse({
      type: "plan_details_needed",
      title: "Add plan details for OpenAI",
      severity: "medium",
    });

    expect(result.success).toBe(true);
  });
});
