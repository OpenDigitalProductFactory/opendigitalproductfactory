import {
  collectDockerDiscovery,
  collectHostDiscovery,
  collectKubernetesDiscovery,
  collectNetworkDiscovery,
  collectPrometheusDiscovery,
} from "./discovery-collectors";
import {
  normalizeDiscoveredFacts,
  type NormalizeDiscoveryOptions,
} from "./discovery-normalize";
import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import { promoteInventoryEntities } from "./discovery-promotion";
import {
  inferCrossCollectorRelationships,
  inferProductDependencies,
} from "./discovery-inference";
import { runConnectionCollectors, type ConnectionLoaderDb, type DecryptFn } from "./discovery-runners/connection-collectors";
import type { CollectorOutput, DiscoveryCollector } from "./discovery-types";

type BootstrapDiscoveryDb = Parameters<typeof persistBootstrapDiscoveryRun>[0];

type BootstrapExecutionOptions = NormalizeDiscoveryOptions & {
  collectors?: DiscoveryCollector[];
  normalize?: typeof normalizeDiscoveredFacts;
  persist?: typeof persistBootstrapDiscoveryRun;
  runKey?: string;
  sourceSlug?: string;
  trigger?: string;
  /** Credential decryption function. If provided, enables connection-based collectors. */
  decrypt?: DecryptFn;
};

export function mergeCollectorOutputs(outputs: CollectorOutput[]): CollectorOutput {
  return outputs.reduce<CollectorOutput>(
    (merged, output) => {
      merged.items.push(...output.items);
      merged.relationships.push(...output.relationships);
      merged.software?.push(...(output.software ?? []));
      merged.warnings?.push(...(output.warnings ?? []));
      return merged;
    },
    { items: [], relationships: [], software: [], warnings: [] },
  );
}

export async function runLocalDiscoveryCollectors(
  collectors: DiscoveryCollector[] = [
    collectHostDiscovery,
    collectDockerDiscovery,
    collectKubernetesDiscovery,
    collectPrometheusDiscovery,
    collectNetworkDiscovery,
  ],
): Promise<CollectorOutput> {
  const outputs = await Promise.all(
    collectors.map((collector) => collector({ sourceKind: "dpf_bootstrap" })),
  );
  return mergeCollectorOutputs(outputs);
}

export async function runBootstrapCollectors(
  collectors?: DiscoveryCollector[],
): Promise<CollectorOutput> {
  return runLocalDiscoveryCollectors(collectors);
}

export async function executeBootstrapDiscovery(
  db: BootstrapDiscoveryDb,
  options: BootstrapExecutionOptions = {},
) {
  const rawStaticOutput = await runBootstrapCollectors(options.collectors);

  // Run connection-based collectors (UniFi, etc.) loaded from the DB
  let connectionOutput: CollectorOutput = { items: [], relationships: [] };
  if (options.decrypt) {
    try {
      connectionOutput = await runConnectionCollectors(
        db as unknown as ConnectionLoaderDb,
        options.decrypt,
      );
    } catch (err) {
      console.error("[discovery] Connection collectors failed (non-fatal):", err);
    }
  }

  const rawCollected = mergeCollectorOutputs([rawStaticOutput, connectionOutput]);

  // Pass 1: Cross-collector relationship inference (host↔interfaces, target↔container)
  const collected = inferCrossCollectorRelationships(rawCollected);

  const taxonomyNodes = options.taxonomyNodes
    ?? (typeof (db as { taxonomyNode?: { findMany?: unknown } }).taxonomyNode?.findMany === "function"
      ? await ((db as unknown) as {
          taxonomyNode: {
            findMany(args: {
              select: { nodeId: true; name: true };
            }): Promise<Array<{ nodeId: string; name: string }>>;
          };
        }).taxonomyNode.findMany({
          select: { nodeId: true, name: true },
        })
      : undefined);
  const normalized = (options.normalize ?? normalizeDiscoveredFacts)(collected, {
    ...(taxonomyNodes ? { taxonomyNodes } : {}),
    ...(options.softwareIdentities ? { softwareIdentities: options.softwareIdentities } : {}),
    ...(options.softwareRules ? { softwareRules: options.softwareRules } : {}),
  });

  const persistenceSummary = await (options.persist ?? persistBootstrapDiscoveryRun)(db, normalized, {
    runKey: options.runKey ?? `DISC-${Date.now()}`,
    sourceSlug: options.sourceSlug ?? "dpf_bootstrap",
    trigger: options.trigger ?? "bootstrap",
  });

  // Auto-promote high-confidence entities to DigitalProduct records
  try {
    const promotionSummary = await promoteInventoryEntities(db as never);
    if (promotionSummary.promoted > 0) {
      console.log(`[discovery] Auto-promoted ${promotionSummary.promoted} entities to DigitalProducts`);
    }
  } catch (err) {
    console.error("[discovery] Promotion pass failed (non-fatal):", err);
  }

  // Pass 2 & 3: Product-to-infrastructure relationship inference
  try {
    const inferenceSummary = await inferProductDependencies(db as never);
    const total = inferenceSummary.productToInfraEdges + inferenceSummary.nameMatchEdges;
    if (total > 0) {
      console.log(
        `[discovery] Inferred ${total} product→infra edges (${inferenceSummary.productToInfraEdges} promoted, ${inferenceSummary.nameMatchEdges} name-matched)`,
      );
    }
  } catch (err) {
    console.error("[discovery] Product inference pass failed (non-fatal):", err);
  }

  // Flag gateways that have no discovery connection configured
  try {
    await flagUnconfiguredGateways(db as never);
  } catch (err) {
    console.error("[discovery] Gateway connection flagging failed (non-fatal):", err);
  }

  return persistenceSummary;
}

