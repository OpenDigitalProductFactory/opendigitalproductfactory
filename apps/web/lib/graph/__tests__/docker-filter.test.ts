import { describe, expect, it } from "vitest";
import type { GraphData } from "@/lib/actions/graph";
import { isDockerOriginNode, stripDockerOrigin } from "@/lib/graph/docker-filter";

const baseNode = { label: "InfraCI", color: "", size: 1 } as const;

describe("isDockerOriginNode", () => {
  it("detects subnets named with the Docker: prefix", () => {
    expect(
      isDockerOriginNode({
        ...baseNode,
        id: "n1",
        name: "Docker: dpf_default (172.18.0.0/16)",
        ciType: "subnet",
      }),
    ).toBe(true);
  });

  it("detects gateways named with the Docker GW prefix", () => {
    expect(
      isDockerOriginNode({
        ...baseNode,
        id: "n2",
        name: "Docker GW dpf_default (172.18.0.1)",
        ciType: "gateway",
      }),
    ).toBe(true);
  });

  it("detects containers by ciType regardless of name", () => {
    expect(
      isDockerOriginNode({
        ...baseNode,
        id: "n3",
        name: "dpf-portal-1",
        ciType: "container",
      }),
    ).toBe(true);
  });

  it("detects docker_runtime and docker_host CIs", () => {
    expect(
      isDockerOriginNode({ ...baseNode, id: "n4", name: "Docker Engine", ciType: "docker_runtime" }),
    ).toBe(true);
    expect(
      isDockerOriginNode({ ...baseNode, id: "n5", name: "dockerhost", ciType: "docker_host" }),
    ).toBe(true);
  });

  it("does NOT flag real LAN subnets, hosts, or non-Docker gateways", () => {
    expect(
      isDockerOriginNode({ ...baseNode, id: "n6", name: "192.168.0.0/24", ciType: "subnet" }),
    ).toBe(false);
    expect(
      isDockerOriginNode({ ...baseNode, id: "n7", name: "UDM Pro", ciType: "router" }),
    ).toBe(false);
    expect(
      isDockerOriginNode({ ...baseNode, id: "n8", name: "Gateway 192.168.0.1", ciType: "gateway" }),
    ).toBe(false);
  });
});

describe("stripDockerOrigin", () => {
  it("removes Docker nodes and all links touching them, leaves real LAN intact", () => {
    const input: GraphData = {
      nodes: [
        { ...baseNode, id: "lan-subnet", name: "192.168.0.0/24", ciType: "subnet" },
        { ...baseNode, id: "lan-host", name: "laptop", ciType: "host" },
        { ...baseNode, id: "dk-subnet", name: "Docker: dpf_default (172.18.0.0/16)", ciType: "subnet" },
        { ...baseNode, id: "dk-gw", name: "Docker GW dpf_default (172.18.0.1)", ciType: "gateway" },
        { ...baseNode, id: "dk-container", name: "dpf-portal-1", ciType: "container" },
      ],
      links: [
        { source: "lan-host", target: "lan-subnet", type: "MEMBER_OF" },
        { source: "dk-container", target: "dk-subnet", type: "MEMBER_OF" },
        { source: "dk-subnet", target: "dk-gw", type: "ROUTES_THROUGH" },
        // A link from a real LAN host to a Docker subnet — should also be dropped.
        { source: "lan-host", target: "dk-subnet", type: "CONNECTS_TO" },
      ],
    };

    const result = stripDockerOrigin(input);

    expect(result.nodes.map((n) => n.id).sort()).toEqual(["lan-host", "lan-subnet"]);
    expect(result.links).toEqual([
      { source: "lan-host", target: "lan-subnet", type: "MEMBER_OF" },
    ]);
  });

  it("returns the same reference when nothing matches (cheap no-op)", () => {
    const input: GraphData = {
      nodes: [{ ...baseNode, id: "n1", name: "192.168.0.0/24", ciType: "subnet" }],
      links: [],
    };
    expect(stripDockerOrigin(input)).toBe(input);
  });
});
