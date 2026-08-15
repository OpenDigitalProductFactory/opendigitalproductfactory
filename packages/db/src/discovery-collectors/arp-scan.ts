// ARP Scan Discovery Collector
// Discovers all live hosts on a subnet by populating the ARP table (via nmap
// ping-scan, or a ping sweep fallback) and reading neighbours back.
// Works without managed switches or SNMP — just needs IP connectivity.
//
// Runs inside the portal container, ON THE SAME Node event loop that serves
// HTTP. Therefore every external command MUST be async and time-bounded, and
// the ping sweep MUST be bounded-parallel. A previous implementation used
// `spawnSync` to ping all 254 hosts of a /24 sequentially; each dead host
// waited its full timeout, freezing the entire portal for ~250s per scan
// (no page, not even /favicon.ico, would respond — CPU sat near 0 because the
// thread was blocked waiting, not computing). See BI-4CA890B7.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CollectorContext, CollectorOutput } from "../discovery-types";
import { normalizeMac } from "../discovery-mac-classification";

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

export type ArpScanTarget = {
  subnet: string;  // e.g., "192.168.0.0/24"
};

export type ArpScanDeps = {
  /**
   * Run an external command and resolve its stdout. MUST be async (never
   * block the event loop) and MUST resolve to "" on any failure/timeout
   * rather than rejecting — callers treat empty output as "tool unavailable".
   */
  execCommand: (cmd: string, args: string[], timeoutMs?: number) => Promise<string>;
};

async function defaultExecCommand(
  cmd: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch {
    // Non-zero exit, timeout (SIGTERM), or missing binary → treat as no output.
    return "";
  }
}

const defaultDeps: ArpScanDeps = {
  execCommand: defaultExecCommand,
};

// Max simultaneous pings during the fallback sweep. High enough that a /24
// completes in ~(254/limit) seconds of wall time, low enough not to exhaust
// file descriptors / subprocess slots. The work is I/O-bound (waiting on ICMP
// replies), so concurrency is cheap.
const PING_CONCURRENCY = 32;

/**
 * Run `worker` over every item with at most `limit` in flight at once.
 * Cooperative and fully async — yields the event loop between each await so
 * HTTP serving is never starved. Never rejects: a worker that throws is
 * swallowed (best-effort discovery).
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++]!;
        try {
          await worker(item);
        } catch {
          /* best-effort: a single failed ping must not abort the sweep */
        }
      }
    },
  );
  await Promise.all(lanes);
}

// ─── Collector ──────────────────────────────────────────────────────────────

export async function collectArpScanDiscovery(
  ctx?: CollectorContext,
  targets?: ArpScanTarget[],
  deps: ArpScanDeps = defaultDeps,
): Promise<CollectorOutput> {
  const source = ctx?.sourceKind ?? "arp_scan";
  const items: CollectorOutput["items"] = [];
  const relationships: CollectorOutput["relationships"] = [];
  const warnings: string[] = [];

  if (!targets || targets.length === 0) {
    return { items, relationships, warnings: ["arp_scan_no_targets"] };
  }

  for (const target of targets) {
    const parsedSubnet = parseSubnet(target.subnet);
    if (!parsedSubnet) {
      warnings.push(`arp_scan_invalid_target:${target.subnet}`);
      continue;
    }
    const canonicalSubnet = parsedSubnet.cidr;
    const rawHosts = await scanSubnet(canonicalSubnet, deps);
    const hosts = filterHosts(rawHosts, parsedSubnet);

    // Always retain the target subnet as scope evidence, even when a scan is
    // empty or quarantined. A bad host result must not erase the operator's
    // configured network boundary.
    const subnetRef = `subnet:${canonicalSubnet}`;
    items.push({
      sourceKind: source,
      itemType: "subnet",
      name: canonicalSubnet,
      externalRef: subnetRef,
      naturalKey: subnetRef,
      confidence: 0.95,
      attributes: {
        network: intToIpv4(parsedSubnet.network),
        cidr: parsedSubnet.prefix,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: canonicalSubnet,
        protocolFamily: "ipv4",
      },
    });

    const saturatedWithoutMac = hosts.length >= parsedSubnet.usableHosts
      && hosts.every((host) => !host.mac);
    if (saturatedWithoutMac) {
      warnings.push(`arp_scan_untrustworthy:${canonicalSubnet}:saturated_without_mac_evidence`);
      continue;
    }
    if (hosts.length === 0) {
      warnings.push(`arp_scan_empty:${canonicalSubnet}`);
      continue;
    }

    // Create host entities for each discovered host
    for (const host of hosts) {
      // Identity anchor: MAC is stable across DHCP lease changes, IP is not —
      // see discovery-collectors/network.ts. nmap/arp give the MAC when the host
      // answers on the local segment; fall back to the IP only when it did not.
      const hostIdentity = normalizeMac(host.mac) ?? host.ip;
      const hostRef = `arp-host:${hostIdentity}`;
      items.push({
        sourceKind: source,
        itemType: "host",
        name: host.hostname ?? `LAN Host ${host.ip}`,
        externalRef: hostRef,
        naturalKey: `arp:${hostIdentity}`,
        confidence: 0.70,
        attributes: {
          address: host.ip,
          ...(host.mac ? { mac: host.mac } : {}),
          ...(host.hostname ? { hostname: host.hostname } : {}),
          osiLayer: 3,
          osiLayerName: "network",
          networkAddress: host.ip,
          protocolFamily: "ipv4",
          discoveredVia: "arp_scan",
        },
      });

      relationships.push({
        sourceKind: source,
        relationshipType: "MEMBER_OF",
        fromExternalRef: hostRef,
        toExternalRef: subnetRef,
        confidence: 0.70,
      });
    }
  }

  return { items, relationships, warnings };
}

