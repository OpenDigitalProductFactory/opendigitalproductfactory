import { INVENTORY_ENTITY_CANONICAL_WHERE, prisma } from "@dpf/db";

import { getFullGraphData } from "@/lib/actions/graph";
import {
  countStaleEntitiesSince,
  getInventoryEntitiesGroupedBySubnet,
  getInventoryTriageQueues,
  getLatestDiscoveryRun,
  getOpenPortfolioQualityIssues,
  summarizeDiscoveryHealth,
} from "@/lib/discovery-data";

/**
 * One read model for the browser renderer and Authorized Surface projector.
 * Keeping the query here prevents the coworker context from becoming a second,
 * stale description of what Estate Discovery actually renders.
 */
export async function getDiscoveryOperationsViewModel(
  options: { includeConnections?: boolean } = {},
) {
  const [
    products,
    latestRun,
    groupedInventory,
    triageQueues,
    openIssues,
    graphData,
    detectedGateways,
    connections,
  ] = await Promise.all([
    prisma.digitalProduct.findMany({
      orderBy: [{ portfolio: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        lifecycleStatus: true,
        portfolio: { select: { slug: true, name: true } },
        taxonomyNode: { select: { nodeId: true } },
      },
    }),
    getLatestDiscoveryRun(),
    getInventoryEntitiesGroupedBySubnet(),
    getInventoryTriageQueues(),
    getOpenPortfolioQualityIssues(),
    getFullGraphData(),
    prisma.inventoryEntity.findMany({
      where: {
        ...INVENTORY_ENTITY_CANONICAL_WHERE,
        entityType: "gateway",
        NOT: { name: { contains: "Docker" } },
      },
      select: { properties: true },
      take: 5,
    }),
    options.includeConnections
      ? prisma.discoveryConnection.findMany({ orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);

  const detectedGateway = detectedGateways
    .map((gateway) => (gateway.properties as Record<string, unknown>)?.address as string | undefined)
    .find((address) => address && !address.startsWith("172."))
    ?? null;
  const staleEntities = await countStaleEntitiesSince(latestRun?.startedAt ?? null);
  const health = summarizeDiscoveryHealth({
    totalEntities: groupedInventory.totalCount,
    staleEntities,
    openIssues: openIssues.length,
  });

  return {
    products,
    latestRun,
    groupedInventory,
    triageQueues,
    openIssues,
    graphData,
    detectedGateway,
    health,
    connections: connections.map((connection) => ({
      id: connection.id,
      connectionKey: connection.connectionKey,
      name: connection.name,
      collectorType: connection.collectorType,
      status: connection.status,
      endpointUrl: connection.endpointUrl,
      hasApiKey: !!connection.encryptedApiKey,
      configuration: (connection.configuration ?? {}) as Record<string, unknown>,
      lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
      lastTestStatus: connection.lastTestStatus,
      lastTestMessage: connection.lastTestMessage,
      gatewayEntityId: connection.gatewayEntityId,
    })),
  };
}

export type DiscoveryOperationsViewModel = Awaited<ReturnType<typeof getDiscoveryOperationsViewModel>>;
