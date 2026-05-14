import { describe, expect, it, vi } from "vitest";

import {
  collectSnmpPoll,
  parseSnmpgetOQv,
  parseSysUpTime,
  type SnmpPollAdapter,
} from "../collectors/snmp-poll";
import type { SnmpTarget } from "../collectors/snmp-config";

// ─── Parsers ────────────────────────────────────────────────────────────────

describe("parseSnmpgetOQv", () => {
  it("strips surrounding quotes from string values", () => {
    expect(parseSnmpgetOQv('"Cisco IOS Software, C2960X"')).toBe(
      "Cisco IOS Software, C2960X",
    );
  });

  it("preserves multi-line content inside quotes", () => {
    expect(parseSnmpgetOQv('"Line1\nLine2"')).toBe("Line1\nLine2");
  });

  it("trims surrounding whitespace on unquoted values", () => {
    expect(parseSnmpgetOQv("  1.3.6.1.4.1.9.1.2069  ")).toBe(
      "1.3.6.1.4.1.9.1.2069",
    );
  });
});

describe("parseSysUpTime", () => {
  it("extracts centiseconds from the (N) duration form", () => {
    expect(parseSysUpTime("(12345) 0:00:01.23")).toBe(12345);
  });

  it("parses the bare h:m:s.cs duration form", () => {
    // 0h:02m:34.56s = 154.56s = 15456 centiseconds
    expect(parseSysUpTime("0:02:34.56")).toBe(15456);
  });

  it("returns undefined on garbage", () => {
    expect(parseSysUpTime("not a duration")).toBeUndefined();
  });
});

// ─── collectSnmpPoll ───────────────────────────────────────────────────────

function makeAdapter(
  overrides: Partial<SnmpPollAdapter> = {},
): SnmpPollAdapter {
  return {
    execSnmpget: () => "",
    configAdapter: {
      env: {},
      readFile: () => {
        throw new Error("nope");
      },
      statMode: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    },
    ...overrides,
  };
}

function v2cAdapter(
  hosts: string[],
  execSnmpget: SnmpPollAdapter["execSnmpget"],
): SnmpPollAdapter {
  return {
    execSnmpget,
    configAdapter: {
      env: {},
      readFile: () =>
        JSON.stringify({
          targets: hosts.map((host) => ({
            host,
            version: "2c",
            community: "public",
          })),
        }),
      statMode: () => 0o600,
    },
  };
}

