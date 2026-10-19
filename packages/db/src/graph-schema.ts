// packages/db/src/graph-schema.ts
// Relationship vocabulary of the Postgres graph mirror (graph_node / graph_edge).
// The tables and their indexes are created by Prisma migrations, so there is no
// runtime schema step. Node labels live in graph_node.labels and relationship
// types in graph_edge.rel_type; graph-sync.ts writes them and pg-graph.ts reads them.

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