// ─── Scan Implementation ────────────────────────────────────────────────────

type DiscoveredHost = {
  ip: string;
  mac?: string;
  hostname?: string;
};

type ParsedSubnet = {
  prefix: number;
  network: number;
  broadcast: number;
  usableHosts: number;
  cidr: string;
};

function ipv4ToInt(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

function intToIpv4(value: number): string {
  return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

function parseSubnet(value: string): ParsedSubnet | null {
  const [address, prefixText, extra] = value.trim().split("/");
  const prefix = Number(prefixText);
  const addressNumber = address ? ipv4ToInt(address) : null;
  if (extra !== undefined || addressNumber == null || !Number.isInteger(prefix) || prefix < 16 || prefix > 30) {
    return null;
  }
  // prefix is guaranteed 16..30 by the guard above, so (32 - prefix) is 2..16 —
  // never a 32-bit no-op shift, and never 0. Compute the mask directly.
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (addressNumber & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return {
    prefix,
    network,
    broadcast,
    usableHosts: Math.max(0, broadcast - network - 1),
    cidr: `${intToIpv4(network)}/${prefix}`,
  };
}

function isUnicastMac(value: string | undefined): boolean {
  const normalized = normalizeMac(value);
  if (!normalized || normalized === "ff:ff:ff:ff:ff:ff" || normalized === "00:00:00:00:00:00") return false;
  return (Number.parseInt(normalized.slice(0, 2), 16) & 1) === 0;
}

function filterHosts(hosts: DiscoveredHost[], subnet: ParsedSubnet): DiscoveredHost[] {
  const unique = new Map<string, DiscoveredHost>();
  for (const host of hosts) {
    const ip = ipv4ToInt(host.ip);
    if (ip == null || ip <= subnet.network || ip >= subnet.broadcast) continue;
    if (host.mac && !isUnicastMac(host.mac)) continue;
    unique.set(host.ip, host);
  }
  return [...unique.values()];
}

async function scanSubnet(
  subnet: string,
  deps: ArpScanDeps,
): Promise<DiscoveredHost[]> {
  // Try nmap first (fast + thorough when bundled in the image).
  const nmapHosts = await tryNmapScan(subnet, deps);
  if (nmapHosts.length > 0) return nmapHosts;

  // Fall back to bounded-parallel ping sweep + ARP table read.
  return pingAndArp(subnet, deps);
}

async function tryNmapScan(
  subnet: string,
  deps: ArpScanDeps,
): Promise<DiscoveredHost[]> {
  // -sn  ping scan, no port scan
  // -n   DO NOT resolve DNS. Critical: reverse-DNS on a /24 can take ~45s and
  //      blow the command timeout, forcing the slow ping fallback. We don't
  //      need names here. (BI-4CA890B7)
  // -T4  aggressive timing — a /24 completes in a few seconds.
  const output = await deps.execCommand(
    "nmap",
    ["-sn", "-n", "-T4", "-oG", "-", subnet],
    60_000,
  );
  if (!output) return [];

  const hosts: DiscoveredHost[] = [];
  for (const line of output.split(/\r?\n/)) {
    // Grepable output. With -n the parens are empty: "Host: 192.168.0.1 () Status: Up"
    const match = line.match(/^Host:\s+(\d+\.\d+\.\d+\.\d+)\s+\(([^)]*)\)\s+Status:\s+Up/i);
    if (match) {
      hosts.push({
        ip: match[1]!,
        hostname: match[2] || undefined,
      });
    }
  }
  return hosts;
}

async function pingAndArp(
  subnet: string,
  deps: ArpScanDeps,
): Promise<DiscoveredHost[]> {
  // Generate IPs in the subnet and ping them to populate the ARP table.
  const ips = generateSubnetIPs(subnet, 254);

  // Bounded-parallel ping (best effort — some won't respond). Each ping is
  // async and time-bounded, so this never blocks the event loop. One packet,
  // 1s reply timeout; the 2s command timeout is a hard backstop.
  await runWithConcurrency(ips, PING_CONCURRENCY, async (ip) => {
    await deps.execCommand("ping", ["-c", "1", "-W", "1", ip], 2_000);
  });

  // Now read the ARP table that the sweep populated.
  let output = await deps.execCommand("ip", ["neigh"], 5_000);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line): DiscoveredHost | null => {
        const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([\da-fA-F:]+)/);
        return match ? { ip: match[1]!, mac: match[2]! } : null;
      })
      .filter((h): h is DiscoveredHost => h != null);
  }

  // Windows/macOS fallback
  output = await deps.execCommand("arp", ["-a"], 5_000);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line): DiscoveredHost | null => {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F:-]+)/);
        return match ? { ip: match[1]!, mac: match[2]!.replace(/-/g, ":") } : null;
      })
      .filter((h): h is DiscoveredHost => h != null)
      .filter((h) => h.mac !== "ff:ff:ff:ff:ff:ff");
  }

  return [];
}

function generateSubnetIPs(subnet: string, maxHosts: number): string[] {
  const parsed = parseSubnet(subnet);
  if (!parsed) return [];
  const numHosts = Math.min(maxHosts, parsed.usableHosts);

  const ips: string[] = [];
  for (let i = 1; i <= numHosts; i++) {
    ips.push(intToIpv4(parsed.network + i));
  }
  return ips;
}