describe("collectSnmpPoll", () => {
  it("is a no-op when no config file is present", async () => {
    const execSnmpget = vi.fn();
    const result = await collectSnmpPoll(makeAdapter({ execSnmpget }));
    expect(execSnmpget).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("polls each target and emits a network_device entity per responder", async () => {
    const responses: Record<string, string> = {
      "1.3.6.1.2.1.1.5.0": '"gateway"',
      "1.3.6.1.2.1.1.1.0": '"Linux gateway 5.15.0 amd64"',
      "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.8072.3.2.10",
      "1.3.6.1.2.1.1.3.0": "(12345) 0:00:01.23",
      "1.3.6.1.2.1.1.6.0": '"server-room"',
      "1.3.6.1.2.1.2.1.0": "4",
    };
    const execSnmpget = vi.fn((_t: SnmpTarget, oid: string) => {
      const r = responses[oid];
      if (!r) throw new Error(`No mock for ${oid}`);
      return r;
    });

    const result = await collectSnmpPoll(
      v2cAdapter(["10.0.0.1"], execSnmpget),
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.observedKey).toBe("snmp:10.0.0.1");
    expect(item.itemType).toBe("network_device");
    expect(item.name).toBe("gateway");
    expect(item.confidence).toBe(0.95);
    expect(item.rawData).toMatchObject({
      address: "10.0.0.1",
      port: 161,
      snmpVersion: "2c",
      osiLayer: 2,
      osiLayerName: "data-link",
      protocolFamily: "ipv4",
      discoveredVia: "snmp_poll",
      sysName: "gateway",
      sysDescr: "Linux gateway 5.15.0 amd64",
      sysObjectID: "1.3.6.1.4.1.8072.3.2.10",
      sysLocation: "server-room",
      sysUpTimeTicks: 12345,
      interfaceCount: 4,
      vendorOidPrefix: "1.3.6.1.4.1.8072",
    });

    // SAME_AS link cross-references the C2 arp:<ip> entity for the
    // same physical device.
    expect(result.relationships).toEqual([
      {
        fromObservedKey: "snmp:10.0.0.1",
        toObservedKey: "arp:10.0.0.1",
        relationshipType: "SAME_AS",
        rawData: { reason: "snmp_target_matches_l3_host" },
      },
    ]);
  });

  it("classifies routers by sysDescr keyword", async () => {
    const execSnmpget = vi.fn(
      (_t: SnmpTarget, oid: string) =>
        ({
          "1.3.6.1.2.1.1.5.0": '"edge-router"',
          "1.3.6.1.2.1.1.1.0": '"Cisco IOS Software, c2900 Software"',
          "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.9.1.2069",
          "1.3.6.1.2.1.1.3.0": "(100) 0:00:01.00",
          "1.3.6.1.2.1.1.6.0": '""',
          "1.3.6.1.2.1.2.1.0": "16",
        })[oid] ?? "",
    );
    const result = await collectSnmpPoll(
      v2cAdapter(["192.168.1.1"], execSnmpget),
    );
    const item = result.items[0]!;
    expect(item.itemType).toBe("router");
    expect(item.rawData.osiLayer).toBe(3);
    expect(item.rawData.osiLayerName).toBe("network");
  });

  it("classifies switches by sysDescr keyword", async () => {
    const execSnmpget = vi.fn(
      (_t: SnmpTarget, oid: string) =>
        ({
          "1.3.6.1.2.1.1.5.0": '"core-switch"',
          "1.3.6.1.2.1.1.1.0": '"Aruba 2930F-48G Switch"',
          "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.14823.1.2.86",
          "1.3.6.1.2.1.1.3.0": "(100) 0:00:01.00",
          "1.3.6.1.2.1.1.6.0": '""',
          "1.3.6.1.2.1.2.1.0": "48",
        })[oid] ?? "",
    );
    const result = await collectSnmpPoll(
      v2cAdapter(["192.168.1.2"], execSnmpget),
    );
    const item = result.items[0]!;
    expect(item.itemType).toBe("switch");
    expect(item.rawData.osiLayer).toBe(2);
    expect(item.rawData.interfaceCount).toBe(48);
  });

  it("classifies APs by sysDescr keyword", async () => {
    const execSnmpget = vi.fn(
      (_t: SnmpTarget, oid: string) =>
        ({
          "1.3.6.1.2.1.1.5.0": '"floor-ap-3"',
          "1.3.6.1.2.1.1.1.0": '"Ubiquiti UniFi Access Point"',
          "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.41112",
          "1.3.6.1.2.1.1.3.0": "(100) 0:00:01.00",
          "1.3.6.1.2.1.1.6.0": '""',
          "1.3.6.1.2.1.2.1.0": "3",
        })[oid] ?? "",
    );
    const result = await collectSnmpPoll(
      v2cAdapter(["192.168.1.3"], execSnmpget),
    );
    expect(result.items[0]!.itemType).toBe("wireless_ap");
  });

  it("emits a warning per failing OID + skips item if all identity OIDs failed", async () => {
    const execSnmpget = vi.fn(() => {
      throw new Error("Timeout");
    });
    const result = await collectSnmpPoll(
      v2cAdapter(["10.99.99.99"], execSnmpget),
    );
    // Every OID failed, so no item — but warnings for each.
    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/snmp: 10\.99\.99\.99.*failed.*Timeout/);
  });

  it("emits an item with partial facts when only some OIDs succeed", async () => {
    // sysName + sysDescr succeed; the others throw. Item still emits
    // because we have identity facts — partial inventory is useful.
    const execSnmpget = vi.fn((_t: SnmpTarget, oid: string) => {
      if (oid === "1.3.6.1.2.1.1.5.0") return '"partial-host"';
      if (oid === "1.3.6.1.2.1.1.1.0") return '"Some Device"';
      throw new Error("Access denied for OID");
    });
    const result = await collectSnmpPoll(
      v2cAdapter(["10.0.0.5"], execSnmpget),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.name).toBe("partial-host");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("polls multiple targets and emits one item per responder", async () => {
    const execSnmpget = vi.fn((target: SnmpTarget, oid: string) => {
      if (oid === "1.3.6.1.2.1.1.5.0") return `"host-${target.host}"`;
      if (oid === "1.3.6.1.2.1.1.1.0") return '"Generic Linux"';
      return '""';
    });
    const result = await collectSnmpPoll(
      v2cAdapter(["10.0.0.1", "10.0.0.2"], execSnmpget),
    );
    expect(result.items.map((i) => i.observedKey).sort()).toEqual([
      "snmp:10.0.0.1",
      "snmp:10.0.0.2",
    ]);
    expect(result.relationships).toHaveLength(2);
  });

  it("surfaces config warnings on the result envelope", async () => {
    const result = await collectSnmpPoll(
      makeAdapter({
        configAdapter: {
          env: {},
          statMode: () => 0o600,
          readFile: () => "{ bad json",
        },
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/not valid JSON/);
  });
});
