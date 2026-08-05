// packages/db/src/rebuild-knowledge-and-portfolio-graph.ts
//
// Backfill of the knowledge corpus and the portfolio spine into the unified
// `graph_node` / `graph_edge` mirror (BI-3045CC18).
// Usage: pnpm --filter @dpf/db graph:rebuild-knowledge-and-portfolio
//
// WHY THIS EXISTS
//
// The mirror already declared both domains and already had writers for the
// portfolio spine — `syncPortfolio` and `syncTaxonomyNode` simply had no callers,
// and `syncDigitalProduct` fired only on create/update, so nothing that existed
// before the explorer shipped was ever mirrored. The measured result was a
// "Portfolio: 1" tile next to 16,147 code nodes. The knowledge corpus had no
// vocabulary and no writer at all.
//
// The pattern this follows is the one the populated domains already use: a domain
// is only as complete as its rebuild script (neo4j-rebuild-ea.ts,
// neo4j-rebuild-documents.ts). Domains without one stayed empty.
//
// WHY IT UPSERTS AND PRUNES RATHER THAN CLEARING
//
// `clearGraphByLabel` deletes every edge touching a label before reinserting. For
// the portfolio spine that is actively unsafe: EA elements carry edges onto
// DigitalProduct nodes, and only the EA rebuild recreates them, so clearing
// DigitalProduct here would silently drop cross-domain edges this script cannot
// restore. The writers are idempotent UPSERTs, so a plain re-sync is sufficient,
// and the prune below is scoped to keys this script owns.

import "./load-env.js";
import { prisma } from "./client.js";
import {
  syncDigitalProduct,
  syncPortfolio,
  syncTaxonomyNode,
  syncWikiPage,
  syncWikiPageLink,
  wikiPageLabel,
} from "./graph-sync.js";

/** Remove mirrored wiki nodes whose source page is gone, and the derived edges
 *  that no longer exist. Scoped by the `Wiki__` label prefix and by the two
 *  relationship types this script owns, so it cannot reach another domain. */
async function pruneKnowledge(livePageIds: string[]): Promise<number> {
  const removedEdges = await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge
      WHERE rel_type IN ('LINKS_TO', 'OVERRIDES')
        AND (NOT (src_key = ANY($1::text[])) OR NOT (dst_key = ANY($1::text[])))`,
    livePageIds,
  );
  const removedNodes = await prisma.$executeRawUnsafe(
    `DELETE FROM graph_node
      WHERE EXISTS (SELECT 1 FROM unnest(labels) l WHERE l LIKE 'Wiki\\_\\_%')
        AND NOT (key = ANY($1::text[]))`,
    livePageIds,
  );
  return Number(removedEdges) + Number(removedNodes);
}

async function rebuildKnowledge(): Promise<void> {
  console.log("Backfilling knowledge corpus...");

  const pages = await prisma.wikiPage.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      pageKind: true,
      status: true,
      isKernel: true,
      organizationId: true,
      kernelPageId: true,
    },
  });

  for (const page of pages) {
    await syncWikiPage(page);
  }

  const byKind = new Map<string, number>();
  for (const page of pages) {
    const label = wikiPageLabel(page.pageKind);
    byKind.set(label, (byKind.get(label) ?? 0) + 1);
  }
  console.log(
    `Synced ${pages.length} WikiPages (${[...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => `${label}=${n}`)
      .join(", ")})`,
  );

  // Page-to-page links. `WikiPageLink` is a pure join table, so both endpoints are
  // guaranteed present by the loop above.
  const links = await prisma.wikiPageLink.findMany({
    select: { fromPageId: true, toPageId: true },
  });
  for (const link of links) {
    await syncWikiPageLink(link);
  }
  console.log(`Synced ${links.length} WikiPageLinks`);

  const overrides = pages.filter((p) => p.kernelPageId).length;
  console.log(`Synced ${overrides} kernel-override edges`);

  const pruned = await pruneKnowledge(pages.map((p) => p.id));
  if (pruned > 0) console.log(`Pruned ${pruned} stale knowledge rows`);
}

async function rebuildPortfolio(): Promise<void> {
  console.log("Backfilling portfolio spine...");

  const portfolios = await prisma.portfolio.findMany({ select: { slug: true, name: true } });
  for (const p of portfolios) {
    await syncPortfolio(p);
  }
  console.log(`Synced ${portfolios.length} Portfolios`);

  // Taxonomy before products: `syncDigitalProduct` resolves its CATEGORIZED_AS
  // target through the taxonomy row, and the edge is only written once the
  // taxonomy node it points at exists.
  const taxonomy = await prisma.taxonomyNode.findMany({
    select: { nodeId: true, name: true, id: true, parent: { select: { nodeId: true } } },
  });
  for (const tn of taxonomy) {
    await syncTaxonomyNode({
      nodeId: tn.nodeId,
      name: tn.name,
      pgId: tn.id,
      parentNodeId: tn.parent?.nodeId ?? null,
    });
  }
  console.log(`Synced ${taxonomy.length} TaxonomyNodes`);

  const products = await prisma.digitalProduct.findMany({
    select: {
      productId: true,
      name: true,
      lifecycleStage: true,
      lifecycleStatus: true,
      taxonomyNodeId: true,
      portfolio: { select: { slug: true } },
    },
  });
  for (const dp of products) {
    await syncDigitalProduct({
      productId: dp.productId,
      name: dp.name,
      lifecycleStage: dp.lifecycleStage,
      lifecycleStatus: dp.lifecycleStatus,
      portfolioSlug: dp.portfolio?.slug ?? null,
      taxonomyNodeId: dp.taxonomyNodeId,
    });
  }
  console.log(`Synced ${products.length} DigitalProducts`);
}

async function main(): Promise<void> {
  await rebuildKnowledge();
  await rebuildPortfolio();
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
