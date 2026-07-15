// packages/db/src/neo4j-schema.ts
// Graph-schema bootstrap. Formerly created Neo4j constraints/indexes; the graph now
// lives in Postgres (graph_node / graph_edge, created by the BET-5 migration), so
// there is no schema to create at runtime. The OSI-layer default backfill is retained
// as a pure data step over the Postgres mirror. Export names are unchanged so the
// init script and barrel keep working across the cutover.
//
// Node labels (graph_node.labels) and relationship types (graph_edge.rel_type) mirror
// the former Neo4j model 1:1 — see graph-sync.ts / pg-graph.ts for the write & read sides.

import { prisma } from "./client";

/** Network topology relationship types (OSI-aware multi-layer graph). */
export const NETWORK_RELATIONSHIP_TYPES = [
  "RUNS_ON",          // L7 → L3/L4
  "LISTENS_ON",       // L7 → L4
  "HOSTS",            // L3 → L4/L7
  "MEMBER_OF",        // L3 → L2
  "ROUTES_THROUGH",   // L3 → L3
  "CARRIED_BY",       // L2 → L1
  "CONNECTS_TO",      // L1 → L1
  "PEER_OF",          // L2 → L2 (LLDP/CDP)
] as const;

export async function initNeo4jSchema(): Promise<void> {
  // Graph schema (graph_node/graph_edge + their indexes) is created by the Prisma
  // migration, so there are no constraints/indexes to create here. Retain only the
  // osiLayer default backfill, which is data, not schema.
  await backfillOsiLayers();
  console.log("Graph schema ready (Postgres-managed).");
}

/**
 * Backfill osiLayer on existing InfraCI nodes that don't have one yet.
 * Maps ciType → default OSI layer. Safe to re-run — only touches nodes
 * whose osiLayer is absent or null.
 */
export async function backfillOsiLayers(): Promise<void> {
  const mapping: Array<{ ciTypes: string[]; layer: number; layerName: string }> = [
    { ciTypes: ["server", "host", "network", "subnet", "gateway", "network_interface", "docker_host", "router", "network_client", "network_device"], layer: 3, layerName: "network" },
    { ciTypes: ["switch", "access_point", "vlan"], layer: 2, layerName: "data_link" },
    { ciTypes: ["container", "service", "database", "runtime", "ai-inference"], layer: 7, layerName: "application" },
  ];
  for (const { ciTypes, layer, layerName } of mapping) {
    try {
      const rows = (await prisma.$queryRawUnsafe(
        `UPDATE graph_node
            SET props = props || jsonb_build_object('osiLayer', $1::int, 'osiLayerName', $2::text)
          WHERE 'InfraCI' = ANY(labels)
            AND (NOT (props ? 'osiLayer') OR props->>'osiLayer' IS NULL)
            AND props->>'ciType' = ANY($3)
        RETURNING key`,
        layer,
        layerName,
        ciTypes,
      )) as Array<{ key: string }>;
      if (rows.length > 0) {
        console.log(`  backfill: set osiLayer=${layer} on ${rows.length} InfraCI nodes (${ciTypes.join(", ")})`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ⚠ backfill osiLayer=${layer} failed:`, msg.slice(0, 120));
    }
  }
}
