// discovery-inference.ts
// Post-discovery relationship inference. Runs after persistence and promotion
// to auto-create edges that span different discovery sources or bridge
// DigitalProducts to their infrastructure.
//
// Three inference passes:
//  1. Cross-collector: Docker host HOSTS network interfaces on the same machine
//  2. Promoted entity: DigitalProduct DEPENDS_ON its InfraCI (via InventoryEntity.digitalProductId)
//  3. Name matching: DigitalProduct DEPENDS_ON containers/services matched by name

import type { CollectorOutput } from "./discovery-types";
import { syncDependsOn } from "./neo4j-sync";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InferenceDb = {
  inventoryEntity: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<{
      entityKey: string;
      entityType: string;
      name: string;
      digitalProductId: string | null;
      digitalProduct: { productId: string } | null;
    }>>;
  };
  digitalProduct: {
    findMany(args: {
      where?: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<{
      productId: string;
      name: string;
    }>>;
  };
};

export type InferenceSummary = {
  crossCollectorRelationships: number;
  productToInfraEdges: number;
  nameMatchEdges: number;
};

// ─── Pass 1: Cross-Collector Relationship Inference ─────────────────────────
// Runs on the merged CollectorOutput BEFORE normalization.
// Adds relationships between items from different collectors.

export function inferCrossCollectorRelationships(
  collected: CollectorOutput,
): CollectorOutput {
  const addedRelationships: CollectorOutput["relationships"] = [];

  // Find the docker_host item
  const dockerHost = collected.items.find((i) => i.itemType === "docker_host");

  // Find all network interfaces
  const networkInterfaces = collected.items.filter(
    (i) => i.itemType === "network_interface",
  );

  // Docker host HOSTS each network interface on the same machine
  if (dockerHost && networkInterfaces.length > 0) {
    for (const iface of networkInterfaces) {
      addedRelationships.push({
        sourceKind: "dpf_bootstrap",
        relationshipType: "HOSTS",
        fromExternalRef: dockerHost.externalRef,
        toExternalRef: iface.externalRef,
        confidence: 0.85,
        attributes: { inferred: true, rule: "docker_host_owns_interfaces" },
      });
    }
  }

  // Find the host item (from host collector) and link it to docker host
  const hostItem = collected.items.find(
    (i) => i.itemType === "host" && !i.externalRef?.startsWith("arp-host:"),
  );
  if (hostItem && dockerHost && hostItem.externalRef !== dockerHost.externalRef) {
    // The discovered OS host and Docker host are the same physical machine
    // but discovered by different collectors. Link them.
    addedRelationships.push({
      sourceKind: "dpf_bootstrap",
      relationshipType: "RUNS_ON",
      fromExternalRef: hostItem.externalRef,
      toExternalRef: dockerHost.externalRef,
      confidence: 0.90,
      attributes: { inferred: true, rule: "host_is_docker_host" },
    });
  }

  // Correlate Prometheus targets with Docker containers by instance hostname
  const promTargets = collected.items.filter(
    (i) => i.sourceKind === "prometheus" && i.itemType !== "monitoring_service",
  );
  const containers = collected.items.filter(
    (i) => i.sourceKind === "docker" && (i.itemType === "container" || i.itemType === "monitoring_service"),
  );

  if (promTargets.length > 0 && containers.length > 0) {
    for (const target of promTargets) {
      const instance = (target.attributes?.instance as string) ?? "";
      // Instance is usually "hostname:port" — extract hostname
      const instanceHost = instance.split(":")[0];
      if (!instanceHost) continue;

      // Match against container names (strip common prefixes)
      const matchedContainer = containers.find((c) => {
        const containerName = normalizeName(c.name);
        const targetHost = normalizeName(instanceHost);
        return containerName === targetHost
          || containerName.includes(targetHost)
          || targetHost.includes(containerName);
      });

      if (matchedContainer) {
        addedRelationships.push({
          sourceKind: "dpf_bootstrap",
          relationshipType: "RUNS_ON",
          fromExternalRef: target.externalRef,
          toExternalRef: matchedContainer.externalRef,
          confidence: 0.80,
          attributes: { inferred: true, rule: "prometheus_target_matches_container" },
        });
      }
    }
  }

  // Correlate UniFi router with network gateway by shared IP address
  const unifiRouter = collected.items.find(
    (i) => i.itemType === "router" && i.sourceKind === "unifi",
  );
  const networkGateway = collected.items.find(
    (i) => i.itemType === "gateway" && i.sourceKind === "network",
  );
  if (unifiRouter && networkGateway) {
    const routerAddr = unifiRouter.attributes?.address as string | undefined;
    const gwAddr = networkGateway.attributes?.address as string | undefined;
    if (routerAddr && gwAddr && routerAddr === gwAddr) {
      addedRelationships.push({
        sourceKind: "dpf_bootstrap",
        relationshipType: "PEER_OF",
        fromExternalRef: unifiRouter.externalRef,
        toExternalRef: networkGateway.externalRef,
        confidence: 0.95,
        attributes: { inferred: true, rule: "unifi_router_is_network_gateway" },
      });
    }
  }

  // Return enriched output
  return {
    ...collected,
    relationships: [...collected.relationships, ...addedRelationships],
  };
}

// ─── Pass 2 & 3: Product-to-Infrastructure Inference ────────────────────────
// Runs AFTER persistence and promotion. Queries the database for
// DigitalProducts and InventoryEntities, then creates Neo4j edges.

export async function inferProductDependencies(
  db: InferenceDb,
): Promise<InferenceSummary> {
  const summary: InferenceSummary = {
    crossCollectorRelationships: 0,
    productToInfraEdges: 0,
    nameMatchEdges: 0,
  };

  // ── Pass 2: Promoted entity linkage ────────────────────────────────
  // Every InventoryEntity with a digitalProductId should have a
  // DigitalProduct → InfraCI DEPENDS_ON edge in Neo4j.
  const linkedEntities = await db.inventoryEntity.findMany({
    where: {
      digitalProductId: { not: null },
    },
    select: {
      entityKey: true,
      entityType: true,
      name: true,
      digitalProductId: true,
      digitalProduct: { select: { productId: true } },
    },
  });

  const createdEdges = new Set<string>();

  for (const entity of linkedEntities) {
    if (!entity.digitalProduct?.productId) continue;
    const edgeKey = `${entity.digitalProduct.productId}->${entity.entityKey}`;
    if (createdEdges.has(edgeKey)) continue;
    createdEdges.add(edgeKey);

    try {
      await syncDependsOn({
        fromLabel: "DigitalProduct",
        fromId: entity.digitalProduct.productId,
        toLabel: "InfraCI",
        toId: entity.entityKey,
        role: entity.entityType,
      });
      summary.productToInfraEdges++;
    } catch (err) {
      console.warn(`[inference] Failed to link ${edgeKey}:`, err);
    }
  }

  // ── Pass 3: Name-based matching ────────────────────────────────────
  // For products NOT already linked via promotion, try to match by name
  // to containers, services, and databases.
  const allProducts = await db.digitalProduct.findMany({
    select: { productId: true, name: true },
  });

  const linkableEntities = await db.inventoryEntity.findMany({
    where: {
      entityType: {
        in: ["container", "database", "application", "ai_service", "monitoring_service", "runtime"],
      },
    },
    select: {
      entityKey: true,
      entityType: true,
      name: true,
      digitalProductId: true,
      digitalProduct: { select: { productId: true } },
    },
  });

  for (const product of allProducts) {
    const productNorm = normalizeName(product.name);
    if (!productNorm) continue;

    for (const entity of linkableEntities) {
      // Skip if already linked to this product via promotion
      if (entity.digitalProduct?.productId === product.productId) continue;

      const entityNorm = normalizeName(entity.name);
      if (!entityNorm) continue;

      const edgeKey = `${product.productId}->${entity.entityKey}`;
      if (createdEdges.has(edgeKey)) continue;

      // Match: product name contains entity name or entity name contains product name
      if (nameMatchScore(productNorm, entityNorm) >= 0.7) {
        createdEdges.add(edgeKey);
        try {
          await syncDependsOn({
            fromLabel: "DigitalProduct",
            fromId: product.productId,
            toLabel: "InfraCI",
            toId: entity.entityKey,
            role: entity.entityType,
          });
          summary.nameMatchEdges++;
        } catch (err) {
          console.warn(`[inference] Name-match link failed ${edgeKey}:`, err);
        }
      }
    }
  }

  return summary;
}

// ─── Name Matching Helpers ──────────────────────────────────────────────────

/** Normalize a name for fuzzy matching: lowercase, strip common prefixes/suffixes. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^dpf[-_\s]*/i, "")       // strip "dpf-" prefix
    .replace(/[-_\s]+/g, "")            // collapse separators
    .replace(/\(.*\)$/, "")             // strip trailing parenthetical
    .trim();
}

/**
 * Score how well two normalized names match (0.0 to 1.0).
 * - Exact match → 1.0
 * - One contains the other → 0.8
 * - Significant overlap → 0.7
 * - No match → 0.0
 */
function nameMatchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.8;

  // Check for word overlap: split both into segments and check intersection
  const aWords = new Set(a.match(/[a-z0-9]+/g) ?? []);
  const bWords = new Set(b.match(/[a-z0-9]+/g) ?? []);
  if (aWords.size === 0 || bWords.size === 0) return 0;

  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word) && word.length > 2) overlap++;
  }

  const minSize = Math.min(aWords.size, bWords.size);
  return minSize > 0 ? (overlap / minSize) * 0.8 : 0;
}
