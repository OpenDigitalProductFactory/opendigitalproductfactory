// packages/db/src/rebuild-knowledge-and-portfolio-graph.ts
//
// CLI runner for the knowledge + portfolio projections (BI-3045CC18).
// Usage: pnpm --filter @dpf/db graph:rebuild-knowledge-and-portfolio
//
// The projection logic itself lives in knowledge-portfolio-graph-sync.ts so the
// portal can import it. This file keeps the CLI-only concerns — dotenv, `.js`
// specifiers for direct tsx execution, and disconnecting the client on exit —
// which are exactly the things that must never reach the Next build.

import "./load-env.js";
import { prisma } from "./client.js";
import { rebuildKnowledgeAndPortfolioGraph } from "./knowledge-portfolio-graph-sync.js";

async function main(): Promise<void> {
  await rebuildKnowledgeAndPortfolioGraph();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
