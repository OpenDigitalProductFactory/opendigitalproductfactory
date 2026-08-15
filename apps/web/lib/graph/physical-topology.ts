import type { GraphData } from "@/lib/actions/graph";

export const PHYSICAL_RELATIONSHIP_TYPES = new Set([
  "HOSTS",
  "CONNECTS_TO",
  "PEER_OF",
  "UPLINKS_TO",
]);

const MANAGED_DEVICE_TYPES = new Set([
  "gateway",
  "router",
  "switch",
  "access_point",
  "network_device",
  "wan_uplink",
]);

export type PhysicalTopologyIntegrity = {
  state: "current" | "partial" | "stale" | "empty";
  deviceCount: number;
  physicalLinkCount: number;
  sources: string[];
  newestObservedAt: string | null;
  message: string;
};

export function projectPhysicalTopology(
  graph: GraphData,
  now = new Date(),
): { data: GraphData; integrity: PhysicalTopologyIntegrity } {
  const physicalLinks = graph.links.filter((link) => PHYSICAL_RELATIONSHIP_TYPES.has(link.type));
  const connectedIds = new Set(physicalLinks.flatMap((link) => [link.source, link.target]));
  const nodes = graph.nodes.filter((node) => connectedIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = physicalLinks.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));
  const deviceCount = nodes.filter((node) => MANAGED_DEVICE_TYPES.has(node.ciType ?? "")).length;
  const sources = [...new Set(nodes.map((node) => node.sourceKind).filter((value): value is string => Boolean(value)))].sort();
  const observedTimes = nodes
    .map((node) => node.lastObservedAt ? Date.parse(node.lastObservedAt) : Number.NaN)
    .filter(Number.isFinite);
  const newest = observedTimes.length > 0 ? Math.max(...observedTimes) : null;

  let state: PhysicalTopologyIntegrity["state"] = "current";
  let message = `${deviceCount} managed devices connected by ${links.length} physical links.`;
  if (links.length === 0) {
    state = "empty";
    message = "No physical links have been observed. Check the UniFi connection and run discovery; subnet membership is available in Subnet Inventory.";
  } else if (newest != null && now.getTime() - newest > 24 * 60 * 60 * 1_000) {
    state = "stale";
    message = "Physical topology evidence is older than 24 hours and may no longer match the network.";
  } else if (deviceCount < 2 || !nodes.some((node) => node.ciType === "gateway" || node.ciType === "router")) {
    state = "partial";
    message = "Physical links were observed, but the managed gateway chain is incomplete.";
  }

  return {
    data: { nodes, links },
    integrity: {
      state,
      deviceCount,
      physicalLinkCount: links.length,
      sources,
      newestObservedAt: newest == null ? null : new Date(newest).toISOString(),
      message,
    },
  };
}
