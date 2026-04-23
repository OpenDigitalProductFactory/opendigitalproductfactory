import { describe, expect, it } from "vitest";
import type { GraphData } from "@/lib/actions/graph";
import { VIEW_CONFIGS } from "@/lib/graph/view-config";
import { filterGraphData } from "@/lib/graph/subnet-scope";

describe("filterGraphData", () => {
  it("returns nodes attached to the selected subnet plus in-scope links, and never mutates the input", () => {
    const input: GraphData = {
      nodes: [
        { id: "subnet-a", name: "Subnet A", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
        { id: "subnet-b", name: "Subnet B", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
        { id: "host-a", name: "Host A", label: "InfraCI", color: "", size: 1, ciType: "host" },
        { id: "host-b", name: "Host B", label: "InfraCI", color: "", size: 1, ciType: "host" },
        { id: "gateway-a", name: "Gateway A", label: "InfraCI", color: "", size: 1, ciType: "gateway" },
        { id: "gateway-b", name: "Gateway B", label: "InfraCI", color: "", size: 1, ciType: "gateway" },
        { id: "rogue", name: "Rogue", label: "InfraCI", color: "", size: 1, ciType: "host" },
      ],
      links: [
        { source: "host-a", target: "subnet-a", type: "MEMBER_OF" },
        { source: "host-b", target: "subnet-b", type: "MEMBER_OF" },
        { source: "subnet-a", target: "gateway-a", type: "ROUTES_THROUGH" },
        { source: "gateway-a", target: "host-a", type: "CONNECTS_TO" },
        { source: "subnet-b", target: "gateway-b", type: "ROUTES_THROUGH" },
        { source: "gateway-a", target: "gateway-b", type: "PEER_OF" },
        { source: "rogue", target: "subnet-a", type: "ROUTES_THROUGH" },
      ],
    };
    const original = structuredClone(input);

    const result = filterGraphData(input, {
      focusNodeId: null,
      maxHops: 0,
      selectedView: "subnet-topology",
      subnetFilter: "subnet-a",
      viewConfig: VIEW_CONFIGS["subnet-topology"],
    });

    expect(result).toEqual({
      nodes: [
        { id: "subnet-a", name: "Subnet A", label: "InfraCI", color: "", size: 1, ciType: "subnet" },
        { id: "host-a", name: "Host A", label: "InfraCI", color: "", size: 1, ciType: "host" },
        { id: "gateway-a", name: "Gateway A", label: "InfraCI", color: "", size: 1, ciType: "gateway" },
        { id: "rogue", name: "Rogue", label: "InfraCI", color: "", size: 1, ciType: "host" },
      ],
      links: [
        { source: "host-a", target: "subnet-a", type: "MEMBER_OF" },
        { source: "subnet-a", target: "gateway-a", type: "ROUTES_THROUGH" },
        { source: "gateway-a", target: "host-a", type: "CONNECTS_TO" },
        { source: "rogue", target: "subnet-a", type: "ROUTES_THROUGH" },
      ],
    });
    expect(input).toEqual(original);
    expect(result.nodes).not.toBe(input.nodes);
    expect(result.links).not.toBe(input.links);
  });
});
