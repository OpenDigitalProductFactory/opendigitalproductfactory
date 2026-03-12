// packages/db/scripts/init-neo4j.ts
// One-time graph schema bootstrap + seed of Portfolios and TaxonomyNodes.
// Run: cd packages/db && DATABASE_URL="..." NEO4J_URI="bolt://localhost:7687" NEO4J_USER="neo4j" NEO4J_PASSWORD="dpf_dev_password" npx tsx scripts/init-neo4j.ts
//
// What this does:
//   1. Creates constraints and indexes (idempotent)
//   2. Seeds Portfolio nodes from Postgres
//   3. Seeds TaxonomyNode nodes + CHILD_OF edges from Postgres
//   4. Seeds DigitalProduct nodes + edges from Postgres
//   5. Seeds foundational InfraCI nodes (PostgreSQL, Neo4j, Docker host)

// Env vars are supplied via command line — see comment at top.
import { PrismaClient } from "../generated/client";
import { initNeo4jSchema } from "../src/neo4j-schema";
import {
  syncPortfolio,
  syncTaxonomyNode,
  syncDigitalProduct,
  syncInfraCI,
  syncDependsOn,
} from "../src/neo4j-sync";
import { closeNeo4j } from "../src/neo4j";

const prisma = new PrismaClient();

async function main() {
  // 1. Schema constraints + indexes
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
    { ciId: "CI-neo4j-01",      name: "DPF Neo4j",          ciType: "database",  status: "operational", portfolioSlug: "foundational" },
    { ciId: "CI-docker-host-01",name: "Docker Host",         ciType: "server",    status: "operational", portfolioSlug: "foundational" },
    { ciId: "CI-nextjs-01",     name: "DPF Web (Next.js)",  ciType: "service",   status: "operational", portfolioSlug: "foundational" },
  ];
  for (const ci of infraNodes) {
    await syncInfraCI(ci);
    process.stdout.write("  .");
  }
  console.log(` ${infraNodes.length} done`);

  // 6. InfraCI dependency edges
  console.log("Seeding InfraCI DEPENDS_ON edges…");
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-nextjs-01",  toLabel: "InfraCI", toId: "CI-postgres-01",    role: "database" });
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-nextjs-01",  toLabel: "InfraCI", toId: "CI-neo4j-01",       role: "graph-db" });
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-postgres-01",toLabel: "InfraCI", toId: "CI-docker-host-01", role: "runtime"  });
  await syncDependsOn({ fromLabel: "InfraCI", fromId: "CI-neo4j-01",   toLabel: "InfraCI", toId: "CI-docker-host-01", role: "runtime"  });
  console.log("  4 edges done");

  console.log("\n✓ Neo4j initialised. Open http://localhost:7474 to browse the graph.");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
    await closeNeo4j();
  });
