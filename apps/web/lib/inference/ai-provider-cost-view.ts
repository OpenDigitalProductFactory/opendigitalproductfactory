import type { DataSourceProvenance } from "@/lib/surface-data-provenance";
import type { ProviderRow, SpendByProvider } from "./ai-provider-types";
import { getBillingLabel } from "./ai-provider-types";

export type ProviderFinanceSource = {
  status: string;
  billingUrl: string | null;
  usageUrl: string | null;
  supplier: { name: string } | null;
  supplierContracts: Array<{
    status: string;
    usageSnapshots: Array<{
      sourceType: string;
      snapshotDate: Date | string;
    }>;
  }>;
};

export type ProviderCostMetric = {
  label: string;
  value: string;
  provenance: DataSourceProvenance;
  actionHref?: string;
};

export type ProviderCostView = {
  routingCostBand: ProviderCostMetric;
  catalogPricing: ProviderCostMetric;
  configuredBillingProfile: ProviderCostMetric;
  internalTokenUsage: ProviderCostMetric;
  externalProviderBilling: ProviderCostMetric;
};

const TOKEN_USAGE_PROVENANCE: DataSourceProvenance = {
  kind: "live-db",
  label: "TokenUsage",
  sourceTable: "TokenUsage",
  description: "DPF recorded token usage for this provider.",
};

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function latestUsageSnapshot(profile: ProviderFinanceSource | null) {
  return profile?.supplierContracts
    .flatMap((contract) => contract.usageSnapshots)
    .sort((a, b) => new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime())[0] ?? null;
}

export function getProviderDisplayNameForSpend(providerId: string, providerNames: Map<string, string>): string {
  const normalized = providerId.trim();
  if (!normalized) return "Unknown provider";
  return providerNames.get(normalized) ?? `Unknown provider (${normalized})`;
}

export function buildProviderCostView(input: {
  provider: ProviderRow;
  financeProfile: ProviderFinanceSource | null;
  internalUsage: SpendByProvider | null;
}): ProviderCostView {
  const { provider, financeProfile, internalUsage } = input;
  const catalogLabel = getBillingLabel(provider) ?? "No catalog pricing";
  const snapshot = latestUsageSnapshot(financeProfile);

  const configuredProfile: ProviderCostMetric = financeProfile
    ? {
        label: "Configured billing profile",
        value: financeProfile.status === "seeded" ? "Seeded finance profile" : financeProfile.status.replace(/_/g, " "),
        provenance: {
          kind: financeProfile.status === "seeded" ? "seed-default" : "live-db",
          label: financeProfile.status === "seeded" ? "Seeded finance profile" : "Configured billing profile",
          sourceTable: "AiProviderFinanceProfile",
          description: "Finance configuration exists for this provider, but it is not the same as external account billing.",
        },
        actionHref: `/finance/spend/ai`,
      }
    : {
        label: "Configured billing profile",
        value: "Not configured",
        provenance: {
          kind: "not-connected",
          label: "Not configured",
          sourceTable: "AiProviderFinanceProfile",
          description: "No finance profile is configured for this provider.",
        },
        actionHref: `/finance/spend/ai`,
      };

  return {
    routingCostBand: {
      label: "Routing cost band",
      value: provider.costBand || "unspecified",
      provenance: {
        kind: "live-db",
        label: "Routing metadata",
        sourceTable: "ModelProvider.costBand",
        description: "Routing cost band used by DPF selection logic. This is not external account billing.",
      },
    },
    catalogPricing: {
      label: "Provider catalog",
      value: catalogLabel,
      provenance: {
        kind: provider.billingLabel || provider.inputPricePerMToken != null || provider.outputPricePerMToken != null ? "catalog" : "not-connected",
        label: provider.billingLabel ? "Provider catalog" : "No catalog pricing",
        sourceTable: "ModelProvider",
        description: "Pricing metadata from the provider catalog or local provider configuration.",
      },
    },
    configuredBillingProfile: configuredProfile,
    internalTokenUsage: {
      label: "Internal token usage",
      value: `${formatUsd(internalUsage?.totalCostUsd ?? 0)} internal token usage`,
      provenance: internalUsage?.provenance ?? TOKEN_USAGE_PROVENANCE,
    },
    externalProviderBilling: snapshot
      ? {
          label: "External provider billing",
          value: "Provider billing snapshot",
          provenance: {
            kind: snapshot.sourceType === "provider_api" || snapshot.sourceType === "provider_portal" ? "connected-account" : "live-db",
            label: "Provider billing snapshot",
            sourceTable: "ContractUsageSnapshot",
            description: "A finance usage snapshot exists for this provider account.",
            lastVerifiedAt: new Date(snapshot.snapshotDate).toISOString(),
          },
          actionHref: financeProfile?.usageUrl ?? financeProfile?.billingUrl ?? "/finance/spend/ai",
        }
      : {
          label: "External provider billing",
          value: "Not connected",
          provenance: {
            kind: "not-connected",
            label: "Not connected",
            sourceTable: "ContractUsageSnapshot",
            description: "No reconciled provider billing snapshot is connected for this provider.",
          },
          actionHref: financeProfile?.usageUrl ?? financeProfile?.billingUrl ?? "/finance/spend/ai",
        },
  };
}
