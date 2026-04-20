// packages/db/src/neo4j-schema.ts
// Creates constraints and indexes for the DPF graph schema.
// Safe to re-run — all statements use IF NOT EXISTS.
//
// Node labels:
//   DigitalProduct  — mirrors Prisma DigitalProduct (keyed on productId)
//   TaxonomyNode    — mirrors Prisma TaxonomyNode   (keyed on nodeId)
//   Portfolio       — mirrors Prisma Portfolio       (keyed on slug)
//   InfraCI         — infrastructure configuration item (no Prisma mirror yet)
//   CodeFile        — committed source-code file projection (keyed on codeFileKey)
//
// Relationship types:
//   BELONGS_TO      — DigitalProduct → Portfolio
//   CATEGORIZED_AS  — DigitalProduct → TaxonomyNode
//   CHILD_OF        — TaxonomyNode → TaxonomyNode (parent)
//   DEPENDS_ON      — DigitalProduct|InfraCI → InfraCI  (with role, since props)
//   PROVIDES_TO     — InfraCI → DigitalProduct
//
// IT4IT value-stream labels (on DigitalProduct nodes):
//   :S2P  Strategy to Portfolio  (ServiceCandidate / Portfolio)
//   :R2D  Requirement to Deploy  (ServiceRelease / BuildUnit)
//   :R2F  Request to Fulfill     (ServiceInstance / Subscription)
//   :D2C  Detect to Correct      (ServiceInstance under operational monitoring)

import { runCypher } from "./neo4j";

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

const SCHEMA_STATEMENTS = [
  // ── Uniqueness constraints (also create backing index) ────────────────────
  "CREATE CONSTRAINT dp_productId IF NOT EXISTS FOR (n:DigitalProduct) REQUIRE n.productId IS UNIQUE",
  "CREATE CONSTRAINT tn_nodeId    IF NOT EXISTS FOR (n:TaxonomyNode)    REQUIRE n.nodeId    IS UNIQUE",
  "CREATE CONSTRAINT p_slug       IF NOT EXISTS FOR (n:Portfolio)        REQUIRE n.slug      IS UNIQUE",
  "CREATE CONSTRAINT ci_ciId      IF NOT EXISTS FOR (n:InfraCI)          REQUIRE n.ciId      IS UNIQUE",
  "CREATE CONSTRAINT cf_codeFileKey IF NOT EXISTS FOR (n:CodeFile)       REQUIRE n.codeFileKey IS UNIQUE",

  // ── Existence constraints (enterprise only — skip on community) ───────────
  // Community Neo4j does not support property existence constraints; omitted.

  // ── Additional indexes ────────────────────────────────────────────────────
  "CREATE INDEX dp_name  IF NOT EXISTS FOR (n:DigitalProduct) ON (n.name)",
  "CREATE INDEX dp_stage IF NOT EXISTS FOR (n:DigitalProduct) ON (n.lifecycleStage)",
  "CREATE INDEX tn_name  IF NOT EXISTS FOR (n:TaxonomyNode)   ON (n.name)",
  "CREATE INDEX ci_type  IF NOT EXISTS FOR (n:InfraCI)        ON (n.ciType)",
  "CREATE INDEX ci_status IF NOT EXISTS FOR (n:InfraCI)       ON (n.status)",
  "CREATE INDEX cf_graphKey IF NOT EXISTS FOR (n:CodeFile)    ON (n.graphKey)",
  "CREATE INDEX cf_path     IF NOT EXISTS FOR (n:CodeFile)    ON (n.path)",

  // OSI-aware topology indexes
  "CREATE INDEX ci_osi_layer       IF NOT EXISTS FOR (n:InfraCI) ON (n.osiLayer)",
  "CREATE INDEX ci_network_address IF NOT EXISTS FOR (n:InfraCI) ON (n.networkAddress)",
];

export async function initNeo4jSchema(): Promise<void> {
  console.log("Initialising Neo4j schema constraints and indexes…");
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await runCypher(stmt);
      console.log("  ✓", stmt.replace(/\s+/g, " ").slice(0, 80));
    } catch (err: unknown) {
      // Log but don't abort — a constraint that already exists in slightly
      // different form should not block startup.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("  ⚠ skipped:", msg.slice(0, 120));
    }
  }
  await backfillOsiLayers();
  console.log("Neo4j schema ready.");
}

/**
 * Backfill osiLayer on existing InfraCI nodes that don't have one yet.
 * Maps ciType → default OSI layer. Safe to re-run — only touches nodes
 * where osiLayer IS NULL.
 */
export async function backfillOsiLayers(): Promise<void> {
  const mapping: Array<{ ciTypes: string[]; layer: number; layerName: string }> = [
    { ciTypes: ["server", "host", "network", "subnet", "gateway", "network_interface", "docker_host", "router", "network_client", "network_device"], layer: 3, layerName: "network" },
    { ciTypes: ["switch", "access_point", "vlan"], layer: 2, layerName: "data_link" },
    { ciTypes: ["container", "service", "database", "runtime", "ai-inference"], layer: 7, layerName: "application" },
  ];
  for (const { ciTypes, layer, layerName } of mapping) {
    try {
      const result = await runCypher<{ updated: unknown }>(
        `MATCH (ci:InfraCI)
         WHERE ci.osiLayer IS NULL AND ci.ciType IN $ciTypes
         SET ci.osiLayer = $layer, ci.osiLayerName = $layerName
         RETURN count(ci) AS updated`,
        { ciTypes, layer, layerName },
      );
      const count = Number(result[0]?.updated ?? 0);
      if (count > 0) {
        console.log(`  backfill: set osiLayer=${layer} on ${count} InfraCI nodes (${ciTypes.join(", ")})`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ⚠ backfill osiLayer=${layer} failed:`, msg.slice(0, 120));
    }
  }
}
