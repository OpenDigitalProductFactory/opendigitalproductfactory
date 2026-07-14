// BET-5 (BI-A1E864A5): graph traversals now run on Postgres (graph_node/graph_edge) via pg-graph.
// Callers keep importing from "./neo4j-graph" (or @dpf/db) unchanged. CTE parity vs live Neo4j
// verified 40/40 downstream-impact + 40/40 neighbours on the real graph
// (benchmarks/bet5-datastore/graph_ab.py). The raw Neo4j client survives as ./neo4j one release
// (backfill + rollback), removed in the contract phase.
export * from "./pg-graph";
