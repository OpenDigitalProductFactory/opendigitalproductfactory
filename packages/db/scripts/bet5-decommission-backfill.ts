// packages/db/scripts/bet5-decommission-backfill.ts
// BET-5 (BI-A1E864A5 / BI-922EBB99): copy the live Neo4j graph + Qdrant vectors into the
// Postgres mirror, in preparation for decommissioning Neo4j and Qdrant. Invoked from
// portal-migrate-boot.sh AFTER `prisma migrate deploy` (so the target tables exist) and
// while the old neo4j/qdrant containers are still reachable over the compose network.
//
// FAIL-SOFT by design: a source that is already gone / unreachable (a fresh install that
// never had Neo4j or Qdrant, or a re-run after teardown) is not an error — it means there
// is nothing to copy. Both copies are idempotent (skip-if-populated + ON CONFLICT DO
// NOTHING), so re-running is safe. The teardown script (decommission-neo4j-qdrant.*) is the
// data-safety gate: it removes containers/volumes ONLY after confirming the mirror holds the
// backfilled data, so a failed/partial backfill here can never lead to data loss.

import "../src/load-env.js";
import { prisma } from "../src/client.js";
import { backfillQdrantToPgvector } from "../src/pgvector-backfill.js";
import { backfillNeo4jToPgGraph } from "../src/neo4j-graph-backfill.js";

async function main(): Promise<void> {
  console.log("[bet5-backfill] copying Qdrant vectors → pgvector…");
  try {
    const vec = await backfillQdrantToPgvector();
    console.log("[bet5-backfill]   vectors:", JSON.stringify(vec));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[bet5-backfill]   Qdrant unreachable / nothing to copy:", msg.slice(0, 160));
  }

  console.log("[bet5-backfill] copying Neo4j graph → graph_node/graph_edge…");
  try {
    const graph = await backfillNeo4jToPgGraph();
    console.log("[bet5-backfill]   graph:", JSON.stringify(graph));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[bet5-backfill]   Neo4j unreachable / nothing to copy:", msg.slice(0, 160));
  }

  console.log("[bet5-backfill] done.");
}

main()
  .catch((err) => {
    // Never fail the caller: this is a best-effort pre-teardown copy; the teardown gate
    // is what enforces safety. Log and exit 0 so portal boot is never blocked.
    console.warn("[bet5-backfill] unexpected error (non-fatal):", err);
  })
  .finally(() => prisma.$disconnect());
