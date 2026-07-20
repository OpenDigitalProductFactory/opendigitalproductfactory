export const FOUNDER_CLUSTER_STATUSES = ["proposed", "accepted", "rejected", "archived"] as const;
export type FounderClusterStatus = (typeof FOUNDER_CLUSTER_STATUSES)[number];

export const FOUNDER_DEMAND_ENVIRONMENTS = ["production", "development", "test"] as const;
export type FounderDemandEnvironment = (typeof FOUNDER_DEMAND_ENVIRONMENTS)[number];

export interface FounderDemandRouteInput {
  originInstallationId: string;
  envelopeId: string;
  mirrorId: string;
  environmentClass: FounderDemandEnvironment;
  routeAttestations: unknown[];
}

export interface FounderDemandOrigin {
  originKey: string;
  originInstallationId: string;
  envelopeId: string;
  environmentClass: FounderDemandEnvironment;
  mirrorRefs: string[];
  routeAttestations: unknown[];
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableValue(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function mergeFounderDemandRoutes(routes: FounderDemandRouteInput[]): FounderDemandOrigin[] {
  const byOrigin = new Map<string, FounderDemandOrigin>();
  for (const route of routes) {
    const originKey = `${route.originInstallationId}:${route.envelopeId}`;
    const current = byOrigin.get(originKey) ?? {
      originKey,
      originInstallationId: route.originInstallationId,
      envelopeId: route.envelopeId,
      environmentClass: route.environmentClass,
      mirrorRefs: [],
      routeAttestations: [],
    };
    if (!current.mirrorRefs.includes(route.mirrorId)) current.mirrorRefs.push(route.mirrorId);
    const existingAttestations = new Set(current.routeAttestations.map(stableValue));
    for (const attestation of route.routeAttestations) {
      const fingerprint = stableValue(attestation);
      if (!existingAttestations.has(fingerprint)) {
        current.routeAttestations.push(attestation);
        existingAttestations.add(fingerprint);
      }
    }
    if (route.environmentClass !== "production") current.environmentClass = route.environmentClass;
    byOrigin.set(originKey, current);
  }
  return [...byOrigin.values()];
}

export function canEnterFounderProductionPortfolio(
  environmentClass: FounderDemandEnvironment,
  promotedAt: Date | null,
): boolean {
  return environmentClass === "production" || promotedAt !== null;
}

export function resolveFounderDemandEnvironment(value: unknown): FounderDemandEnvironment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "development";
  const metadata = value as Record<string, unknown>;
  const nested = metadata.federation && typeof metadata.federation === "object" && !Array.isArray(metadata.federation)
    ? metadata.federation as Record<string, unknown>
    : null;
  const candidate = metadata.environmentClass ?? nested?.environmentClass;
  return (FOUNDER_DEMAND_ENVIRONMENTS as readonly unknown[]).includes(candidate)
    ? candidate as FounderDemandEnvironment
    : "development";
}

export function buildFounderClusterSummary(input: {
  status: FounderClusterStatus;
  canonicalBacklogItemId: string | null;
  members: Array<FounderDemandOrigin & { promotedAt?: Date | null }>;
}) {
  return {
    status: input.status,
    distinctOriginReach: input.members.length,
    routeCount: input.members.reduce((sum, member) => sum + member.mirrorRefs.length, 0),
    productionEligibleOrigins: input.members.filter((member) =>
      canEnterFounderProductionPortfolio(member.environmentClass, member.promotedAt ?? null),
    ).length,
    canonicalBacklogItemId: input.canonicalBacklogItemId,
  };
}
