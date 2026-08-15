import { prisma } from "@dpf/db";

import {
  IT4IT_VALUE_STREAMS,
  TRACE_TARGET_TYPES,
  type BacklogTraceStatus,
  type CapabilityMaturityBand,
  type TraceTargetType,
} from "./types";
import { buildCapabilityProvenance } from "./provenance";
import { buildCapabilityMapRows } from "./view-model";

export type BusinessCapabilityTraceRecord = {
  id: string;
  targetType: TraceTargetType;
  relationship: string;
  note: string | null;
  label: string;
  href: string | null;
  status?: BacklogTraceStatus;
};

export type BusinessCapabilityRecord = {
  id: string;
  capabilityId: string;
  name: string;
  slug: string;
  description: string | null;
  level: number;
  sortOrder: number;
  status: string;
  parentId: string | null;
  currentMaturity: number;
  targetMaturity: number;
  maturityRationale: string | null;
  it4itValueStreams: string[];
  traceLinks: BusinessCapabilityTraceRecord[];
};

export type BusinessCapabilityTraceGroups = Record<TraceTargetType, BusinessCapabilityTraceRecord[]>;

export type BusinessCapabilityNode = BusinessCapabilityRecord & {
  children: BusinessCapabilityNode[];
  maturityGap: number;
  maturityBand: CapabilityMaturityBand;
  traceGroups: BusinessCapabilityTraceGroups;
};

export type BusinessCapabilitySummary = {
  totalCapabilities: number;
  l1Count: number;
  l2Count: number;
  l3Count: number;
  gapCount: number;
  watchCount: number;
  alignedCount: number;
};

export type BusinessCapabilityTargetOptions = {
  taxonomyNodes: Array<{ id: string; label: string }>;
  digitalProducts: Array<{ id: string; label: string }>;
  backlogItems: Array<{ id: string; label: string }>;
  eaElements: Array<{ id: string; label: string }>;
};

export function classifyMaturityGap(currentMaturity: number, targetMaturity: number): CapabilityMaturityBand {
  const gap = targetMaturity - currentMaturity;
  if (gap <= 0) return "aligned";
  if (gap === 1) return "watch";
  return "gap";
}

export function groupCapabilityTraceLinks(
  links: BusinessCapabilityTraceRecord[],
): BusinessCapabilityTraceGroups {
  const groups = Object.fromEntries(
    TRACE_TARGET_TYPES.map((target) => [target.value, []]),
  ) as unknown as BusinessCapabilityTraceGroups;

  for (const link of links) {
    groups[link.targetType].push(link);
  }

  return groups;
}

export function buildCapabilityTree(rows: BusinessCapabilityRecord[]): BusinessCapabilityNode[] {
  const nodes = new Map<string, BusinessCapabilityNode>();
  const roots: BusinessCapabilityNode[] = [];

  for (const row of rows) {
    nodes.set(row.id, {
      ...row,
      children: [],
      maturityGap: Math.max(0, row.targetMaturity - row.currentMaturity),
      maturityBand: classifyMaturityGap(row.currentMaturity, row.targetMaturity),
      traceGroups: groupCapabilityTraceLinks(row.traceLinks),
    });
  }

  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: BusinessCapabilityNode[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);

  return roots;
}

export function summarizeCapabilityMap(rows: BusinessCapabilityRecord[]): BusinessCapabilitySummary {
  return rows.reduce<BusinessCapabilitySummary>(
    (summary, row) => {
      const band = classifyMaturityGap(row.currentMaturity, row.targetMaturity);
      summary.totalCapabilities += 1;
      if (row.level === 1) summary.l1Count += 1;
      if (row.level === 2) summary.l2Count += 1;
      if (row.level === 3) summary.l3Count += 1;
      if (band === "gap") summary.gapCount += 1;
      if (band === "watch") summary.watchCount += 1;
      if (band === "aligned") summary.alignedCount += 1;
      return summary;
    },
    {
      totalCapabilities: 0,
      l1Count: 0,
      l2Count: 0,
      l3Count: 0,
      gapCount: 0,
      watchCount: 0,
      alignedCount: 0,
    },
  );
}

function taxonomyHref(nodeId: string | null): string | null {
  return nodeId ? `/portfolio/${nodeId}` : null;
}

function toBacklogTraceStatus(status: string | null | undefined): BacklogTraceStatus {
  if (
    status === "triaging" ||
    status === "open" ||
    status === "in-progress" ||
    status === "done" ||
    status === "deferred" ||
    status === "retired"
  ) {
    return status;
  }
  return null;
}

