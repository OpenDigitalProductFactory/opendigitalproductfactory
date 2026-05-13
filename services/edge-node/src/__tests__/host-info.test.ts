import { describe, expect, it } from "vitest";

import {
  collectHostInfo,
  type HostInfoAdapter,
} from "../collectors/host-info";

function fakeAdapter(overrides: Partial<HostInfoAdapter> = {}): HostInfoAdapter {
  return {
    hostname: () => "edge-test-host",
    platform: () => "linux",
    release: () => "6.5.0-test",
    arch: () => "x64",
    uptime: () => 12345,
    totalmem: () => 8 * 1024 * 1024 * 1024,
    cpus: () => [
      { model: "Test CPU", speed: 3000 },
      { model: "Test CPU", speed: 3000 },
    ],
    networkInterfaces: () => ({
      lo: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        },
      ],
      eth0: [
        {
          address: "10.0.0.5",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "aa:bb:cc:dd:ee:ff",
          internal: false,
          cidr: "10.0.0.5/24",
        },
      ],
    }),
    ...overrides,
  };
}

describe("collectHostInfo", () => {
  it("returns a single host observation with expected shape", () => {
    const result = collectHostInfo(fakeAdapter());
    expect(result.items).toHaveLength(1);
    expect(result.relationships).toEqual([]);
    const item = result.items[0]!;
    expect(item.itemType).toBe("host");
    expect(item.name).toBe("edge-test-host");
    expect(item.observedKey).toMatch(/^host:linux:[0-9a-f]{16}$/);
    expect(item.confidence).toBe(1.0);
  });

  it("includes platform / arch / release / uptime in rawData", () => {
    const result = collectHostInfo(fakeAdapter());
    const raw = result.items[0]!.rawData;
    expect(raw.hostname).toBe("edge-test-host");
    expect(raw.platform).toBe("linux");
    expect(raw.release).toBe("6.5.0-test");
    expect(raw.arch).toBe("x64");
    expect(raw.uptimeSec).toBe(12345);
    expect(raw.totalmemBytes).toBe(8 * 1024 * 1024 * 1024);
    expect(raw.cpuCount).toBe(2);
  });

  it("summarizes network interfaces with family + address + cidr", () => {
    const result = collectHostInfo(fakeAdapter());
    const ifaces = result.items[0]!.rawData.networkInterfaces as Array<
      Record<string, unknown>
    >;
    expect(ifaces).toHaveLength(2);
    const eth0 = ifaces.find((i) => i.name === "eth0");
    expect(eth0).toBeDefined();
    const addrs = eth0!.addresses as Array<Record<string, unknown>>;
    expect(addrs[0]!.address).toBe("10.0.0.5");
    expect(addrs[0]!.family).toBe("IPv4");
    expect(addrs[0]!.internal).toBe(false);
    expect(addrs[0]!.cidr).toBe("10.0.0.5/24");
  });

  it("produces a stable observedKey across calls with same inputs", () => {
    const a = collectHostInfo(fakeAdapter()).items[0]!.observedKey;
    const b = collectHostInfo(fakeAdapter()).items[0]!.observedKey;
    expect(a).toBe(b);
  });

  it("produces a different observedKey when hostname changes", () => {
    const a = collectHostInfo(fakeAdapter({ hostname: () => "host-a" })).items[0]!
      .observedKey;
    const b = collectHostInfo(fakeAdapter({ hostname: () => "host-b" })).items[0]!
      .observedKey;
    expect(a).not.toBe(b);
  });

  it("produces a different observedKey when platform changes", () => {
    const linuxKey = collectHostInfo(fakeAdapter({ platform: () => "linux" })).items[0]!
      .observedKey;
    const darwinKey = collectHostInfo(fakeAdapter({ platform: () => "darwin" })).items[0]!
      .observedKey;
    expect(linuxKey).not.toBe(darwinKey);
  });

  it("skips interfaces with no addresses", () => {
    const adapter = fakeAdapter({
      networkInterfaces: () => ({
        eth0: undefined,
        eth1: [],
        eth2: [
          {
            address: "192.168.1.1",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "192.168.1.1/24",
          },
        ],
      }),
    });
    const result = collectHostInfo(adapter);
    const ifaces = result.items[0]!.rawData.networkInterfaces as Array<
      Record<string, unknown>
    >;
    expect(ifaces.map((i) => i.name)).toEqual(["eth2"]);
  });
});
