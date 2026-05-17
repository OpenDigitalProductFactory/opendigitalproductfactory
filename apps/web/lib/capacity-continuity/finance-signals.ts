import { prisma } from "@dpf/db";
import { MODEL_ROUTING_ENDPOINT_TYPES } from "@/lib/routing/provider-eligibility";
import type {
  CapacityProviderClass,
  CapacityProviderFinanceSignal,
} from "./finance-routing";

type DecimalLike = {
  toString(): string;
};

type FinanceProfileRow = {
  providerId: string;
  provider: {
    providerId: string;
    status: string;
    costBand: string | null;
  };
  supplierContracts: Array<{
    monthlyCommittedAmount: DecimalLike | number | null;
    allowsOverage: boolean;
    allowances: Array<{
      includedQuantity: DecimalLike | number;
    }>;
    usageSnapshots: Array<{
      utilizationPct: number | null;
      projectedUnusedValue: DecimalLike | number | null;
      projectedOverageCost: DecimalLike | number | null;
    }>;
  }>;
};

export async function getCapacityProviderFinanceSignals(): Promise<CapacityProviderFinanceSignal[]> {
  const profiles = await prisma.aiProviderFinanceProfile.findMany({
    where: {
      provider: {
        endpointType: { in: [...MODEL_ROUTING_ENDPOINT_TYPES] },
      },
    },
    select: {
      providerId: true,
      provider: {
        select: {
          providerId: true,
          status: true,
          costBand: true,
        },
      },
      supplierContracts: {
        where: {
          status: { in: ["draft", "active"] },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          monthlyCommittedAmount: true,
          allowsOverage: true,
          allowances: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              includedQuantity: true,
            },
          },
          usageSnapshots: {
            orderBy: { snapshotDate: "desc" },
            take: 1,
            select: {
              utilizationPct: true,
              projectedUnusedValue: true,
              projectedOverageCost: true,
            },
          },
        },
      },
    },
  });

  return (profiles as FinanceProfileRow[]).map((profile) => {
    const contract = profile.supplierContracts[0];
    const snapshot = contract?.usageSnapshots[0];

    return {
      providerId: profile.providerId,
      providerClass: classifyProvider(profile, contract),
      status: normalizeStatus(profile.provider.status),
      utilizationPct: snapshot?.utilizationPct ?? null,
      projectedUnusedValue: toNumber(snapshot?.projectedUnusedValue) ?? 0,
      overageRisk: isOverageRisk(contract, snapshot),
    };
  });
}

function classifyProvider(
  profile: FinanceProfileRow,
  contract: FinanceProfileRow["supplierContracts"][number] | undefined,
): CapacityProviderClass {
  if (
    profile.provider.providerId === "local" ||
    profile.provider.providerId === "ollama" ||
    profile.provider.costBand === "free"
  ) {
    return "local";
  }

  if (toNumber(contract?.monthlyCommittedAmount) && toNumber(contract?.monthlyCommittedAmount)! > 0) {
    return "fixed-cost";
  }

  const allowance = contract?.allowances[0];
  if (toNumber(allowance?.includedQuantity) && toNumber(allowance?.includedQuantity)! > 0) {
    return "quota";
  }

  return "token-priced";
}

function isOverageRisk(
  contract: FinanceProfileRow["supplierContracts"][number] | undefined,
  snapshot: FinanceProfileRow["supplierContracts"][number]["usageSnapshots"][number] | undefined,
) {
  if ((toNumber(snapshot?.projectedOverageCost) ?? 0) > 0) {
    return true;
  }

  return contract?.allowsOverage === true && (snapshot?.utilizationPct ?? 0) >= 95;
}

function normalizeStatus(status: string): CapacityProviderFinanceSignal["status"] {
  if (status === "active" || status === "degraded" || status === "inactive") {
    return status;
  }

  return "inactive";
}

function toNumber(value: DecimalLike | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "number" ? value : Number(value.toString());
}
