import { describe, it, expect } from "vitest";

import { collectArpScanDiscovery, type ArpScanDeps } from "./arp-scan";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Call = { cmd: string; args: string[]; timeoutMs?: number };

/**
 * Build an async execCommand stub that records every call and returns canned
 * output per command. Mirrors the real contract: async, resolves to "" when no
 * handler matches (tool unavailable / no output).
 */
function makeExec(
  handlers: Partial<Record<string, (args: string[]) => string>>,
): { exec: ArpScanDeps["execCommand"]; calls: Call[] } {
  const calls: Call[] = [];
  const exec: ArpScanDeps["execCommand"] = async (cmd, args, timeoutMs) => {
    calls.push({ cmd, args, timeoutMs });
    const handler = handlers[cmd];
    return handler ? handler(args) : "";
  };
  return { exec, calls };
}

const NMAP_TWO_HOSTS = [
  "# Nmap scan",
  "Host: 192.168.0.1 () Status: Up",
  "Host: 192.168.0.42 () Status: Up",
  "# Nmap done",
].join("\n");

const IP_NEIGH_TWO = [
  "192.168.0.1 dev eth0 lladdr aa:bb:cc:dd:ee:01 REACHABLE",
  "192.168.0.42 dev eth0 lladdr aa:bb:cc:dd:ee:42 STALE",
].join("\n");

// ─── nmap fast path ──────────────────────────────────────────────────────────

describe("collectArpScanDiscovery — nmap path", () => {
  it("uses nmap with -n (no DNS) and does NOT fall back to ping when nmap returns hosts", async () => {
    const { exec, calls } = makeExec({ nmap: () => NMAP_TWO_HOSTS });

    const out = await collectArpScanDiscovery(
      { sourceKind: "arp_scan" },
      [{ subnet: "192.168.0.0/24" }],
      { execCommand: exec },
    );

    // nmap invoked exactly once, with -n to skip reverse-DNS (the BI-4CA890B7 fix)
    const nmapCalls = calls.filter((c) => c.cmd === "nmap");
    expect(nmapCalls).toHaveLength(1);
    expect(nmapCalls[0]!.args).toContain("-n");

    // No ping fallback when nmap succeeded
    expect(calls.some((c) => c.cmd === "ping")).toBe(false);

    const hosts = out.items.filter((i) => i.itemType === "host");
    expect(hosts.map((h) => h.attributes!.address).sort()).toEqual([
      "192.168.0.1",
      "192.168.0.42",
    ]);
    // One subnet entity + MEMBER_OF rels
    expect(out.items.some((i) => i.itemType === "subnet")).toBe(true);
    expect(out.relationships).toHaveLength(2);
  });
});

// ─── ping fallback path ──────────────────────────────────────────────────────

describe("collectArpScanDiscovery — ping/arp fallback", () => {
  it("falls back to a BOUNDED-PARALLEL ping sweep then reads the ARP table", async () => {
    // nmap absent (returns "") → fallback engages.
    const { exec, calls } = makeExec({
      ip: (args) => (args[0] === "neigh" ? IP_NEIGH_TWO : ""),
    });

    const out = await collectArpScanDiscovery(
      { sourceKind: "arp_scan" },
      [{ subnet: "192.168.0.0/24" }],
      { execCommand: exec },
    );

    // Pinged the host range (254 usable addresses in a /24).
    const pings = calls.filter((c) => c.cmd === "ping");
    expect(pings).toHaveLength(254);
    // Each ping is time-bounded (never an unbounded blocking call).
    expect(pings.every((p) => typeof p.timeoutMs === "number" && p.timeoutMs! > 0)).toBe(true);
    // ARP table read after the sweep.
    expect(calls.some((c) => c.cmd === "ip" && c.args[0] === "neigh")).toBe(true);

    const hosts = out.items.filter((i) => i.itemType === "host");
    expect(hosts).toHaveLength(2);
    expect(hosts.find((h) => h.attributes!.address === "192.168.0.1")!.attributes!.mac).toBe(
      "aa:bb:cc:dd:ee:01",
    );
  });

  it("runs pings with real concurrency (more than one in flight at once)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const exec: ArpScanDeps["execCommand"] = async (cmd, args) => {
      if (cmd === "ping") {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        inFlight--;
        return "";
      }
      if (cmd === "ip" && args[0] === "neigh") return IP_NEIGH_TWO;
      return "";
    };

    await collectArpScanDiscovery(
      { sourceKind: "arp_scan" },
      [{ subnet: "192.168.0.0/24" }],
      { execCommand: exec },
    );

    // The old implementation was strictly sequential (max 1). The fix runs a
    // bounded pool, so several pings overlap.
    expect(maxInFlight).toBeGreaterThan(1);
  });
});

// ─── guards ──────────────────────────────────────────────────────────────────

describe("collectArpScanDiscovery — guards", () => {
  it("canonicalizes the subnet and excludes network, broadcast, and out-of-subnet rows", async () => {
    const output = [
      "Host: 192.168.0.0 () Status: Up",
      "Host: 192.168.0.1 () Status: Up",
      "Host: 192.168.0.255 () Status: Up",
      "Host: 192.168.1.12 () Status: Up",
    ].join("\n");
    const { exec } = makeExec({ nmap: () => output });

    const out = await collectArpScanDiscovery(
      { sourceKind: "arp_scan" },
      [{ subnet: "192.168.0.1/24" }],
      { execCommand: exec },
    );

    expect(out.items.find((item) => item.itemType === "subnet")?.externalRef).toBe("subnet:192.168.0.0/24");
    expect(out.items.filter((item) => item.itemType === "host").map((item) => item.attributes?.address)).toEqual(["192.168.0.1"]);
  });

  it("quarantines an impossible full-subnet nmap result instead of minting fake hosts", async () => {
    const output = Array.from({ length: 256 }, (_, host) =>
      `Host: 192.168.0.${host} () Status: Up`,
    ).join("\n");
    const { exec } = makeExec({ nmap: () => output });

    const out = await collectArpScanDiscovery(
      { sourceKind: "arp_scan" },
      [{ subnet: "192.168.0.0/24" }],
      { execCommand: exec },
    );

    expect(out.items.filter((item) => item.itemType === "subnet")).toHaveLength(1);
    expect(out.items.filter((item) => item.itemType === "host")).toHaveLength(0);
    expect(out.relationships).toHaveLength(0);
    expect(out.warnings).toContain("arp_scan_untrustworthy:192.168.0.0/24:saturated_without_mac_evidence");
  });

  it("warns and does nothing when no targets are supplied", async () => {
    const out = await collectArpScanDiscovery({ sourceKind: "arp_scan" }, []);
    expect(out.items).toHaveLength(0);
    expect(out.warnings).toContain("arp_scan_no_targets");
  });

  it("emits arp_scan_empty when neither nmap nor the ping sweep find hosts", async () => {
    const { exec } = makeExec({}); // everything returns ""
    const out = await collectArpScanDiscovery(
      { sourceKind: "arp_scan" },
      [{ subnet: "192.168.0.0/24" }],
      { execCommand: exec },
    );
    expect(out.items.filter((item) => item.itemType === "subnet")).toHaveLength(1);
    expect(out.items.filter((item) => item.itemType === "host")).toHaveLength(0);
    expect(out.warnings).toContain("arp_scan_empty:192.168.0.0/24");
  });
});
