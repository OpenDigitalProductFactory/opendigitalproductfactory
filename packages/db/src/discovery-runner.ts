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
import { loadDiscoveryAttributionInputs } from "./discovery-attribution-inputs";
import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import { promoteInventoryEntities } from "./discovery-promotion";
import { reconcilePromotedProducts } from "./discovery-reconcile";
import {
  inferCrossCollectorRelationships,
  inferProductDependencies,
} from "./discovery-inference";
import { runConnectionCollectors, type DecryptFn } from "./discovery-runners/connection-collectors";
import { prisma } from "./client";
import type { CollectorOutput, DiscoveryCollector } from "./discovery-types";
import { INVENTORY_ENTITY_CANONICAL_WHERE } from "./inventory-entity-lifecycle";

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

/**
 * Yield the Node event loop so pending I/O (HTTP accept, timer callbacks) can
 * run before the next CPU-bound pass. Used between major discovery phases so a
 * long sweep cannot monopolise the event loop and starve HTTP serving.
 * setImmediate fires after I/O callbacks but before timers — cooperative yield
 * within a long synchronous-heavy pipeline (BI-9F106818 Phase 0).
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function executeBootstrapDiscovery(
  db: BootstrapDiscoveryDb,
  options: BootstrapExecutionOptions = {},
) {
  const rawStaticOutput = await runBootstrapCollectors(options.collectors);

  // Run connection-based collectors (UniFi, etc.) loaded from the DB.
  // Uses the global prisma client (not the db/tx param which may lack discoveryConnection).
  let connectionOutput: CollectorOutput = { items: [], relationships: [] };
  if (options.decrypt) {
    try {
      connectionOutput = await runConnectionCollectors(
        prisma as never,
        options.decrypt,
      );
    } catch (err) {
      console.error("[discovery] Connection collectors failed (non-fatal):", err);
    }
  }

  const rawCollected = mergeCollectorOutputs([rawStaticOutput, connectionOutput]);

  // Yield before CPU-bound inference/normalization passes so HTTP handling
  // can proceed between phases (BI-9F106818 Phase 0).
  await yieldToEventLoop();

  // Pass 1: Cross-collector relationship inference (host↔interfaces, target↔container)
  const collected = inferCrossCollectorRelationships(rawCollected);

  await yieldToEventLoop();

  // Load the taxonomy tree + active fingerprint rules the normalizer needs to
  // identify + place a device. Shared with the edge-node and portal-connection
  // ingestion paths via loadDiscoveryAttributionInputs so all three normalize
  // from the same inputs (BI-BAF38ED3). Explicit options still win as overrides
  // (test injection / callers that already hold the data).
  const { taxonomyNodes, fingerprintRules } = await loadDiscoveryAttributionInputs(db, {
    ...(options.taxonomyNodes ? { taxonomyNodes: options.taxonomyNodes } : {}),
    ...(options.fingerprintRules ? { fingerprintRules: options.fingerprintRules } : {}),
  });

  const normalized = (options.normalize ?? normalizeDiscoveredFacts)(collected, {
    ...(taxonomyNodes ? { taxonomyNodes } : {}),
    ...(fingerprintRules ? { fingerprintRules } : {}),
    ...(options.softwareIdentities ? { softwareIdentities: options.softwareIdentities } : {}),
    ...(options.softwareRules ? { softwareRules: options.softwareRules } : {}),
  });

  const persistenceSummary = await (options.persist ?? persistBootstrapDiscoveryRun)(db, normalized, {
    runKey: options.runKey ?? `DISC-${Date.now()}`,
    sourceSlug: options.sourceSlug ?? "dpf_bootstrap",
    trigger: options.trigger ?? "bootstrap",
  });

  // Yield between every major pass (BI-9F106818 Phase 0): these passes are
  // CPU-bound or fire many small DB/Neo4j awaits without naturally yielding
  // between iterations, so a long sweep can starve the HTTP event loop.
  // yieldToEventLoop() (setImmediate) lets pending HTTP accepts and timer
  // callbacks run before we start the next pass.

  await yieldToEventLoop();

  // Auto-promote high-confidence entities to DigitalProduct records
  try {
    const promotionSummary = await promoteInventoryEntities(db as never);
    if (promotionSummary.promoted > 0) {
      console.log(`[discovery] Auto-promoted ${promotionSummary.promoted} entities to DigitalProducts`);
    }
  } catch (err) {
    console.error("[discovery] Promotion pass failed (non-fatal):", err);
  }

  await yieldToEventLoop();

  // Reconcile: demote any previously-promoted infrastructure (host / NIC /
  // subnet / gateway) that the structural type-gate now rejects, so the
  // portfolio self-heals from earlier over-promotion instead of accumulating
  // network noise. Idempotent and conservative (entityType-based).
  try {
    const reconcileSummary = await reconcilePromotedProducts(db as never);
    if (reconcileSummary.demoted > 0) {
      console.log(
        `[discovery] Reconciled portfolio: demoted ${reconcileSummary.demoted} infrastructure products, kept ${reconcileSummary.detachedEntities} inventory rows`,
      );
    }
  } catch (err) {
    console.error("[discovery] Reconcile pass failed (non-fatal):", err);
  }

  await yieldToEventLoop();

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

  await yieldToEventLoop();

  // Flag gateways that have no discovery connection configured
  try {
    await flagUnconfiguredGateways(prisma as never);
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
      where: {
        ...INVENTORY_ENTITY_CANONICAL_WHERE,
        entityType: { in: ["gateway", "router"] },
        status: "active",
      },
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
