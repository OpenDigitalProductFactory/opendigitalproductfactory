import { prisma } from "@dpf/db";
import type { EndpointCandidate, SensitivityLevel } from "./agent-router-types";

/** Load all active MCP endpoints from the workforce registry. */
export async function loadEndpoints(): Promise<EndpointCandidate[]> {
  const providers = await prisma.modelProvider.findMany({
    where: { status: { in: ["active", "unconfigured"] } },
    select: {
      providerId: true,
      endpointType: true,
      sensitivityClearance: true,
      capabilityTier: true,
      costBand: true,
      taskTags: true,
      status: true,
    },
  });

  return providers
    .filter((p) => p.status === "active")
    .map((p) => ({
      endpointId: p.providerId,
      endpointType: (p.endpointType ?? "llm") as "llm" | "service",
      sensitivityClearance: (p.sensitivityClearance ?? []) as SensitivityLevel[],
      capabilityTier: (p.capabilityTier ?? "basic") as EndpointCandidate["capabilityTier"],
      costBand: (p.costBand ?? "free") as EndpointCandidate["costBand"],
      taskTags: p.taskTags ?? [],
      status: p.status,
    }));
}