function toTraceRecord(link: {
  id: string;
  targetType: string;
  relationship: string;
  note: string | null;
  taxonomyNode: { nodeId: string; name: string } | null;
  digitalProduct: { id: string; productId: string; name: string } | null;
  backlogItem: { itemId: string; title: string; status: string } | null;
  eaElement: { id: string; name: string; elementType: { name: string } } | null;
}): BusinessCapabilityTraceRecord {
  if (link.targetType === "taxonomy_node" && link.taxonomyNode) {
    return {
      id: link.id,
      targetType: "taxonomy_node",
      relationship: link.relationship,
      note: link.note,
      label: link.taxonomyNode.name,
      href: taxonomyHref(link.taxonomyNode.nodeId),
    };
  }

  if (link.targetType === "digital_product" && link.digitalProduct) {
    return {
      id: link.id,
      targetType: "digital_product",
      relationship: link.relationship,
      note: link.note,
      label: link.digitalProduct.name,
      href: `/portfolio/product/${link.digitalProduct.id}`,
    };
  }

  if (link.targetType === "backlog_item" && link.backlogItem) {
    return {
      id: link.id,
      targetType: "backlog_item",
      relationship: link.relationship,
      note: link.note,
      label: `${link.backlogItem.itemId} ${link.backlogItem.title}`,
      href: null,
      status: toBacklogTraceStatus(link.backlogItem.status),
    };
  }

  if (link.targetType === "ea_element" && link.eaElement) {
    return {
      id: link.id,
      targetType: "ea_element",
      relationship: link.relationship,
      note: link.note,
      label: `${link.eaElement.name} (${link.eaElement.elementType.name})`,
      href: "/ea",
    };
  }

  return {
    id: link.id,
    targetType: link.targetType as TraceTargetType,
    relationship: link.relationship,
    note: link.note,
    label: "Unresolved target",
    href: null,
  };
}

export async function getBusinessCapabilityMapData() {
  const [capabilities, taxonomyNodes, digitalProducts, backlogItems, eaElements, storefront] = await Promise.all([
    prisma.businessCapability.findMany({
      where: { status: "active" },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        traceLinks: {
          orderBy: [{ targetType: "asc" }, { relationship: "asc" }],
          include: {
            taxonomyNode: { select: { nodeId: true, name: true } },
            digitalProduct: { select: { id: true, productId: true, name: true } },
            backlogItem: { select: { itemId: true, title: true, status: true } },
            eaElement: { select: { id: true, name: true, elementType: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.taxonomyNode.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, nodeId: true, name: true },
    }),
    prisma.digitalProduct.findMany({
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, productId: true, name: true },
    }),
    prisma.backlogItem.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      select: { id: true, itemId: true, title: true },
    }),
    prisma.eaElement.findMany({
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, elementType: { select: { name: true } } },
    }),
    prisma.storefrontConfig.findFirst({
      select: {
        archetype: {
          select: { archetypeId: true, category: true, name: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const records: BusinessCapabilityRecord[] = capabilities.map((capability) => ({
    id: capability.id,
    capabilityId: capability.capabilityId,
    name: capability.name,
    slug: capability.slug,
    description: capability.description,
    level: capability.level,
    sortOrder: capability.sortOrder,
    status: capability.status,
    parentId: capability.parentId,
    currentMaturity: capability.currentMaturity,
    targetMaturity: capability.targetMaturity,
    maturityRationale: capability.maturityRationale,
    it4itValueStreams: capability.it4itValueStreams,
    traceLinks: capability.traceLinks.map(toTraceRecord),
  }));
  const tree = buildCapabilityTree(records);

  return {
    records,
    tree,
    mapRows: buildCapabilityMapRows(tree),
    summary: summarizeCapabilityMap(records),
    provenance: buildCapabilityProvenance({
      archetype: storefront?.archetype ?? null,
      records,
    }),
    targetOptions: {
      taxonomyNodes: taxonomyNodes.map((node) => ({ id: node.id, label: `${node.name} (${node.nodeId})` })),
      digitalProducts: digitalProducts.map((product) => ({ id: product.id, label: `${product.name} (${product.productId})` })),
      backlogItems: backlogItems.map((item) => ({ id: item.id, label: `${item.itemId} ${item.title}` })),
      eaElements: eaElements.map((element) => ({ id: element.id, label: `${element.name} (${element.elementType.name})` })),
    } satisfies BusinessCapabilityTargetOptions,
    valueStreams: IT4IT_VALUE_STREAMS,
  };
}
