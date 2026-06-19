// apps/web/lib/ea/network-bridge-extract.ts
//
// Pure extractor for the Network Topology SysML projection (Parity Engine,
// living-graph Phase D — EP-ARCH-GRAPH-LIVE). Projects discovered network reality —
// DPF Edge Node hosts and the discovered device/service inventory with its
// dependency relationships — into the one architecture graph at refinement=actual,
// so "other devices on the network" become first-class architecture elements that
// impact analysis can traverse. Source: EdgeNode + InventoryEntity/InventoryRelationship.
//
// SysML mapping (rule-valid containment: package→part_definition→part_usage):
//   - package           network:pkg                  "Network Topology"
//   - host group        network:hosts                part_definition ("Edge Nodes")
//   - device group      network:devices              part_definition ("Discovered Inventory")
//   - each edge node    network:host:<nodeId>        part_usage (under host group)
//   - each inventory    network:entity:<entityKey>   part_usage (under device group)
//   - inventory link    entity -[connects]-> entity  (only when both endpoints are projected)
// Stable `network:*` source keys; pure — the reconcile shell supplies IO + scope filtering.

import type { SysmlDesiredModel } from "./sysml-model-seed";

export interface EdgeNodeFact {
  nodeId: string;
  platform: string;
  installMode: string;
  version: string;
  status: string;
  trustState: string;
  lastSeenAt: string | null; // ISO
}

export interface InventoryEntityFact {
  entityKey: string;
  entityType: string;
  name: string;
  technicalClass: string | null;
  manufacturer: string | null;
  productModel: string | null;
  status: string;
}

export interface InventoryRelFact {
  fromEntityKey: string;
  toEntityKey: string;
  relationshipType: string;
}

export const NETWORK_PACKAGE_KEY = "network:pkg";
export const NETWORK_HOSTS_KEY = "network:hosts";
export const NETWORK_DEVICES_KEY = "network:devices";

// Cross-LAYER targets: the data-model elements the EP-DATA-ARCH Prisma→EA mirror projects
// for the EdgeNode and InventoryEntity tables (`infraCiKey = prisma:model:<Model>`). Each
// discovered host/device IS a row of those tables, so it `traces` to its model — the real
// edge that lets a data-model change's blast_radius reach the discovered network elements.
export const EDGE_NODE_MODEL_KEY = "prisma:model:EdgeNode";
export const INVENTORY_ENTITY_MODEL_KEY = "prisma:model:InventoryEntity";

function truncate(s: string | undefined, n = 200): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function buildNetworkTopologyModel(args: {
  edgeNodes: EdgeNodeFact[];
  entities: InventoryEntityFact[];
  relationships: InventoryRelFact[];
}): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];
  const crossLayerRelationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: NETWORK_PACKAGE_KEY,
    typeSlug: "package",
    name: "Network Topology",
    description:
      "Live SysML projection of discovered network reality — DPF Edge Node hosts and the discovered device/service inventory — derived from EdgeNode + InventoryEntity so the network-topology layer is represented in the architecture graph (refinement=actual).",
    properties: { sourceKey: "prisma models EdgeNode and InventoryEntity", hostCount: args.edgeNodes.length, entityCount: args.entities.length },
  });
  elements.push({
    sysmlKey: NETWORK_HOSTS_KEY,
    typeSlug: "part_definition",
    name: "Edge Nodes",
    description: "DPF Edge Node hosts on the network.",
    properties: { sourceKey: "EdgeNode", layer: "network" },
  });
  elements.push({
    sysmlKey: NETWORK_DEVICES_KEY,
    typeSlug: "part_definition",
    name: "Discovered Inventory",
    description: "Devices, services, and software discovered on the network.",
    properties: { sourceKey: "InventoryEntity", layer: "network" },
  });
  relationships.push({ fromKey: NETWORK_PACKAGE_KEY, toKey: NETWORK_HOSTS_KEY, relSlug: "contains" });
  relationships.push({ fromKey: NETWORK_PACKAGE_KEY, toKey: NETWORK_DEVICES_KEY, relSlug: "contains" });

  for (const h of [...args.edgeNodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
    const key = `network:host:${h.nodeId}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "part_usage",
      name: `Edge Node ${h.nodeId}`,
      description: `${h.platform} ${h.installMode} host (${h.status}/${h.trustState}).`,
      properties: {
        sourceKey: `EdgeNode#${h.nodeId}`,
        layer: "network",
        refinementLevel: "actual",
        nodeId: h.nodeId,
        platform: h.platform,
        installMode: h.installMode,
        version: h.version,
        status: h.status,
        trustState: h.trustState,
        lastSeenAt: h.lastSeenAt,
      },
    });
    relationships.push({ fromKey: NETWORK_HOSTS_KEY, toKey: key, relSlug: "contains" });
    crossLayerRelationships.push({ fromKey: key, toKey: EDGE_NODE_MODEL_KEY, relSlug: "traces" });
  }

  const known = new Set(args.entities.map((e) => e.entityKey));
  for (const e of [...args.entities].sort((a, b) => a.entityKey.localeCompare(b.entityKey))) {
    const key = `network:entity:${e.entityKey}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "part_usage",
      name: truncate(e.name) || e.entityKey,
      description: `${e.entityType}${e.manufacturer ? ` · ${e.manufacturer}` : ""}${e.productModel ? ` ${e.productModel}` : ""} (${e.status}).`,
      properties: {
        sourceKey: `InventoryEntity#${e.entityKey}`,
        layer: "network",
        refinementLevel: "actual",
        entityType: e.entityType,
        technicalClass: e.technicalClass,
        manufacturer: e.manufacturer,
        productModel: e.productModel,
        status: e.status,
      },
    });
    relationships.push({ fromKey: NETWORK_DEVICES_KEY, toKey: key, relSlug: "contains" });
    crossLayerRelationships.push({ fromKey: key, toKey: INVENTORY_ENTITY_MODEL_KEY, relSlug: "traces" });
  }

  // Inventory dependency edges — only when both endpoints were projected.
  const seen = new Set<string>();
  for (const r of args.relationships) {
    if (!known.has(r.fromEntityKey) || !known.has(r.toEntityKey)) continue;
    if (r.fromEntityKey === r.toEntityKey) continue;
    const dedup = `${r.fromEntityKey} ${r.toEntityKey}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    relationships.push({ fromKey: `network:entity:${r.fromEntityKey}`, toKey: `network:entity:${r.toEntityKey}`, relSlug: "connects" });
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition", "part_usage"],
    relTypeSlugs: ["contains", "connects", "traces"],
    view: {
      name: "Network Topology — Live Projection",
      description: "Live, system-maintained projection of discovered network hosts, devices, and their dependencies.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "network-topology",
    },
    softRemovePrefix: "network:",
    crossLayerRelationships,
  };
}
