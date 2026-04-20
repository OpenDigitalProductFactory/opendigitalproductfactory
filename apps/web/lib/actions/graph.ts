// apps/web/lib/actions/graph.ts
"use server";

import {
  getNeighbours,
  getInfraCIs,
  getDownstreamImpact,
  getLayeredDependencyStack,
  getNetworkTopologyAtLayer,
  type GraphNode,
  type GraphEdge,
} from "@dpf/db";
import { runCypher } from "@dpf/db";
import { prisma } from "@dpf/db";

export type GraphData = {
  nodes: Array<{
    id: string;
    name: string;
    label: string;
    color: string;
    size: number;
    osiLayer?: number | null;
    status?: string | null;
    ciType?: string | null;
  }>;
  links: Array<{
    source: string;
    target: string;
    type: string;
  }>;
};

export function hasSubnetScopeNode(
  data: GraphData,
  subnetId: string | null,
): boolean {
  if (!subnetId || subnetId === "all") {
    return false;
  }

  return data.nodes.some((node) => {
    if (node.id !== subnetId) {
      return false;
    }
    const ciType = (node as { ciType?: string | null }).ciType;
    return ciType === "subnet" || ciType === "vlan";
  });
}

export function getSubnetScopeSignal(
  data: GraphData,
  subnetId: string | null,
): "valid" | "invalid-scope" | "unscoped" {
  if (!subnetId || subnetId === "all") {
    return "unscoped";
  }

  return hasSubnetScopeNode(data, subnetId) ? "valid" : "invalid-scope";
}

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

  // Enrich with Neo4j infrastructure topology
  try {
    // Add all InfraCI nodes
    const infraCIs = await getInfraCIs();
    for (const ci of infraCIs) {
      if (!nodeMap.has(ci.id)) {
        nodeMap.set(ci.id, infraCIToGraphNode(ci));
      }
    }

    // Add all InfraCI-to-InfraCI relationships
    const infraEdges = await runCypher<{
      fromId: string;
      toId: string;
      relType: string;
    }>(
      `MATCH (a:InfraCI)-[r]->(b:InfraCI)
       RETURN a.ciId AS fromId, b.ciId AS toId, type(r) AS relType`,
      {},
    );
    for (const edge of infraEdges) {
      if (nodeMap.has(edge.fromId) && nodeMap.has(edge.toId)) {
        links.push({
          source: edge.fromId,
          target: edge.toId,
          type: edge.relType,
        });
      }
    }

    // Add product-to-infra neighbours
    for (const p of products.slice(0, 20)) {
      const { incoming, outgoing } = await getNeighbours(p.productId);
      for (const n of [...incoming, ...outgoing]) {
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

// ─── View-Specific Server Actions ──────────────────────────────────────────

/** Network topology: L3 InfraCI nodes + their edges. */
export async function getNetworkTopologyData(): Promise<GraphData> {
  try {
    const { nodes: ciNodes, edges: ciEdges } = await getNetworkTopologyAtLayer(3);
    const nodeMap = new Map<string, GraphData["nodes"][0]>();
    for (const ci of ciNodes) {
      nodeMap.set(ci.id, infraCIToGraphNode(ci));
    }
    // Also include L7 nodes connected to L3 nodes (containers on subnets)
    const allInfra = await getInfraCIs();
    const infraEdges = await runCypher<{ fromId: string; toId: string; relType: string }>(
      `MATCH (a:InfraCI)-[r]->(b:InfraCI)
       WHERE a.osiLayer = 3 OR b.osiLayer = 3
       RETURN a.ciId AS fromId, b.ciId AS toId, type(r) AS relType`,
      {},
    );
    for (const edge of infraEdges) {
      for (const id of [edge.fromId, edge.toId]) {
        if (!nodeMap.has(id)) {
          const ci = allInfra.find((c) => c.id === id);
          if (ci) nodeMap.set(id, infraCIToGraphNode(ci));
        }
      }
    }
    const links: GraphData["links"] = [
      ...ciEdges.map((e) => ({ source: e.from, target: e.to, type: e.type })),
      ...infraEdges
        .filter((e) => nodeMap.has(e.fromId) && nodeMap.has(e.toId))
        .map((e) => ({ source: e.fromId, target: e.toId, type: e.relType })),
    ];
    // Deduplicate links
    const seen = new Set<string>();
    const uniqueLinks = links.filter((l) => {
      const key = `${l.source}-${l.type}-${l.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { nodes: Array.from(nodeMap.values()), links: uniqueLinks };
  } catch {
    return { nodes: [], links: [] };
  }
}

/** Hosting stack: Docker host + runtime + containers + HOSTS/RUNS_ON edges. */
export async function getHostingStackData(): Promise<GraphData> {
  try {
    const infraCIs = await getInfraCIs();
    const hostingTypes = new Set(["docker_host", "server", "service", "container", "monitoring_service", "ai-inference"]);
    const nodeMap = new Map<string, GraphData["nodes"][0]>();
    for (const ci of infraCIs) {
      const ciType = (ci.properties?.ciType as string) ?? ci.id.split(":")[0];
      if (hostingTypes.has(ciType) || ciType === "docker_host") {
        nodeMap.set(ci.id, infraCIToGraphNode(ci));
      }
    }
    const infraEdges = await runCypher<{ fromId: string; toId: string; relType: string }>(
      `MATCH (a:InfraCI)-[r:HOSTS|RUNS_ON|MEMBER_OF]->(b:InfraCI)
       RETURN a.ciId AS fromId, b.ciId AS toId, type(r) AS relType`,
      {},
    );
    const links: GraphData["links"] = infraEdges
      .filter((e) => nodeMap.has(e.fromId) && nodeMap.has(e.toId))
      .map((e) => ({ source: e.fromId, target: e.toId, type: e.relType }));
    return { nodes: Array.from(nodeMap.values()), links };
  } catch {
    return { nodes: [], links: [] };
  }
}

/** Impact blast radius: everything affected if the given CI fails. */
export async function getImpactData(ciId: string): Promise<GraphData> {
  try {
    const impacts = await getDownstreamImpact(ciId);
    const nodeMap = new Map<string, GraphData["nodes"][0]>();
    // Add the fault node
    const allInfra = await getInfraCIs();
    const faultNode = allInfra.find((ci) => ci.id === ciId);
    if (faultNode) {
      const gn = infraCIToGraphNode(faultNode);
      gn.color = "#ef4444"; // Red for fault origin
      gn.size = 10;
      nodeMap.set(faultNode.id, gn);
    }
    // Add affected nodes
    for (const impact of impacts) {
      if (!nodeMap.has(impact.node.id)) {
        const gn = impact.node.label === "InfraCI"
          ? infraCIToGraphNode(impact.node)
          : {
              id: impact.node.id,
              name: impact.node.name,
              label: impact.node.label,
              color: LABEL_COLORS[impact.node.label] ?? "#8888a0",
              size: LABEL_SIZES[impact.node.label] ?? 4,
            };
        // Color by distance
        if (impact.depth === 1) gn.color = "#f97316"; // orange
        else if (impact.depth === 2) gn.color = "#eab308"; // yellow
        nodeMap.set(impact.node.id, gn);
      }
    }
    // Get edges between the involved nodes
    const nodeIds = [...nodeMap.keys()];
    if (nodeIds.length === 0) return { nodes: [], links: [] };
    const edges = await runCypher<{ fromId: string; toId: string; relType: string }>(
      `MATCH (a)-[r]->(b)
       WHERE coalesce(a.ciId, a.productId) IN $nodeIds
         AND coalesce(b.ciId, b.productId) IN $nodeIds
       RETURN coalesce(a.ciId, a.productId) AS fromId,
              coalesce(b.ciId, b.productId) AS toId,
              type(r) AS relType`,
      { nodeIds },
    );
    const links = edges
      .filter((e) => nodeMap.has(e.fromId) && nodeMap.has(e.toId))
      .map((e) => ({ source: e.fromId, target: e.toId, type: e.relType }));
    return { nodes: Array.from(nodeMap.values()), links };
  } catch {
    return { nodes: [], links: [] };
  }
}

/** Dependency audit: full dependency stack from a product, grouped by OSI layer. */
export async function getDependencyAuditData(productId: string): Promise<GraphData> {
  try {
    const layers = await getLayeredDependencyStack(productId);
    const nodeMap = new Map<string, GraphData["nodes"][0]>();
    // Add the product itself
    const product = await prisma.digitalProduct.findUnique({
      where: { productId },
      select: { productId: true, name: true, lifecycleStatus: true },
    });
    if (product) {
      nodeMap.set(product.productId, {
        id: product.productId,
        name: product.name,
        label: "DigitalProduct",
        color: LABEL_COLORS.DigitalProduct ?? "#4ade80",
        size: 8,
        osiLayer: 7,
      });
    }
    // Add dependency nodes
    for (const layer of layers) {
      for (const node of layer.nodes) {
        if (!nodeMap.has(node.id)) {
          const gn = infraCIToGraphNode(node);
          gn.osiLayer = layer.osiLayer;
          nodeMap.set(node.id, gn);
        }
      }
    }
    // Get edges between involved nodes
    const nodeIds = [...nodeMap.keys()];
    if (nodeIds.length === 0) return { nodes: [], links: [] };
    const edges = await runCypher<{ fromId: string; toId: string; relType: string }>(
      `MATCH (a)-[r]->(b)
       WHERE coalesce(a.ciId, a.productId) IN $nodeIds
         AND coalesce(b.ciId, b.productId) IN $nodeIds
       RETURN coalesce(a.ciId, a.productId) AS fromId,
              coalesce(b.ciId, b.productId) AS toId,
              type(r) AS relType`,
      { nodeIds },
    );
    const links = edges
      .filter((e) => nodeMap.has(e.fromId) && nodeMap.has(e.toId))
      .map((e) => ({ source: e.fromId, target: e.toId, type: e.relType }));
    return { nodes: Array.from(nodeMap.values()), links };
  } catch {
    return { nodes: [], links: [] };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  operational: "#4ade80",
  degraded: "#eab308",
  offline: "#ef4444",
};

function infraCIToGraphNode(ci: GraphNode): GraphData["nodes"][0] {
  const ciType = (ci.properties?.ciType as string) ?? "";
  const status = (ci.properties?.status as string) ?? "operational";
  const osiLayer = (ci.properties?.osiLayer as number | undefined) ?? null;
  return {
    id: ci.id,
    name: ci.name,
    label: "InfraCI",
    color: STATUS_COLORS[status] ?? LABEL_COLORS.InfraCI ?? "#38bdf8",
    size: ciType === "docker_host" || ciType === "gateway" ? 7 : LABEL_SIZES.InfraCI ?? 5,
    osiLayer,
    status,
    ciType,
  };
}
