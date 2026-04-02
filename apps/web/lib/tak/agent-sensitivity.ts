import type { ProviderPriorityEntry } from "@/lib/ai-provider-priority";

export type RouteSensitivity = "public" | "internal" | "confidential" | "restricted";

export type ProviderPolicyInfo = {
  providerId: string;
  costModel: string;
  category: string;
};

const ROUTE_SENSITIVITY: Array<{ prefix: string; sensitivity: RouteSensitivity }> = [
  { prefix: "/admin", sensitivity: "restricted" },
  { prefix: "/employee", sensitivity: "confidential" },
  { prefix: "/customer", sensitivity: "confidential" },
  { prefix: "/platform", sensitivity: "confidential" },
  { prefix: "/ea", sensitivity: "internal" },
  { prefix: "/ops", sensitivity: "internal" },
  { prefix: "/build", sensitivity: "internal" },
  { prefix: "/inventory", sensitivity: "internal" },
  { prefix: "/portfolio", sensitivity: "internal" },
  { prefix: "/workspace", sensitivity: "confidential" },
  { prefix: "/setup", sensitivity: "internal" },
];

function isLocalProvider(provider: ProviderPolicyInfo): boolean {
  return provider.providerId === "ollama" || provider.costModel === "compute";
}

const AGENT_SENSITIVITY: Record<string, RouteSensitivity> = {
  "AGT-190": "confidential",
};

export function getAgentSensitivity(agentId: string): RouteSensitivity | undefined {
  return AGENT_SENSITIVITY[agentId];
}

export function getRouteSensitivity(pathname: string): RouteSensitivity {
  let best: RouteSensitivity = "internal";
  let bestLen = 0;

  for (const entry of ROUTE_SENSITIVITY) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      if (entry.prefix.length > bestLen) {
        best = entry.sensitivity;
        bestLen = entry.prefix.length;
      }
    }
  }

  return best;
}

export function isProviderAllowedForSensitivity(
  sensitivity: RouteSensitivity,
  provider: ProviderPolicyInfo,
): boolean {
  if (sensitivity === "public") return true;
  if (sensitivity === "internal") return true;
  if (sensitivity === "confidential") return true;
  if (sensitivity === "restricted") return isLocalProvider(provider);
  return true;
}

export function filterProviderPriorityBySensitivity(
  priority: ProviderPriorityEntry[],
  providers: ProviderPolicyInfo[],
  sensitivity: RouteSensitivity,
): ProviderPriorityEntry[] {
  const providerMap = new Map(providers.map((provider) => [provider.providerId, provider]));

  return priority.filter((entry) => {
    const provider = providerMap.get(entry.providerId);
    if (!provider) return false;
    return isProviderAllowedForSensitivity(sensitivity, provider);
  });
}
