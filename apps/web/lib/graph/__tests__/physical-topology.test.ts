import { describe, expect, it } from "vitest";

import type { GraphData } from "@/lib/actions/graph";
import { projectPhysicalTopology } from "@/lib/graph/physical-topology";

const data: GraphData = {
  nodes: [
    { id: "gateway", name: "Gateway", label: "InfraCI", color: "", size: 1, ciType: "router", sourceKind: "unifi", lastObservedAt: "2026-08-08T20:00:00.000Z" },
    { id: "switch", name: "Switch", label: "InfraCI", color: "", size: 1, ciType: "switch", sourceKind: "unifi", lastObservedAt: "2026-08-08T20:00:00.000Z" },
    { id: "ap", name: "AP", label: "InfraCI", color: "", size: 1, ciType: "access_point", sourceKind: "unifi", lastObservedAt: "2026-08-08T20:00:00.000Z" },
    { id: "subnet", name: "192.168.0.0/24", label: "InfraCI", color: "", size: 1, ciType: "subnet", sourceKind: "arp_scan" },
    { id: "fake-host", name: "192.168.0.255", label: "InfraCI", color: "", size: 1, ciType: "host", sourceKind: "arp_scan" },
  ],
  links: [
    { source: "switch", target: "gateway", type: "CONNECTS_TO" },
    { source: "ap", target: "switch", type: "CONNECTS_TO" },
    { source: "fake-host", target: "subnet", type: "MEMBER_OF" },
  ],
};

describe("projectPhysicalTopology", () => {
  it("excludes subnet membership fan-out from the physical view", () => {
    const result = projectPhysicalTopology(data, new Date("2026-08-08T21:00:00.000Z"));

    expect(result.data.nodes.map((node) => node.id)).toEqual(["gateway", "switch", "ap"]);
    expect(result.data.links).toEqual([
      { source: "switch", target: "gateway", type: "CONNECTS_TO" },
      { source: "ap", target: "switch", type: "CONNECTS_TO" },
    ]);
    expect(result.integrity).toMatchObject({ state: "current", deviceCount: 3, physicalLinkCount: 2, sources: ["unifi"] });
  });

  it("returns an honest empty state when only subnet membership evidence exists", () => {
    const result = projectPhysicalTopology({
      nodes: data.nodes,
      links: [{ source: "fake-host", target: "subnet", type: "MEMBER_OF" }],
    });

    expect(result.data).toEqual({ nodes: [], links: [] });
    expect(result.integrity.state).toBe("empty");
    expect(result.integrity.message).toContain("No physical links");
  });

  it("marks old physical evidence stale", () => {
    const result = projectPhysicalTopology(data, new Date("2026-08-10T21:00:01.000Z"));
    expect(result.integrity.state).toBe("stale");
  });
});
