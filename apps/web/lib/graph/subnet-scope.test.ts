import { describe, expect, it } from "vitest";
import type { GraphData } from "@/lib/actions/graph";
import { VIEW_CONFIGS } from "./view-config";
import { describeGraphScope, filterGraphData } from "./subnet-scope";

const graphData: GraphData = {
  nodes: [
    { id: "subnet-a", name: "10.0.0.0/24", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
    { id: "subnet-b", name: "10.0.1.0/24", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
    { id: "host-a", name: "Host A", label: "InfraCI", color: "", size: 1, ciType: "host" },
    { id: "host-b", name: "Host B", label: "InfraCI", color: "", size: 1, ciType: "host" },
    { id: "gw-a", name: "Gateway A", label: "InfraCI", color: "", size: 1, ciType: "gateway" },
  ],
  links: [
    { source: "host-a", target: "subnet-a", type: "MEMBER_OF" },
    { source: "host-b", target: "subnet-b", type: "MEMBER_OF" },
    { source: "subnet-a", target: "gw-a", type: "ROUTES_THROUGH" },
    { source: "host-a", target: "host-b", type: "CONNECTS_TO" },
  ],
};

describe("filterGraphData", () => {
  it("scopes subnet-topology to the selected subnet and its relevant links", () => {
    const result = filterGraphData(graphData, {
      focusNodeId: null,
      maxHops: 0,
      selectedView: "subnet-topology",
      subnetFilter: "subnet-a",
      viewConfig: VIEW_CONFIGS["subnet-topology"],
    });

    expect(result.nodes.map((node) => node.id).sort()).toEqual(["gw-a", "host-a", "subnet-a"]);
    expect(result.links).toEqual([
      { source: "host-a", target: "subnet-a", type: "MEMBER_OF" },
      { source: "subnet-a", target: "gw-a", type: "ROUTES_THROUGH" },
    ]);
  });

  it("replaces the previous subnet scope instead of merging results", () => {
    const result = filterGraphData(graphData, {
      focusNodeId: null,
      maxHops: 0,
      selectedView: "subnet-topology",
      subnetFilter: "subnet-b",
      viewConfig: VIEW_CONFIGS["subnet-topology"],
    });

    expect(result.nodes.map((node) => node.id).sort()).toEqual(["host-b", "subnet-b"]);
    expect(result.links).toEqual([
      { source: "host-b", target: "subnet-b", type: "MEMBER_OF" },
    ]);
  });

  it("describes the active subnet scope for live announcements", () => {
    const scoped = filterGraphData(graphData, {
      focusNodeId: null,
      maxHops: 0,
      selectedView: "subnet-topology",
      subnetFilter: "subnet-a",
      viewConfig: VIEW_CONFIGS["subnet-topology"],
    });

    expect(
      describeGraphScope(scoped, "subnet-topology", "subnet-a", [
        { id: "subnet-a", name: "10.0.0.0/24" },
      ]),
    ).toBe("Viewing subnet 10.0.0.0/24 (3 nodes)");
  });

  it("describes the full graph when no subnet filter is active", () => {
    expect(
      describeGraphScope(graphData, "subnet-topology", "all", [
        { id: "subnet-a", name: "10.0.0.0/24" },
        { id: "subnet-b", name: "10.0.1.0/24" },
      ]),
    ).toBe("Viewing full graph (5 nodes)");
  });
});
