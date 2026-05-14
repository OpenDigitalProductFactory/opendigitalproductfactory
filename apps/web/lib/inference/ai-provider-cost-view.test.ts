import { describe, expect, it } from "vitest";
import type { ProviderRow, SpendByProvider } from "./ai-provider-types";
import {
  buildProviderCostView,
  getProviderDisplayNameForSpend,
  type ProviderFinanceSource,
} from "./ai-provider-cost-view";

function provider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "provider-row",
    providerId: "openai",
    name: "OpenAI",
    families: [],
    enabledFamilies: [],
    status: "active",
    costModel: "token",
    category: "direct",
    baseUrl: null,
    authMethod: "api_key",
    supportedAuthMethods: ["api_key"],
    authHeader: null,
    endpoint: null,
    inputPricePerMToken: null,
    outputPricePerMToken: null,
    computeWatts: null,
    electricityRateKwh: null,
    docsUrl: null,
    consoleUrl: null,
    billingLabel: null,
    costPerformanceNotes: null,
    endpointType: "llm",
    serviceKind: null,
    sensitivityClearance: [],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: [],
    mcpTransport: null,
    maxConcurrency: null,
    reasoning: 50,
    codegen: 50,
    toolFidelity: 50,
    instructionFollowing: 50,
    structuredOutput: 50,
    conversational: 50,
    contextRetention: 50,
    authorizeUrl: null,
    tokenUrl: null,
    oauthClientId: null,
    oauthRedirectUri: null,
    ...overrides,
  };
}

function finance(overrides: Partial<ProviderFinanceSource> = {}): ProviderFinanceSource {
  return {
    status: "seeded",
    billingUrl: null,
    usageUrl: null,
    supplier: null,
    supplierContracts: [],
    ...overrides,
  };
}

describe("buildProviderCostView", () => {
  it("keeps routing cost band separate from external billing", () => {
    const view = buildProviderCostView({
      provider: provider({ costBand: "economy" }),
      financeProfile: null,
      internalUsage: null,
    });

    expect(view.routingCostBand.value).toBe("economy");
    expect(view.routingCostBand.provenance.sourceTable).toBe("ModelProvider.costBand");
    expect(view.externalProviderBilling.value).toBe("Not connected");
    expect(view.externalProviderBilling.provenance.kind).toBe("not-connected");
  });

  it("treats seeded finance profiles as configuration, not billing evidence", () => {
    const view = buildProviderCostView({
      provider: provider(),
      financeProfile: finance({ status: "seeded" }),
      internalUsage: null,
    });

    expect(view.configuredBillingProfile.value).toBe("Seeded finance profile");
    expect(view.configuredBillingProfile.provenance.kind).toBe("seed-default");
    expect(view.externalProviderBilling.value).toBe("Not connected");
  });

  it("classifies provider usage snapshots as connected external billing", () => {
    const view = buildProviderCostView({
      provider: provider(),
      financeProfile: finance({
        status: "active",
        supplier: { name: "OpenAI LLC" },
        supplierContracts: [
          {
            status: "active",
            usageSnapshots: [{ sourceType: "provider_api", snapshotDate: new Date("2026-05-01T00:00:00Z") }],
          },
        ],
      }),
      internalUsage: null,
    });

    expect(view.externalProviderBilling.value).toBe("Provider billing snapshot");
    expect(view.externalProviderBilling.provenance.kind).toBe("connected-account");
    expect(view.externalProviderBilling.provenance.sourceTable).toBe("ContractUsageSnapshot");
  });

  it("marks internal token usage as DPF live DB data", () => {
    const usage: SpendByProvider = {
      providerId: "openai",
      providerName: "OpenAI",
      totalInputTokens: 1200,
      totalOutputTokens: 800,
      totalCostUsd: 0.42,
      provenance: {
        kind: "live-db",
        label: "TokenUsage",
        sourceTable: "TokenUsage",
        description: "DPF recorded token usage for this provider.",
      },
    };

    const view = buildProviderCostView({
      provider: provider(),
      financeProfile: null,
      internalUsage: usage,
    });

    expect(view.internalTokenUsage.value).toBe("$0.42 internal token usage");
    expect(view.internalTokenUsage.provenance.sourceTable).toBe("TokenUsage");
  });
});

describe("getProviderDisplayNameForSpend", () => {
  it("labels blank or unknown provider usage as Unknown provider", () => {
    const names = new Map([["openai", "OpenAI"]]);

    expect(getProviderDisplayNameForSpend("", names)).toBe("Unknown provider");
    expect(getProviderDisplayNameForSpend("missing", names)).toBe("Unknown provider (missing)");
    expect(getProviderDisplayNameForSpend("openai", names)).toBe("OpenAI");
  });
});