// ─── Gateway Connection Quality Issues ──────────────────────────────────────

type GatewayFlagDb = {
  inventoryEntity: {
    findMany(args: {
      where: { entityType: { in: string[] }; status: string };
      select: { id: true; entityKey: true; name: true; properties: true };
    }): Promise<Array<{
      id: string;
      entityKey: string;
      name: string;
      properties: unknown;
    }>>;
  };
  discoveryConnection: {
    findMany(args: {
      where: { status: { not: string } };
      select: { gatewayEntityId: true; endpointUrl: true };
    }): Promise<Array<{ gatewayEntityId: string | null; endpointUrl: string }>>;
  };
  portfolioQualityIssue: {
    upsert(args: {
      where: { issueKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    updateMany(args: {
      where: { issueType: string; issueKey: { notIn: string[] } };
      data: { status: string; resolvedAt: Date };
    }): Promise<{ count: number }>;
  };
};

async function flagUnconfiguredGateways(db: GatewayFlagDb): Promise<void> {
  let gateways: Awaited<ReturnType<GatewayFlagDb["inventoryEntity"]["findMany"]>>;
  try {
    gateways = await db.inventoryEntity.findMany({
      where: { entityType: { in: ["gateway", "router"] }, status: "active" },
      select: { id: true, entityKey: true, name: true, properties: true },
    });
  } catch {
    return; // table may not exist yet
  }

  if (gateways.length === 0) return;

  // Load all configured connections to check which gateways are covered
  let connections: Awaited<ReturnType<GatewayFlagDb["discoveryConnection"]["findMany"]>>;
  try {
    connections = await db.discoveryConnection.findMany({
      where: { status: { not: "deleted" } },
      select: { gatewayEntityId: true, endpointUrl: true },
    });
  } catch {
    connections = []; // table may not exist yet (pre-migration)
  }

  const coveredEntityIds = new Set(
    connections.map((c) => c.gatewayEntityId).filter(Boolean),
  );
  const coveredEndpoints = new Set(
    connections.map((c) => {
      try { return new URL(c.endpointUrl).hostname; } catch { return c.endpointUrl; }
    }),
  );

  const activeIssueKeys: string[] = [];

  for (const gw of gateways) {
    // Check if this gateway is covered by any connection (by entity ID or by IP match)
    if (coveredEntityIds.has(gw.id)) continue;
    const props = (gw.properties ?? {}) as Record<string, unknown>;
    const gwAddress = (props.address as string) ?? "";
    if (gwAddress && coveredEndpoints.has(gwAddress)) continue;

    const issueKey = `gateway_connection:${gw.entityKey}`;
    activeIssueKeys.push(issueKey);

    await db.portfolioQualityIssue.upsert({
      where: { issueKey },
      create: {
        issueKey,
        issueType: "gateway_connection_needed",
        status: "open",
        severity: "warn",
        summary: `Gateway "${gw.name}" can be enriched with network topology data. Configure a discovery connection to pull device, VLAN, and client information.`,
        details: { gatewayEntityId: gw.id, address: gwAddress },
        inventoryEntity: { connect: { id: gw.id } },
      },
      update: {
        status: "open",
        lastDetectedAt: new Date(),
        summary: `Gateway "${gw.name}" can be enriched with network topology data. Configure a discovery connection to pull device, VLAN, and client information.`,
        details: { gatewayEntityId: gw.id, address: gwAddress },
      },
    });
  }

  // Auto-resolve issues for gateways that now have connections
  try {
    const resolved = await db.portfolioQualityIssue.updateMany({
      where: {
        issueType: "gateway_connection_needed",
        issueKey: { notIn: activeIssueKeys },
      },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    if (resolved.count > 0) {
      console.log(`[discovery] Resolved ${resolved.count} gateway connection issue(s)`);
    }
  } catch { /* non-fatal */ }
}
