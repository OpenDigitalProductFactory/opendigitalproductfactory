import { describe, expect, it, vi } from "vitest";

import {
  collectNmapSweep,
  parseNmapGrepable,
  type NmapSweepAdapter,
} from "../collectors/nmap-sweep";

// ─── Parser ─────────────────────────────────────────────────────────────────

describe("parseNmapGrepable", () => {
  it("extracts hosts whose Status is Up", () => {
    const output = [
      "# Nmap 7.94 scan initiated Mon Dec 16 14:00:00 2026 as: nmap -sn -oG - 192.168.1.0/24",
      "Host: 192.168.1.1 (gateway.local)\tStatus: Up",
      "Host: 192.168.1.42 ()\tStatus: Up",
      "Host: 192.168.1.99 ()\tStatus: Down",
      "# Nmap done at Mon Dec 16 14:00:08 2026 -- 256 IP addresses scanned",
    ].join("\n");
    expect(parseNmapGrepable(output)).toEqual([
      { ip: "192.168.1.1", hostname: "gateway.local" },
      { ip: "192.168.1.42" },
    ]);
  });

  it("ignores comment lines and unrelated output", () => {
    const output =
      "Starting Nmap 7.94 ( https://nmap.org )\n" +
      "Host is up (0.001s latency).\n";
    expect(parseNmapGrepable(output)).toEqual([]);
  });

  it("dedupes by IP if nmap somehow emits the same host twice", () => {
    const output = [
      "Host: 10.0.0.1 ()\tStatus: Up",
      "Host: 10.0.0.1 (renamed)\tStatus: Up",
    ].join("\n");
    expect(parseNmapGrepable(output)).toHaveLength(1);
  });

  it("rejects malformed IPs", () => {
    const output = "Host: 999.0.0.1 ()\tStatus: Up";
    expect(parseNmapGrepable(output)).toEqual([]);
  });
});

// ─── collectNmapSweep ───────────────────────────────────────────────────────

function makeAdapter(
  overrides: Partial<NmapSweepAdapter> = {},
): NmapSweepAdapter {
  return {
    execNmap: () => "",
    allowlistAdapter: {
      networkInterfaces: () => ({}),
      env: {},
    },
    ...overrides,
  };
}

describe("collectNmapSweep", () => {
  it("emits a subnet item + per-host items + MEMBER_OF relationships for each scanned CIDR", async () => {
    const execNmap = vi
      .fn()
      .mockReturnValue(
        [
          "Host: 192.168.1.1 (gateway.local)\tStatus: Up",
          "Host: 192.168.1.42 ()\tStatus: Up",
        ].join("\n"),
      );
    const result = await collectNmapSweep(
      makeAdapter({
        execNmap,
        allowlistAdapter: {
          networkInterfaces: () => ({}),
          env: { DPF_EDGE_DISCOVERY_SUBNETS: "192.168.1.0/24" },
        },
      }),
    );

    expect(execNmap).toHaveBeenCalledWith("192.168.1.0/24");
    expect(result.warnings).toEqual([]);

    // 1 subnet + 2 hosts = 3 items.
    expect(result.items).toHaveLength(3);
    const subnetItem = result.items.find((i) => i.itemType === "subnet");
    expect(subnetItem?.observedKey).toBe("subnet:192.168.1.0/24");
    expect(subnetItem?.rawData?.cidr).toBe(24);

    // Two MEMBER_OF relationships from each host to the subnet.
    expect(result.relationships).toEqual([
      {
        fromObservedKey: "arp:192.168.1.1",
        toObservedKey: "subnet:192.168.1.0/24",
        relationshipType: "MEMBER_OF",
      },
      {
        fromObservedKey: "arp:192.168.1.42",
        toObservedKey: "subnet:192.168.1.0/24",
        relationshipType: "MEMBER_OF",
      },
    ]);

    // Host items match the arp:<ip> keying convention so the
    // Authority's normalization dedupes with C1's ARP rows.
    const hostItems = result.items.filter((i) => i.itemType === "host");
    expect(hostItems.map((i) => i.observedKey).sort()).toEqual([
      "arp:192.168.1.1",
      "arp:192.168.1.42",
    ]);
    expect(hostItems[0]?.rawData.discoveredVia).toBe("nmap_sn");
    expect(hostItems[0]?.confidence).toBe(0.85);
  });

  it("still emits the subnet item even when zero hosts respond", async () => {
    const result = await collectNmapSweep(
      makeAdapter({
        execNmap: () => "",
        allowlistAdapter: {
          networkInterfaces: () => ({}),
          env: { DPF_EDGE_DISCOVERY_SUBNETS: "10.99.99.0/24" },
        },
      }),
    );
    // The inventory should reflect that we tried this subnet, not just
    // hosts that answered.
    const subnetItems = result.items.filter((i) => i.itemType === "subnet");
    expect(subnetItems).toHaveLength(1);
    expect(subnetItems[0]?.observedKey).toBe("subnet:10.99.99.0/24");
    expect(result.relationships).toEqual([]);
  });

  it("records a warning when nmap exec fails but continues with other subnets", async () => {
    const execNmap = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("ETIMEDOUT");
      })
      .mockReturnValueOnce("Host: 10.0.0.1 ()\tStatus: Up");

    const result = await collectNmapSweep(
      makeAdapter({
        execNmap,
        allowlistAdapter: {
          networkInterfaces: () => ({}),
          env: {
            DPF_EDGE_DISCOVERY_SUBNETS: "192.168.1.0/24,10.0.0.0/24",
          },
        },
      }),
    );
    expect(execNmap).toHaveBeenCalledTimes(2);
    expect(result.warnings[0]).toMatch(/nmap -sn 192\.168\.1\.0\/24 failed/);
    // Second subnet's host still landed in the items list.
    expect(
      result.items.some((i) => i.observedKey === "arp:10.0.0.1"),
    ).toBe(true);
  });

  it("returns empty + warning when allow-list resolves to zero subnets", async () => {
    const execNmap = vi.fn();
    const result = await collectNmapSweep(
      makeAdapter({
        execNmap,
        allowlistAdapter: {
          networkInterfaces: () => ({}),
          env: {},
        },
      }),
    );
    expect(execNmap).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/no scan-eligible subnets/);
  });

  it("propagates allow-list filtering warnings up to the envelope", async () => {
    // /16 docker bridge is filtered by the default /20 cap. Operator
    // sees the filter reason on the next discovery-run envelope.
    const result = await collectNmapSweep(
      makeAdapter({
        execNmap: () => "",
        allowlistAdapter: {
          env: {},
          networkInterfaces: () => ({
            docker0: [
              {
                address: "172.17.0.1",
                netmask: "255.255.0.0",
                family: "IPv4",
                mac: "aa:bb:cc:dd:ee:ff",
                internal: false,
                cidr: "172.17.0.1/16",
              },
            ],
          }),
        },
      }),
    );
    expect(result.items).toEqual([]);
    expect(
      result.warnings.some((w) => /larger than \/20/i.test(w)),
    ).toBe(true);
  });
});
