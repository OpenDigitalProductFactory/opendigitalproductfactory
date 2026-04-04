// ARP Scan Discovery Collector
// Discovers all live hosts on a subnet by sending TCP SYN probes.
// Works without managed switches or SNMP — just needs IP connectivity.
// Runs inside the portal container; reaches the host network via
// host.docker.internal or the Docker gateway.

import { spawnSync } from "node:child_process";
import type { CollectorContext, CollectorOutput } from "../discovery-types";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ArpScanTarget = {
  subnet: string;  // e.g., "192.168.0.0/24"
};

export type ArpScanDeps = {
  execCommand: (cmd: string, args: string[]) => string;
};

function defaultExecCommand(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 30_000 });
  return result.status === 0 ? result.stdout : "";
}

const defaultDeps: ArpScanDeps = {
  execCommand: defaultExecCommand,
};

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
    const hosts = await scanSubnet(target.subnet, deps);
    if (hosts.length === 0) {
      warnings.push(`arp_scan_empty:${target.subnet}`);
      continue;
    }

    // Create subnet entity
    const [network] = target.subnet.split("/");
    const subnetRef = `subnet:${target.subnet}`;
    items.push({
      sourceKind: source,
      itemType: "subnet",
      name: target.subnet,
      externalRef: subnetRef,
      naturalKey: `subnet:${target.subnet}`,
      confidence: 0.95,
      attributes: {
        network,
        cidr: Number(target.subnet.split("/")[1]) || 24,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: target.subnet,
        protocolFamily: "ipv4",
      },
    });

    // Create host entities for each discovered IP
    for (const host of hosts) {
      const hostRef = `arp-host:${host.ip}`;
      items.push({
        sourceKind: source,
        itemType: "host",
        name: host.hostname ?? `LAN Host ${host.ip}`,
        externalRef: hostRef,
        naturalKey: `arp:${host.ip}`,
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

async function scanSubnet(
  subnet: string,
  deps: ArpScanDeps,
): Promise<DiscoveredHost[]> {
  // Try nmap first (most thorough)
  const nmapHosts = tryNmapScan(subnet, deps);
  if (nmapHosts.length > 0) return nmapHosts;

  // Fall back to ping sweep + ARP table read
  return pingAndArp(subnet, deps);
}

function tryNmapScan(subnet: string, deps: ArpScanDeps): DiscoveredHost[] {
  // nmap -sn (ping scan, no port scan) with ARP detection
  const output = deps.execCommand("nmap", ["-sn", "-oG", "-", subnet]);
  if (!output) return [];

  const hosts: DiscoveredHost[] = [];
  for (const line of output.split(/\r?\n/)) {
    // Grepable output: Host: 192.168.0.1 (gateway.local) Status: Up
    const match = line.match(/^Host:\s+(\d+\.\d+\.\d+\.\d+)\s+\(([^)]*)\)\s+Status:\s+Up/i);
    if (match) {
      hosts.push({
        ip: match[1],
        hostname: match[2] || undefined,
      });
    }
  }
  return hosts;
}

function pingAndArp(subnet: string, deps: ArpScanDeps): DiscoveredHost[] {
  // Generate IPs in the subnet and ping them to populate ARP table
  const ips = generateSubnetIPs(subnet, 254);

  // Quick parallel ping (best effort — some won't respond)
  for (const ip of ips) {
    // Non-blocking ping with 1 packet, 500ms timeout
    deps.execCommand("ping", ["-c", "1", "-W", "1", ip]);
  }

  // Now read the ARP table
  let output = deps.execCommand("ip", ["neigh"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([\da-fA-F:]+)/);
        return match ? { ip: match[1], mac: match[2] } : null;
      })
      .filter((h): h is DiscoveredHost => h != null);
  }

  // Windows/macOS fallback
  output = deps.execCommand("arp", ["-a"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F:-]+)/);
        return match ? { ip: match[1], mac: match[2].replace(/-/g, ":") } : null;
      })
      .filter((h): h is DiscoveredHost => h != null)
      .filter((h) => h.mac !== "ff:ff:ff:ff:ff:ff");
  }

  return [];
}

function generateSubnetIPs(subnet: string, maxHosts: number): string[] {
  const [networkStr, cidrStr] = subnet.split("/");
  const cidr = Number(cidrStr) || 24;
  if (cidr < 16) return []; // Don't scan anything larger than /16

  const parts = networkStr.split(".").map(Number);
  const networkNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const hostBits = 32 - cidr;
  const numHosts = Math.min(maxHosts, (1 << hostBits) - 2); // Exclude network and broadcast

  const ips: string[] = [];
  for (let i = 1; i <= numHosts; i++) {
    const ip = networkNum + i;
    ips.push(`${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`);
  }
  return ips;
}
