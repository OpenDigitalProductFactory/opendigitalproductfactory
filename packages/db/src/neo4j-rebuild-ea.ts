// packages/db/src/neo4j-rebuild-ea.ts
// Full rebuild of the EA graph projection from Postgres.
// Run after Prisma migrations or when Neo4j EA data is suspected stale.
// Usage: pnpm --filter @dpf/db neo4j:rebuild-ea

import { prisma } from "./client.js";
import { closeNeo4j, runCypher } from "./neo4j.js";
import { syncEaElement, syncEaRelationship } from "./neo4j-sync.js";

async function rebuildEa(): Promise<void> {
  console.log("Rebuilding EA graph projection...");

  // 1. Drop all existing EA nodes and their edges
  await runCypher(`MATCH (n:EaElement) DETACH DELETE n`, {});
  console.log("Dropped existing :EaElement nodes");

  // 2. Rebuild EaElement nodes
  const elements = await prisma.eaElement.findMany({
    select: {
      id: true,
      name: true,
      lifecycleStage: true,
      lifecycleStatus: true,
      infraCiKey: true,
      digitalProductId: true,
      portfolioId: true,
      taxonomyNodeId: true,
      elementType: {
        select: {
          neoLabel: true,
          slug: true,
          notation: { select: { slug: true } },
        },
      },
    },
  });

  for (const el of elements) {
    await syncEaElement({
      id:               el.id,
      neoLabel:         el.elementType.neoLabel,
      notationSlug:     el.elementType.notation.slug,
      elementTypeSlug:  el.elementType.slug,
      name:             el.name,
      lifecycleStage:   el.lifecycleStage,
      lifecycleStatus:  el.lifecycleStatus,
      infraCiKey:       el.infraCiKey,
      digitalProductId: el.digitalProductId,
      portfolioId:      el.portfolioId,
      taxonomyNodeId:   el.taxonomyNodeId,
    });
  }
  console.log(`Synced ${elements.length} EaElements`);

  // 3. Rebuild EaRelationship edges
  const relationships = await prisma.eaRelationship.findMany({
    select: {
      id: true,
      fromElementId: true,
      toElementId: true,
      notationSlug: true,
      relationshipType: { select: { neoType: true, slug: true } },
    },
  });

  for (const rel of relationships) {
    await syncEaRelationship({
      id:                   rel.id,
      fromElementId:        rel.fromElementId,
      toElementId:          rel.toElementId,
      neoType:              rel.relationshipType.neoType,
      notationSlug:         rel.notationSlug,
      relationshipTypeSlug: rel.relationshipType.slug,
    });
  }
  console.log(`Synced ${relationships.length} EaRelationships`);

  console.log("EA graph rebuild complete.");
}

rebuildEa()
  .catch(console.error)
  .finally(() => Promise.all([prisma.$disconnect(), closeNeo4j()]));
