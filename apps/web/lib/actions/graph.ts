// apps/web/lib/actions/graph.ts
"use server";

import { getNeighbours, type GraphNode, type GraphEdge } from "@dpf/db";
import { prisma } from "@dpf/db";

export type GraphData = {
  nodes: Array<{
    id: string;
    name: string;
    label: string;
    color: string;
    size: number;
  }>;
  links: Array<{
    source: string;
    target: string;
    type: string;
  }>;
};

const LABEL_COLORS: Record<string, string> = {
  DigitalProduct: "#4ade80",
  Portfolio: "#7c8cf8",
  TaxonomyNode: "#fb923c",
  InfraCI: "#38bdf8",
  Agent: "#a78bfa",
};

const LABEL_SIZES: Record<string, number> = {
  Portfolio: 8,
  TaxonomyNode: 6,
  DigitalProduct: 4,
  InfraCI: 5,
  Agent: 4,
};

export async function getFullGraphData(): Promise<GraphData> {
  // Fetch all products with their portfolio and taxonomy relationships
  const products = await prisma.digitalProduct.findMany({
    select: {
      productId: true,
      name: true,
      lifecycleStatus: true,
      portfolio: { select: { slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true, name: true } },
    },
  });

  const portfolios = await prisma.portfolio.findMany({
    select: { slug: true, name: true },
  });

  const taxonomyNodes = await prisma.taxonomyNode.findMany({
    where: { status: "active" },
    select: { nodeId: true, name: true, parentId: true },
  });

  const nodeMap = new Map<string, GraphData["nodes"][0]>();
  const links: GraphData["links"] = [];

  // Add portfolios
  for (const p of portfolios) {
    nodeMap.set(p.slug, {
      id: p.slug,
      name: p.name,
      label: "Portfolio",
      color: LABEL_COLORS.Portfolio ?? "#7c8cf8",
      size: LABEL_SIZES.Portfolio ?? 8,
    });
  }

  // Add taxonomy nodes
  for (const t of taxonomyNodes) {
    nodeMap.set(t.nodeId, {
      id: t.nodeId,
      name: t.name,
      label: "TaxonomyNode",
      color: LABEL_COLORS.TaxonomyNode ?? "#fb923c",
      size: LABEL_SIZES.TaxonomyNode ?? 6,
    });
  }

  // Add taxonomy hierarchy links
  for (const t of taxonomyNodes) {
    if (t.parentId) {
      const parent = taxonomyNodes.find((n) => n.nodeId === t.parentId);
      if (parent) {
        links.push({ source: t.parentId, target: t.nodeId, type: "PARENT_OF" });
      }
    }
  }

  // Add products and their relationships
  for (const p of products) {
    nodeMap.set(p.productId, {
      id: p.productId,
      name: p.name,
      label: "DigitalProduct",
      color: p.lifecycleStatus === "active" ? "#4ade80" : p.lifecycleStatus === "draft" ? "#fbbf24" : "#555566",
      size: LABEL_SIZES.DigitalProduct ?? 4,
    });

    if (p.portfolio) {
      links.push({ source: p.productId, target: p.portfolio.slug, type: "BELONGS_TO" });
    }
    if (p.taxonomyNode) {
      links.push({ source: p.productId, target: p.taxonomyNode.nodeId, type: "CLASSIFIED_AS" });
    }
  }

  // Try to enrich with Neo4j graph data (infrastructure CIs, dependencies)
  try {
    for (const p of products.slice(0, 20)) {
      const neighbours = await getNeighbours(p.productId);
      for (const n of neighbours) {
        if (!nodeMap.has(n.node.id)) {
          nodeMap.set(n.node.id, {
            id: n.node.id,
            name: n.node.name,
            label: n.node.label,
            color: LABEL_COLORS[n.node.label] ?? "#8888a0",
            size: LABEL_SIZES[n.node.label] ?? 4,
          });
        }
      }
    }
  } catch {
    // Neo4j may not be available — fall back to Postgres-only graph
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links: links.filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target)),
  };
}
