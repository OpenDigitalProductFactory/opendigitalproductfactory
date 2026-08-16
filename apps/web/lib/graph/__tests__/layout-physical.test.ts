import { describe, expect, it } from "vitest";

import type { GraphData } from "@/lib/actions/graph";
import { computePhysicalTopologyLayout } from "@/lib/graph/layout-physical";

function node(id: string, ciType: string): GraphData["nodes"][number] {
  return { id, name: id, label: "InfraCI", color: "", size: 1, ciType };
}

describe("computePhysicalTopologyLayout", () => {
  it("places the physical spine from WAN down to clients", () => {
    const data: GraphData = {
      nodes: [
        node("wan", "wan_uplink"),
        node("gateway", "router"),
        node("switch", "switch"),
        node("ap", "access_point"),
        node("client", "network_client"),
      ],
      links: [
        { source: "wan", target: "gateway", type: "UPLINKS_TO" },
        { source: "gateway", target: "switch", type: "CONNECTS_TO" },
        { source: "switch", target: "ap", type: "CONNECTS_TO" },
        { source: "ap", target: "client", type: "CONNECTS_TO" },
      ],
    };

    const positions = new Map(computePhysicalTopologyLayout(data).nodes.map((item) => [item.id, item]));
    expect(positions.get("wan")!.y).toBeLessThan(positions.get("gateway")!.y);
    expect(positions.get("gateway")!.y).toBeLessThan(positions.get("switch")!.y);
    expect(positions.get("switch")!.y).toBeLessThan(positions.get("ap")!.y);
    expect(positions.get("ap")!.y).toBeLessThan(positions.get("client")!.y);
  });

  it("wraps large client groups beneath their actual access points", () => {
    const clients = Array.from({ length: 72 }, (_, index) => node(`client-${index}`, "network_client"));
    const aps = Array.from({ length: 4 }, (_, index) => node(`ap-${index}`, "access_point"));
    const data: GraphData = {
      nodes: [node("wan", "wan_uplink"), node("gateway", "router"), node("switch", "switch"), ...aps, ...clients],
      links: [
        { source: "wan", target: "gateway", type: "UPLINKS_TO" },
        { source: "gateway", target: "switch", type: "CONNECTS_TO" },
        ...aps.map((ap) => ({ source: "switch", target: ap.id, type: "CONNECTS_TO" })),
        ...clients.map((client, index) => ({ source: `ap-${index % 4}`, target: client.id, type: "CONNECTS_TO" })),
      ],
    };

    const result = computePhysicalTopologyLayout(data);
    const positioned = new Map(result.nodes.map((item) => [item.id, item]));
    const xs = result.nodes.map((item) => item.x);

    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(2_600);
    for (let index = 0; index < clients.length; index += 1) {
      const parent = positioned.get(`ap-${index % 4}`)!;
      const client = positioned.get(`client-${index}`)!;
      expect(client.y).toBeGreaterThan(parent.y);
      expect(Math.abs(client.x - parent.x)).toBeLessThanOrEqual(250);
    }
  });

  it("is deterministic for the same graph", () => {
    const data: GraphData = {
      nodes: [node("gateway", "router"), node("switch", "switch")],
      links: [{ source: "gateway", target: "switch", type: "CONNECTS_TO" }],
    };
    expect(computePhysicalTopologyLayout(data)).toEqual(computePhysicalTopologyLayout(data));
  });
});
