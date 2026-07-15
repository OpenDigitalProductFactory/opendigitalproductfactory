// packages/db/scripts/init-neo4j.ts
// One-time graph bootstrap + seed of Portfolios and TaxonomyNodes into the Postgres
// graph mirror (graph_node / graph_edge). The graph is Postgres-backed since BET-5.
// Run: cd packages/db && DATABASE_URL="..." npx tsx scripts/init-neo4j.ts
//
// What this does:
//   1. OSI-layer default backfill (graph schema itself is migration-managed)
//   2. Seeds Portfolio nodes from Postgres
//   3. Seeds TaxonomyNode nodes + CHILD_OF edges from Postgres
//   4. Seeds DigitalProduct nodes + edges from Postgres
//   5. Seeds foundational InfraCI nodes (PostgreSQL, Docker host)

import { prisma } from "../src/client";
import { initNeo4jSchema } from "../src/neo4j-schema";
import {
  syncPortfolio,
  syncTaxonomyNode,
  syncDigitalProduct,
  syncInfraCI,
  syncDependsOn,
} from "../src/graph-sync";

async function main() {
  // 1. OSI-layer default backfill (graph schema is created by Prisma migration)
  await initNeo4jSchema();

  // 2. Portfolios
  console.log("\nSeeding Portfolio nodes…");
  const portfolios = await prisma.portfolio.findMany();
  for (const p of portfolios) {
    await syncPortfolio({ slug: p.slug, name: p.name });
    process.stdout.write("  .");
  }
  console.log(` ${portfolios.length} done`);

  // 3. TaxonomyNodes
  console.log("Seeding TaxonomyNode nodes…");
  const nodes = await prisma.taxonomyNode.findMany({
    include: { parent: true },
  });
  for (const n of nodes) {
    await syncTaxonomyNode({
      nodeId: n.nodeId,
      name:   n.name,
      pgId:   n.id,
      parentNodeId: n.parent?.nodeId ?? null,
    });
    process.stdout.write("  .");
  }
  console.log(` ${nodes.length} done`);

  // 4. DigitalProducts
  console.log("Seeding DigitalProduct nodes…");
  const products = await prisma.digitalProduct.findMany({
    include: { portfolio: true, taxonomyNode: true },
  });
  for (const dp of products) {
    await syncDigitalProduct({
      productId:      dp.productId,
      name:           dp.name,
      lifecycleStage: dp.lifecycleStage,
      lifecycleStatus:dp.lifecycleStatus,
      portfolioSlug:  dp.portfolio?.slug ?? null,
      taxonomyNodeId: dp.taxonomyNodeId ?? null,
    });
    process.stdout.write("  .");
  }
  console.log(` ${products.length} done`);

  // 5. Foundational InfraCI nodes
  console.log("Seeding foundational InfraCI nodes…");
  const infraNodes = [
    { ciId: "CI-postgres-01",   name: "DPF PostgreSQL",     ciType: "database",  status: "operational", portfolioSlug: "foundational" },
    { ciId: "CI-docker-host-01",name: "Docker Host",         ciType: "server",    status: "operational", portfolioSlug: "foundational" },
    { ciId: "CI-nextjs-01",     name: "DPF Web (Next.js)",  ciType: "service",   status: "operational", portfolioSlug: "foundational" },
    { ciId: "CI-ollama-01",     name: "Ollama",             ciType: "ai-inference", status: "offline",      portfolioSlug: "foundational" },
  ];
  for (const ci of infraNodes) {
    await syncInfraCI(ci);
    process.stdout.write("  .");
  }
  console.log(` ${infraNodes.length} done`);

  // 6. InfraCI dependency edges
  console.log("Seeding InfraCI DEPENDS_ON edges…");
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-nextjs-01",  toLabel: "InfraCI", toId: "CI-postgres-01",    role: "database" });
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-postgres-01",toLabel: "InfraCI", toId: "CI-docker-host-01", role: "runtime"  });
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-ollama-01", toLabel: "InfraCI", toId: "CI-docker-host-01", role: "runtime" });
  console.log("  3 edges done");

  console.log("\n✓ Graph initialised (Postgres-backed).");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
  });
