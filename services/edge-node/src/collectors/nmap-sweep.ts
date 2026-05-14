// Active subnet sweep (C2) — nmap -sn ping scan of operator-allowed CIDRs.
//
// Where C1 (arp.ts) read whatever the kernel had already resolved, C2
// actively probes each address in the allow-list and emits inventory
// items for the hosts that respond. This is what turns the Edge Node
// from "reports what we already knew" into "discovers what we didn't".
//
// Privilege envelope:
//   - With CAP_NET_RAW (granted by docker-compose.edge*.yml on Linux):
//     nmap -sn uses ARP requests on directly-attached LANs (fastest)
//     and ICMP echo elsewhere. Subjects no host to scanning beyond
//     ping reachability — no port scans, no service detection.
//   - Without CAP_NET_RAW (e.g. macOS Docker Desktop): nmap falls back
//     to TCP connect probes on ports 80 + 443. Less accurate but the
//     output format is identical so the parser doesn't care.
//
// Output keying: same `arp:<ip>` observedKey as C1 and the server-side
// portal `arp_scan` collector. Authority dedup means an IP discovered
// by ALL three (kernel ARP cache, active ping, server-side scan)
// shows up as one entity with merged attributes.
//
// Confidence: 0.85 — higher than C1's 0.7 because the host actually
// responded; lower than 0.95 because nmap -sn doesn't confirm what
// the host IS, just that it's reachable.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Edge Node capability envelope — capability.discovery.network

import { execFileSync } from "node:child_process";

import type { ObservationItem } from "./host-info";
import {
  resolveSubnetAllowlist,
  type SubnetAllowlistAdapter,
} from "./subnet-allowlist";

/**
 * One host discovered by the active probe. Internal type; flattened
 * into ObservationItem + relationship in the collector output.
 */
export type ProbedHost = {
  ip: string;
  hostname?: string;
};

export type NmapSweepRelationship = {
  fromObservedKey: string;
  toObservedKey: string;
  relationshipType: string;
  rawData?: Record<string, unknown>;
};

export type NmapSweepResult = {
  items: ObservationItem[];
  /**
   * Relationships emitted by the active sweep. Each probed host gets
   * a MEMBER_OF relationship to the subnet item we also emit, so the
   * inventory graph captures "host X is in subnet Y" as a first-
   * class edge. Matches the server-side portal collector convention.
   */
  relationships: NmapSweepRelationship[];
  warnings: string[];
};

/** Adapter for tests — replaces the nmap subprocess + the allow-list resolver. */
export type NmapSweepAdapter = {
  /**
   * Run `nmap -sn -oG - <subnet>` and return stdout. Throws on
   * non-zero exit or timeout; caller catches and records a warning.
   * Sync because we serialize subnet scans anyway (parallel scans
   * on a single LAN don't gain throughput and increase the
   * IDS-trigger surface).
   */
  execNmap: (subnet: string) => string;
  /** Allow-list source (defaults to env + os.networkInterfaces()). */
  allowlistAdapter?: SubnetAllowlistAdapter;
};

/** Per-subnet timeout — nmap -sn on a /24 takes ~5–8s; /20 takes ~30s. */
const NMAP_TIMEOUT_MS = 90_000;

const DEFAULT_ADAPTER: NmapSweepAdapter = {
  execNmap: (subnet: string) =>
    execFileSync("nmap", ["-sn", "-oG", "-", subnet], {
      encoding: "utf8",
      // Larger buffer than ARP because /22 sweeps can emit ~1k lines.
      maxBuffer: 4 * 1024 * 1024,
      timeout: NMAP_TIMEOUT_MS,
    }),
};

/**
 * Parse nmap's grepable (`-oG`) output for hosts in "Status: Up".
 *
 * Format (one line per host):
 *   Host: 192.168.1.1 (gateway.local) Status: Up
 *   Host: 192.168.1.42 ()             Status: Up
 *
 * Empty parens means nmap couldn't reverse-resolve; treat hostname
 * as absent in that case. The full output also contains "Status:
 * Down" lines for hosts that didn't respond — we skip those.
 */
export function parseNmapGrepable(output: string): ProbedHost[] {
  const hosts: ProbedHost[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(
      /^Host:\s+(\d+\.\d+\.\d+\.\d+)\s+\(([^)]*)\)\s+Status:\s+Up/i,
    );
    if (!m) continue;
    const ip = m[1]!;
    const hostnameRaw = m[2]!.trim();
    if (!isLikelyIpv4(ip)) continue;
    hosts.push(
      hostnameRaw.length > 0 ? { ip, hostname: hostnameRaw } : { ip },
    );
  }
  // Dedup by IP — nmap doesn't normally emit duplicates but defensive.
  const seen = new Set<string>();
  return hosts.filter((h) => {
    if (seen.has(h.ip)) return false;
    seen.add(h.ip);
    return true;
  });
}

function isLikelyIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * Run the active sweep over the operator-allowed subnets. Returns
 * one item per discovered host + one subnet item per scanned CIDR +
 * MEMBER_OF relationships linking them. Warnings carry both the
 * allow-list resolution warnings (filtered subnets) and any per-
 * subnet scan failures.
 */
export async function collectNmapSweep(
  adapter: NmapSweepAdapter = DEFAULT_ADAPTER,
): Promise<NmapSweepResult> {
  const allowlist = resolveSubnetAllowlist(adapter.allowlistAdapter);

  const items: ObservationItem[] = [];
  const relationships: NmapSweepRelationship[] = [];
  const warnings: string[] = [...allowlist.warnings];

  if (allowlist.subnets.length === 0) {
    if (allowlist.source === "empty") {
      warnings.push(
        "discovery: no scan-eligible subnets found — set DPF_EDGE_DISCOVERY_SUBNETS to opt in explicitly",
      );
    }
    return { items, relationships, warnings };
  }

  for (const subnet of allowlist.subnets) {
    const subnetKey = `subnet:${subnet}`;
    const [networkAddress, cidrStr] = subnet.split("/");

    // Emit the subnet item even if the scan produces zero hosts —
    // the inventory should reflect that we tried this subnet, not
    // just the hosts that responded.
    items.push({
      observedKey: subnetKey,
      itemType: "subnet",
      name: subnet,
      confidence: 0.95,
      rawData: {
        network: networkAddress,
        cidr: Number(cidrStr) || 24,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: subnet,
        protocolFamily: "ipv4",
        discoveredVia: "nmap_sn",
      },
    });

    let hosts: ProbedHost[];
    try {
      const output = adapter.execNmap(subnet);
      hosts = parseNmapGrepable(output);
    } catch (err) {
      warnings.push(
        `discovery: nmap -sn ${subnet} failed: ${(err as Error).message}`,
      );
      continue;
    }

    for (const host of hosts) {
      const hostKey = `arp:${host.ip}`;
      items.push({
        observedKey: hostKey,
        itemType: "host",
        name: host.hostname ?? `LAN Host ${host.ip}`,
        // Higher confidence than C1 — the host actually answered.
        confidence: 0.85,
        rawData: {
          address: host.ip,
          ...(host.hostname ? { hostname: host.hostname } : {}),
          osiLayer: 3,
          osiLayerName: "network",
          networkAddress: host.ip,
          protocolFamily: "ipv4",
          discoveredVia: "nmap_sn",
        },
      });
      relationships.push({
        fromObservedKey: hostKey,
        toObservedKey: subnetKey,
        relationshipType: "MEMBER_OF",
      });
    }
  }

  return { items, relationships, warnings };
}
