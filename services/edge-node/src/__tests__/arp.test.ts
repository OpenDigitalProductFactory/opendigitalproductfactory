import { describe, expect, it, vi } from "vitest";

import {
  collectArpNeighbors,
  parseArpDashAn,
  parseProcNetArp,
  readArpCache,
  type ArpAdapter,
} from "../collectors/arp";

// ─── /proc/net/arp parser ───────────────────────────────────────────────────

describe("parseProcNetArp", () => {
  it("parses a real-shape /proc/net/arp output", () => {
    const content = [
      "IP address       HW type     Flags     HW address            Mask     Device",
      "192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0",
      "192.168.1.42     0x1         0x2       11:22:33:44:55:66     *        eth0",
    ].join("\n");
    expect(parseProcNetArp(content)).toEqual([
      { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:ff", iface: "eth0" },
      { ip: "192.168.1.42", mac: "11:22:33:44:55:66", iface: "eth0" },
    ]);
  });

  it("skips entries whose ATF_COM flag bit is not set (incomplete resolution)", () => {
    // Flags=0x0 means the kernel sent an ARP request but never got a
    // reply — the MAC binding is unconfirmed.
    const content = [
      "IP address       HW type     Flags     HW address            Mask     Device",
      "192.168.1.5      0x1         0x0       00:00:00:00:00:00     *        eth0",
      "192.168.1.6      0x1         0x2       aa:bb:cc:11:22:33     *        eth0",
    ].join("\n");
    const entries = parseProcNetArp(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ip).toBe("192.168.1.6");
  });

  it("skips the all-zeros and broadcast MACs explicitly", () => {
    const content = [
      "IP address       HW type     Flags     HW address            Mask     Device",
      "192.168.1.5      0x1         0x2       00:00:00:00:00:00     *        eth0",
      "192.168.1.6      0x1         0x2       ff:ff:ff:ff:ff:ff     *        eth0",
      "192.168.1.7      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0",
    ].join("\n");
    const entries = parseProcNetArp(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ip).toBe("192.168.1.7");
  });

  it("normalizes MACs to lower-case (kernel emits varied case in the wild)", () => {
    const content = [
      "IP address       HW type     Flags     HW address            Mask     Device",
      "10.0.0.1         0x1         0x2       AA:BB:CC:DD:EE:FF     *        eth0",
    ].join("\n");
    expect(parseProcNetArp(content)[0]?.mac).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("tolerates blank lines and trailing whitespace", () => {
    const content =
      "IP address       HW type     Flags     HW address            Mask     Device\n" +
      "\n" +
      "192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0   \n" +
      "\n";
    expect(parseProcNetArp(content)).toHaveLength(1);
  });

  it("dedupes by IP — keep first occurrence", () => {
    const content = [
      "IP address       HW type     Flags     HW address            Mask     Device",
      "192.168.1.1      0x1         0x2       aa:aa:aa:aa:aa:aa     *        eth0",
      "192.168.1.1      0x1         0x2       bb:bb:bb:bb:bb:bb     *        eth1",
    ].join("\n");
    const entries = parseProcNetArp(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.mac).toBe("aa:aa:aa:aa:aa:aa");
  });

  it("returns empty on malformed lines, no throw", () => {
    expect(parseProcNetArp("garbage\n")).toEqual([]);
    expect(parseProcNetArp("")).toEqual([]);
  });

  it("rejects rows with invalid IPv4 octets", () => {
    const content = [
      "IP address       HW type     Flags     HW address            Mask     Device",
      "999.0.0.1        0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0",
    ].join("\n");
    expect(parseProcNetArp(content)).toEqual([]);
  });
});

// ─── macOS `arp -an` parser ─────────────────────────────────────────────────

describe("parseArpDashAn", () => {
  it("parses standard macOS `arp -an` output", () => {
    const content = [
      "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]",
      "? (192.168.1.42) at 11:22:33:44:55:66 on en0 ifscope [ethernet]",
    ].join("\n");
    expect(parseArpDashAn(content)).toEqual([
      { ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:ff", iface: "en0" },
      { ip: "192.168.1.42", mac: "11:22:33:44:55:66", iface: "en0" },
    ]);
  });

  it("skips entries with `(incomplete)` MAC", () => {
    const content = [
      "? (192.168.1.5) at (incomplete) on en0 ifscope [ethernet]",
      "? (192.168.1.6) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]",
    ].join("\n");
    const entries = parseArpDashAn(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ip).toBe("192.168.1.6");
  });

  it("normalizes single-digit MAC bytes that macOS sometimes emits", () => {
    // macOS `arp -an` can emit "a:b:c:d:e:f" without zero-padding.
    const content = "? (10.0.0.1) at a:b:c:d:e:f on en0 ifscope [ethernet]";
    expect(parseArpDashAn(content)[0]?.mac).toBe("0a:0b:0c:0d:0e:0f");
  });

  it("skips the broadcast MAC", () => {
    const content =
      "? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]";
    expect(parseArpDashAn(content)).toEqual([]);
  });

  it("dedupes by IP", () => {
    const content = [
      "? (10.0.0.1) at aa:aa:aa:aa:aa:aa on en0 ifscope [ethernet]",
      "? (10.0.0.1) at bb:bb:bb:bb:bb:bb on en1 ifscope [ethernet]",
    ].join("\n");
    expect(parseArpDashAn(content)).toHaveLength(1);
  });

  it("returns empty for unrelated text", () => {
    expect(parseArpDashAn("Network interface 'en7' not configured.\n")).toEqual([]);
  });
});

// ─── readArpCache (platform dispatch) ───────────────────────────────────────

function makeAdapter(overrides: Partial<ArpAdapter>): ArpAdapter {
  return {
    platform: () => "linux",
    readProcNetArp: async () => "",
    execArpDashAn: () => "",
    ...overrides,
  };
}

describe("readArpCache", () => {
  it("dispatches to /proc/net/arp on Linux", async () => {
    const readProcNetArp = vi.fn(async () =>
      [
        "IP address       HW type     Flags     HW address            Mask     Device",
        "192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0",
      ].join("\n"),
    );
    const result = await readArpCache(
      makeAdapter({ platform: () => "linux", readProcNetArp }),
    );
    expect(readProcNetArp).toHaveBeenCalled();
    expect(result.entries).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("dispatches to `arp -an` on macOS", async () => {
    const execArpDashAn = vi.fn(
      () => "? (10.0.0.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]",
    );
    const result = await readArpCache(
      makeAdapter({ platform: () => "darwin", execArpDashAn }),
    );
    expect(execArpDashAn).toHaveBeenCalled();
    expect(result.entries).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("emits a warning + empty entries on /proc/net/arp read failure", async () => {
    const result = await readArpCache(
      makeAdapter({
        platform: () => "linux",
        readProcNetArp: async () => {
          throw new Error("EACCES: permission denied");
        },
      }),
    );
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatch(/arp.*EACCES/);
  });

  it("emits a warning + empty entries on `arp -an` exec failure", async () => {
    const result = await readArpCache(
      makeAdapter({
        platform: () => "darwin",
        execArpDashAn: () => {
          throw new Error("ENOENT: arp not found");
        },
      }),
    );
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatch(/arp -an.*ENOENT/);
  });

  it("skips collection on unsupported platforms with a clear warning", async () => {
    const result = await readArpCache(
      makeAdapter({ platform: () => "win32" }),
    );
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatch(/win32/);
    expect(result.warnings[0]).toMatch(/Phase 0/);
  });
});

// ─── collectArpNeighbors (observation envelope shape) ───────────────────────

describe("collectArpNeighbors", () => {
  it("emits one item per ARP entry with the canonical key shape", async () => {
    const adapter = makeAdapter({
      platform: () => "linux",
      readProcNetArp: async () =>
        [
          "IP address       HW type     Flags     HW address            Mask     Device",
          "192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0",
          "192.168.1.42     0x1         0x2       11:22:33:44:55:66     *        eth0",
        ].join("\n"),
    });
    const result = await collectArpNeighbors(adapter);
    expect(result.items).toHaveLength(2);

    // observedKey matches the server-side portal collectors at
    // packages/db/src/discovery-collectors/arp-scan.ts so the
    // Authority's normalization dedupes them as one entity.
    expect(result.items[0]).toMatchObject({
      observedKey: "arp:192.168.1.1",
      itemType: "host",
      confidence: 0.7,
      rawData: {
        address: "192.168.1.1",
        mac: "aa:bb:cc:dd:ee:ff",
        iface: "eth0",
        osiLayer: 3,
        osiLayerName: "network",
        protocolFamily: "ipv4",
        discoveredVia: "arp_table",
      },
    });

    // C1 emits no relationships; subnet attribution belongs to C2.
    expect(result.relationships).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("propagates read-failure warnings into the envelope", async () => {
    const adapter = makeAdapter({
      platform: () => "linux",
      readProcNetArp: async () => {
        throw new Error("EACCES");
      },
    });
    const result = await collectArpNeighbors(adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("returns no items + a platform warning on win32", async () => {
    const adapter = makeAdapter({ platform: () => "win32" });
    const result = await collectArpNeighbors(adapter);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/win32/);
  });
});
