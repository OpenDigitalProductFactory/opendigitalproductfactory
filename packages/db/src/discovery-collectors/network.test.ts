import { describe, it, expect } from "vitest";
import type os from "node:os";

import {
  collectNetworkDiscovery,
  discoverGateway,
  discoverArpNeighbors,
  isInSubnet,
  type NetworkDeps,
} from "./network";

// ─── Fixtures ──────────────────────────────────────────────────────────────

// Mock fetch that returns no Prometheus data (forces local-only discovery)
const noopFetch = (() => Promise.resolve({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;

function makeDeps(overrides: Partial<NetworkDeps> = {}): NetworkDeps {
  return {
    fetchFn: noopFetch,
    prometheusUrl: "http://localhost:9090",
    networkInterfaces: () => ({
      eth0: [
        {
          address: "10.0.1.50",
          netmask: "255.255.255.0",
          family: "IPv4" as const,
          mac: "02:42:ac:11:00:02",
          internal: false,
          cidr: "10.0.1.50/24",
        },
      ],
      lo: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4" as const,
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        },
      ],
    }) as ReturnType<typeof os.networkInterfaces>,
    execCommand: () => "",
    ...overrides,
  };
}

// ─── isInSubnet ────────────────────────────────────────────────────────────

describe("isInSubnet", () => {
  it("returns true for IP within subnet", () => {
    expect(isInSubnet("10.0.1.50", "10.0.1.0", 24)).toBe(true);
  });

  it("returns false for IP outside subnet", () => {
    expect(isInSubnet("10.0.2.50", "10.0.1.0", 24)).toBe(false);
  });

  it("handles /16 subnets", () => {
    expect(isInSubnet("192.168.5.100", "192.168.0.0", 16)).toBe(true);
    expect(isInSubnet("192.169.0.1", "192.168.0.0", 16)).toBe(false);
  });
});

// ─── collectNetworkDiscovery ───────────────────────────────────────────────

describe("collectNetworkDiscovery", () => {
  it("discovers network interfaces as items with osiLayer=3", async () => {
    const result = await collectNetworkDiscovery(undefined, makeDeps());

    const iface = result.items.find((i) => i.itemType === "network_interface");
    expect(iface).toBeDefined();
    expect(iface!.name).toBe("eth0 (10.0.1.50)");
    expect(iface!.attributes?.osiLayer).toBe(3);
    expect(iface!.attributes?.networkAddress).toBe("10.0.1.50");
    expect(iface!.attributes?.mac).toBe("02:42:ac:11:00:02");
  });

  it("skips internal (loopback) interfaces", async () => {
    const result = await collectNetworkDiscovery(undefined, makeDeps());

    const loopback = result.items.find(
      (i) => i.attributes?.interfaceName === "lo",
    );
    expect(loopback).toBeUndefined();
  });

  it("derives subnet from interface address and netmask", async () => {
    const result = await collectNetworkDiscovery(undefined, makeDeps());

    const subnet = result.items.find((i) => i.itemType === "subnet");
    expect(subnet).toBeDefined();
    expect(subnet!.name).toBe("10.0.1.0/24");
    expect(subnet!.attributes?.network).toBe("10.0.1.0");
    expect(subnet!.attributes?.cidr).toBe(24);
  });

  it("creates MEMBER_OF relationship from interface to subnet", async () => {
    const result = await collectNetworkDiscovery(undefined, makeDeps());

    const memberOf = result.relationships.find(
      (r) => r.relationshipType === "MEMBER_OF",
    );
    expect(memberOf).toBeDefined();
    expect(memberOf!.fromExternalRef).toBe("net-iface:eth0:10.0.1.50");
    expect(memberOf!.toExternalRef).toBe("subnet:10.0.1.0/24");
  });

  it("deduplicates subnets from multiple interfaces on same subnet", async () => {
    const deps = makeDeps({
      networkInterfaces: () =>
        ({
          eth0: [
            {
              address: "10.0.1.50",
              netmask: "255.255.255.0",
              family: "IPv4" as const,
              mac: "02:42:ac:11:00:02",
              internal: false,
              cidr: "10.0.1.50/24",
            },
          ],
          eth1: [
            {
              address: "10.0.1.51",
              netmask: "255.255.255.0",
              family: "IPv4" as const,
              mac: "02:42:ac:11:00:03",
              internal: false,
              cidr: "10.0.1.51/24",
            },
          ],
        }) as ReturnType<typeof os.networkInterfaces>,
    });

    const result = await collectNetworkDiscovery(undefined, deps);

    const subnets = result.items.filter((i) => i.itemType === "subnet");
    expect(subnets).toHaveLength(1);
  });

  it("discovers gateway on Linux via ip route", async () => {
    const deps = makeDeps({
      execCommand: (cmd, args) => {
        if (cmd === "ip" && args[0] === "route") {
          return "default via 10.0.1.1 dev eth0 proto dhcp src 10.0.1.50 metric 100\n10.0.1.0/24 dev eth0 proto kernel scope link src 10.0.1.50\n";
        }
        return "";
      },
    });

    const result = await collectNetworkDiscovery(undefined, deps);

    const gw = result.items.find((i) => i.itemType === "gateway");
    expect(gw).toBeDefined();
    expect(gw!.name).toBe("Gateway 10.0.1.1");
    expect(gw!.attributes?.address).toBe("10.0.1.1");
  });

  it("creates ROUTES_THROUGH relationship from subnet to gateway", async () => {
    const deps = makeDeps({
      execCommand: (cmd, args) => {
        if (cmd === "ip" && args[0] === "route") {
          return "default via 10.0.1.1 dev eth0\n";
        }
        return "";
      },
    });

    const result = await collectNetworkDiscovery(undefined, deps);

    const routesThrough = result.relationships.find(
      (r) => r.relationshipType === "ROUTES_THROUGH",
    );
    expect(routesThrough).toBeDefined();
    expect(routesThrough!.fromExternalRef).toBe("subnet:10.0.1.0/24");
    expect(routesThrough!.toExternalRef).toBe("gateway:10.0.1.1");
  });

  it("discovers ARP neighbors and places them in subnets", async () => {
    const deps = makeDeps({
      execCommand: (cmd, args) => {
        if (cmd === "ip" && args[0] === "neigh") {
          return "10.0.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE\n10.0.1.100 dev eth0 lladdr 11:22:33:44:55:66 STALE\n";
        }
        return "";
      },
    });

    const result = await collectNetworkDiscovery(undefined, deps);

    const arpHosts = result.items.filter(
      (i) => i.itemType === "host" && i.externalRef?.startsWith("arp-host:"),
    );
    expect(arpHosts).toHaveLength(2);
    expect(arpHosts[0].confidence).toBe(0.6);

    const arpMemberOfs = result.relationships.filter(
      (r) =>
        r.relationshipType === "MEMBER_OF" &&
        r.fromExternalRef?.startsWith("arp-host:"),
    );
    expect(arpMemberOfs).toHaveLength(2);
  });

  it("returns warning when no interfaces found", async () => {
    const deps = makeDeps({
      networkInterfaces: () => ({}),
    });

    const result = await collectNetworkDiscovery(undefined, deps);
    expect(result.warnings).toContain("network_no_interfaces");
  });
});

// ─── discoverGateway ───────────────────────────────────────────────────────

describe("discoverGateway", () => {
  it("parses Linux ip route output", () => {
    const deps = makeDeps({
      execCommand: (cmd, args) => {
        if (cmd === "ip" && args[0] === "route") {
          return "default via 192.168.1.1 dev eth0\n";
        }
        return "";
      },
    });
    expect(discoverGateway(deps)).toBe("192.168.1.1");
  });

  it("parses Windows route print output", () => {
    const deps = makeDeps({
      execCommand: (cmd) => {
        if (cmd === "route") {
          return "  0.0.0.0          0.0.0.0     192.168.1.1    192.168.1.50     25\n";
        }
        return "";
      },
    });
    expect(discoverGateway(deps)).toBe("192.168.1.1");
  });

  it("returns null when no gateway found", () => {
    const deps = makeDeps({ execCommand: () => "" });
    expect(discoverGateway(deps)).toBeNull();
  });
});

// ─── discoverArpNeighbors ──────────────────────────────────────────────────

describe("discoverArpNeighbors", () => {
  it("parses Linux ip neigh output", () => {
    const deps = makeDeps({
      execCommand: (cmd, args) => {
        if (cmd === "ip" && args[0] === "neigh") {
          return "10.0.0.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE\n10.0.0.2 dev eth0 lladdr 11:22:33:44:55:66 STALE\n";
        }
        return "";
      },
    });

    const result = discoverArpNeighbors(deps);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ ip: "10.0.0.1", mac: "aa:bb:cc:dd:ee:ff" });
  });

  it("parses Windows arp -a output and normalizes MAC separators", () => {
    const deps = makeDeps({
      execCommand: (cmd) => {
        if (cmd === "arp") {
          return "  10.0.0.1           aa-bb-cc-dd-ee-ff     dynamic\n  10.0.0.2           11-22-33-44-55-66     dynamic\n";
        }
        return "";
      },
    });

    const result = discoverArpNeighbors(deps);
    expect(result).toHaveLength(2);
    expect(result[0].mac).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("excludes broadcast MAC addresses", () => {
    const deps = makeDeps({
      execCommand: (cmd) => {
        if (cmd === "arp") {
          return "  10.0.0.1           ff-ff-ff-ff-ff-ff     static\n  10.0.0.2           11-22-33-44-55-66     dynamic\n";
        }
        return "";
      },
    });

    const result = discoverArpNeighbors(deps);
    expect(result).toHaveLength(1);
    expect(result[0].ip).toBe("10.0.0.2");
  });

  it("returns empty array when no ARP tool available", () => {
    const deps = makeDeps({ execCommand: () => "" });
    expect(discoverArpNeighbors(deps)).toEqual([]);
  });
});
