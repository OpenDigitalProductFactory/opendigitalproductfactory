// packages/db/src/neo4j-schema.ts
// Creates constraints and indexes for the DPF graph schema.
// Safe to re-run — all statements use IF NOT EXISTS.
//
// Node labels:
//   DigitalProduct  — mirrors Prisma DigitalProduct (keyed on productId)
//   TaxonomyNode    — mirrors Prisma TaxonomyNode   (keyed on nodeId)
//   Portfolio       — mirrors Prisma Portfolio       (keyed on slug)
//   InfraCI         — infrastructure configuration item (no Prisma mirror yet)
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

const SCHEMA_STATEMENTS = [
  // ── Uniqueness constraints (also create backing index) ────────────────────
  "CREATE CONSTRAINT dp_productId IF NOT EXISTS FOR (n:DigitalProduct) REQUIRE n.productId IS UNIQUE",
  "CREATE CONSTRAINT tn_nodeId    IF NOT EXISTS FOR (n:TaxonomyNode)    REQUIRE n.nodeId    IS UNIQUE",
  "CREATE CONSTRAINT p_slug       IF NOT EXISTS FOR (n:Portfolio)        REQUIRE n.slug      IS UNIQUE",
  "CREATE CONSTRAINT ci_ciId      IF NOT EXISTS FOR (n:InfraCI)          REQUIRE n.ciId      IS UNIQUE",

  // ── Existence constraints (enterprise only — skip on community) ───────────
  // Community Neo4j does not support property existence constraints; omitted.

  // ── Additional indexes ────────────────────────────────────────────────────
  "CREATE INDEX dp_name  IF NOT EXISTS FOR (n:DigitalProduct) ON (n.name)",
  "CREATE INDEX dp_stage IF NOT EXISTS FOR (n:DigitalProduct) ON (n.lifecycleStage)",
  "CREATE INDEX tn_name  IF NOT EXISTS FOR (n:TaxonomyNode)   ON (n.name)",
  "CREATE INDEX ci_type  IF NOT EXISTS FOR (n:InfraCI)        ON (n.ciType)",
  "CREATE INDEX ci_status IF NOT EXISTS FOR (n:InfraCI)       ON (n.status)",
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
  console.log("Neo4j schema ready.");
}
